// DBOS workflow 集成测试 helper —— 关注点:验证 ExperimentWorkflow 状态机
//
// 用法:
//   - 启动本地 PostgreSQL: pnpm dev:docker:ready
//   - export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/proofhound"
//   - pnpm -F @proofhound/server test:integration
//
// 设计:
//   - 不建独立 schema,直接往真实 ph_core / ph_assets / ph_runs 写。
//   - 每条用例的数据通过 fixture 工厂插入,trackExperiment(seeded) 后由 afterEach 精确清理。
//   - BullmqService 被 mock,不连 Redis;mock 立即把 run_result 写到 ph_runs.run_results
//     模拟 worker 完成,workflow 的 pollUntilBatchDone 立即满足。
//   - 不装 AppModule / Guard / Controller,只装 ExperimentWorkflowRegistrar + RunResultService。

// 集成测试默认 debug 级别(便于诊断状态机各步骤);应用层只 emit JSON,
// 想看人读友好格式时手动 `pnpm test:integration 2>&1 | pino-pretty`。
// 必须在 import @proofhound/logger 之前设(logger 在 import 时读 env)。
process.env['LOG_LEVEL'] ??= 'debug';

import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createDbClient, schema, type DbClient } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';
import { inArray, like, sql } from 'drizzle-orm';
import { DATABASE_CLIENT } from '../../src/infrastructure/database/database.constants';
import { BullmqService } from '../../src/infrastructure/orchestration/bullmq.service';
import { LOCAL_ACTOR_ID } from '../../src/common/guards/local-actor.guard';
import { ExperimentWorkflowRegistrar } from '../../src/modules/experiment/experiment.workflow';
import { RunResultRepository } from '../../src/modules/run-result/run-result.repository';
import { RunResultService } from '../../src/modules/run-result/run-result.service';
import { MockBullmqService } from './bullmq.mock';
import type { SeededExperiment } from './fixtures/experiment-fixture';

const setupLogger = createLogger('dbos-test.setup', { service: 'integration-test' });

const { runResults, experiments, promptVersions, prompts, datasetSamples, datasets, models } = schema;

export interface DbosTestContext {
  databaseUrl: string;
  db: DbClient;
  registrar: ExperimentWorkflowRegistrar;
  bullmq: MockBullmqService;
  testUserId: string;
  trackExperiment(seed: SeededExperiment): void;
  cleanupTrackedExperiments(): Promise<void>;
}

export function getTestDatabaseUrl(): string | null {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url || url.length === 0) return null;
  return url;
}

export function describeDbosIntegration(name: string, fn: (getCtx: () => DbosTestContext) => void): void {
  const url = getTestDatabaseUrl();
  if (!url) {
    describe.skip(`${name} (skipped: TEST_DATABASE_URL not set)`, () => {
      it.skip('integration test requires TEST_DATABASE_URL', () => undefined);
    });
    return;
  }

  describe(name, () => {
    const ctxRef: { current: DbosTestContext | null } = { current: null };
    const trackedExperiments = new Map<string, SeededExperiment>();
    let module: TestingModule | null = null;
    let sysSchema: string | null = null;
    let dbRef: DbClient | null = null;

    beforeAll(async () => {
      const suite = randomBytes(4).toString('hex');
      sysSchema = `dbos_test_${suite}`;
      setupLogger.info({ suite, sysSchema }, 'integration_suite_init');
      const db = createDbClient(url);
      dbRef = db;

      // 兜底:先清掉历史 vitest 中断遗留的 dbos-test-* 业务项目和悬空 dbos_test_* schema
      // (afterEach / afterAll 因 Ctrl+C 或 worker crash 没跑完时会泄露)
      await cleanupStaleResidue(db);

      const testUserId = LOCAL_ACTOR_ID;

      // schema 级隔离:测试期间 DBOS 的 workflow_status / operation_outputs 等系统表
      // 全部写到 dbos_test_<suite> schema,与生产默认的 dbos schema 完全隔开。
      // afterAll 时 DROP SCHEMA CASCADE 整批清,不再脏生产表。
      DBOS.setConfig({
        name: `dbos-test-${suite}`,
        systemDatabaseUrl: url,
        systemDatabaseSchemaName: sysSchema,
        runAdminServer: false,
      });

      const mockBullmq = new MockBullmqService(db);

      // compile() 必须在 DBOS.launch() 之前:NestJS 实例化 ExperimentWorkflowRegistrar 时,
      // 其 constructor 会调 DBOS.registerStep / registerWorkflow,DBOS SDK 要求"先注册后 launch"。
      // 生产路径里 NestFactory.create 先实例化所有 provider,onModuleInit 才跑 DBOS.launch,天然满足顺序。
      module = await Test.createTestingModule({
        providers: [
          { provide: DATABASE_CLIENT, useValue: db },
          { provide: BullmqService, useValue: mockBullmq },
          RunResultRepository,
          RunResultService,
          ExperimentWorkflowRegistrar,
        ],
      }).compile();

      await DBOS.launch();
      setupLogger.debug({ suite, testUserId }, 'dbos_launched');

      await module.init();

      const registrar = module.get(ExperimentWorkflowRegistrar);

      ctxRef.current = {
        databaseUrl: url,
        db,
        registrar,
        bullmq: mockBullmq,
        testUserId,
        trackExperiment(seed: SeededExperiment) {
          trackedExperiments.set(seed.experimentId, seed);
        },
        async cleanupTrackedExperiments() {
          if (trackedExperiments.size === 0) return;
          const seeds = Array.from(trackedExperiments.values());
          const experimentIds = seeds.map((seed) => seed.experimentId);
          const promptVersionIds = seeds.map((seed) => seed.promptVersionId);
          const promptIds = seeds.map((seed) => seed.promptId);
          const datasetIds = seeds.map((seed) => seed.datasetId);
          const modelIds = seeds.map((seed) => seed.modelId);
          const sampleIds = seeds.flatMap((seed) => seed.sampleIds);

          setupLogger.debug({ experimentIds }, 'cleanup_tracked_experiments');
          await db.delete(runResults).where(inArray(runResults.sourceId, experimentIds));
          await db.delete(experiments).where(inArray(experiments.id, experimentIds));
          if (sampleIds.length > 0) {
            await db.delete(datasetSamples).where(inArray(datasetSamples.id, sampleIds));
          }
          await db.delete(promptVersions).where(inArray(promptVersions.id, promptVersionIds));
          await db.delete(prompts).where(inArray(prompts.id, promptIds));
          await db.delete(datasets).where(inArray(datasets.id, datasetIds));
          await db.delete(models).where(inArray(models.id, modelIds));
          trackedExperiments.clear();
        },
      };
      setupLogger.info({}, 'integration_suite_ready');
    }, 60_000);

    beforeEach(() => {
      const state = expect.getState();
      setupLogger.info({ testName: state.currentTestName }, 'integration_case_start');
    });

    afterEach(async () => {
      const state = expect.getState();
      ctxRef.current?.bullmq.reset();
      await ctxRef.current?.cleanupTrackedExperiments();
      setupLogger.info({ testName: state.currentTestName }, 'integration_case_end');
    });

    afterAll(async () => {
      try {
        await module?.close();
      } catch {
        // ignore
      }
      try {
        await DBOS.shutdown();
      } catch {
        // ignore
      }
      // shutdown 之后关连接池才能 DROP SCHEMA(否则 schema 内表上还有连接持有 lock)
      if (dbRef && sysSchema) {
        try {
          await dbRef.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(sysSchema)} CASCADE`);
          setupLogger.info({ sysSchema }, 'integration_suite_dropped_sys_schema');
        } catch (err) {
          setupLogger.warn({ sysSchema, err: (err as Error).message }, 'drop_sysdb_schema_failed');
        }
      }
      // 最后显式关 postgres-js 连接池,避免进程因为残留连接 idle 而拖延退出
      // (旧 jest 跑完后卡 14 分钟就是因为这里没关)。
      if (dbRef) {
        try {
          await (dbRef as unknown as { $client: { end: (opts?: { timeout?: number }) => Promise<void> } }).$client.end({
            timeout: 5,
          });
        } catch {
          // ignore
        }
      }
      setupLogger.info({}, 'integration_suite_done');
    }, 30_000);

    fn(() => {
      if (!ctxRef.current) throw new Error('integration context not initialised');
      return ctxRef.current;
    });
  });
}

// 兜底清掉上次 vitest 中断遗留的测试残留(Ctrl+C / worker crash 时 afterEach/afterAll 没跑完)。
// 跨 suite 通用:首个跑的 suite 在 beforeAll 命中,后续 suite 找不到东西。
// 已通过 vitest.integration.config.ts 的 fileParallelism: false + singleFork 串行化,不会误伤并行运行的 suite。
async function cleanupStaleResidue(db: DbClient): Promise<void> {
  // 1. 业务表:按 fixture 前缀清掉上次中断留下的本地测试资源。
  const staleExperiments = await db
    .select({ id: experiments.id })
    .from(experiments)
    .where(like(experiments.name, 'dbos-test-%'));
  if (staleExperiments.length > 0) {
    const ids = staleExperiments.map((r) => r.id);
    await db.delete(runResults).where(inArray(runResults.sourceId, ids));
    await db.delete(experiments).where(inArray(experiments.id, ids));
  }

  const stalePrompts = await db.select({ id: prompts.id }).from(prompts).where(like(prompts.name, 'dbos-test-%'));
  if (stalePrompts.length > 0) {
    const ids = stalePrompts.map((r) => r.id);
    await db.delete(prompts).where(inArray(prompts.id, ids));
  }

  const staleDatasets = await db.select({ id: datasets.id }).from(datasets).where(like(datasets.name, 'dbos-test-%'));
  if (staleDatasets.length > 0) {
    const ids = staleDatasets.map((r) => r.id);
    await db.delete(datasets).where(inArray(datasets.id, ids));
  }

  const staleModels = await db.select({ id: models.id }).from(models).where(like(models.name, 'dbos-test-%'));
  if (staleModels.length > 0) {
    const ids = staleModels.map((r) => r.id);
    await db.delete(models).where(inArray(models.id, ids));
  }

  const staleCount = staleExperiments.length + stalePrompts.length + staleDatasets.length + staleModels.length;
  if (staleCount > 0) {
    setupLogger.info({ count: staleCount }, 'cleanup_stale_test_resources');
  }

  // 2. DBOS 系统库:扫并 DROP 所有悬空的 dbos_test_* schema
  const rawRows = await db.execute(sql`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dbos_test_%'
  `);
  const rows: Array<{ schema_name: string }> = Array.isArray(rawRows)
    ? (rawRows as unknown as Array<{ schema_name: string }>)
    : ((rawRows as unknown as { rows?: Array<{ schema_name: string }> }).rows ?? []);
  for (const row of rows) {
    await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(row.schema_name)} CASCADE`);
  }
  if (rows.length > 0) {
    setupLogger.info({ count: rows.length, schemas: rows.map((r) => r.schema_name) }, 'cleanup_stale_sys_schemas');
  }
}
