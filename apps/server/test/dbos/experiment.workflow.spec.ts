// ExperimentWorkflow 集成测试 —— 验证 runImpl 的全部状态出口
// (SPEC 03 §3.1 + 24-experiments.md)
//
// 测试范围:只测 DBOS workflow 状态机本身,不走 Controller / Service / Auth。
// BullmqService 被 mock,run_result 由 mock 直接写,不连 Redis / worker。

import { randomUUID } from 'node:crypto';
import { schema } from '@proofhound/db';
import { eq } from 'drizzle-orm';
import { describeDbosIntegration } from './setup';
import { seedExperiment } from './fixtures/experiment-fixture';

const { experiments } = schema;

describeDbosIntegration('ExperimentWorkflow integration', (getCtx) => {
  it('success: 全部 sample 成功 → status=success, metrics 写入', async () => {
    const ctx = getCtx();
    ctx.bullmq.setBehavior('all_success');

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3 });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
        failureReason: experiments.failureReason,
        failureKind: experiments.failureKind,
        processedSamples: experiments.processedSamples,
        failedSamples: experiments.failedSamples,
        metrics: experiments.metrics,
        finishedAt: experiments.finishedAt,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    const row = rows[0]!;
    expect(row.status).toBe('success');
    expect(row.controlState).toBeNull();
    expect(row.failureReason).toBeNull();
    expect(row.failureKind).toBeNull();
    expect(row.processedSamples).toBe(3);
    expect(row.failedSamples).toBe(0);
    expect(row.finishedAt).not.toBeNull();
    expect(row.metrics).not.toBeNull();
    expect(ctx.bullmq.getCalls()).toHaveLength(3);
  });

  it('failed: is_frozen=false 时 finalize=failed, reason=prompt_version_not_frozen', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, {
      sampleCount: 2,
      isFrozen: false,
    });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        failureReason: experiments.failureReason,
        failureKind: experiments.failureKind,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.failureReason).toBe('prompt_version_not_frozen');
    expect(rows[0]!.failureKind).toBe('internal');
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('failed: dataset 无样本 → reason=dataset_empty', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 0 });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({ status: experiments.status, failureReason: experiments.failureReason })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.failureReason).toBe('dataset_empty');
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('failed: 全部 sample error → finalize=failed, reason=all_samples_failed', async () => {
    const ctx = getCtx();
    ctx.bullmq.setBehavior('all_error');

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 2 });
    ctx.trackExperiment(seeded);

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        failureReason: experiments.failureReason,
        failureKind: experiments.failureKind,
        processedSamples: experiments.processedSamples,
        failedSamples: experiments.failedSamples,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.failureReason).toBe('all_samples_failed');
    expect(rows[0]!.failureKind).toBe('internal');
    expect(rows[0]!.processedSamples).toBe(2);
    expect(rows[0]!.failedSamples).toBe(2);
    expect(ctx.bullmq.getCalls()).toHaveLength(2);
  });

  it('cancelled: control_state=cancel → finalize=cancelled, 不 enqueue 任何 sample', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3 });
    ctx.trackExperiment(seeded);

    // 在 workflow 启动前直接置 control_state(模拟提交后立刻取消)
    await ctx.db
      .update(experiments)
      .set({ controlState: 'cancel' })
      .where(eq(experiments.id, seeded.experimentId));

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
        finishedAt: experiments.finishedAt,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.controlState).toBeNull();
    expect(rows[0]!.finishedAt).not.toBeNull();
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('stopped: control_state=stop → finalize=stopped, 不 enqueue 任何 sample', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3 });
    ctx.trackExperiment(seeded);

    await ctx.db
      .update(experiments)
      .set({ controlState: 'stop' })
      .where(eq(experiments.id, seeded.experimentId));

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('stopped');
    expect(rows[0]!.controlState).toBeNull();
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });

  it('resume: control_state=resume 被识别 → clearResume 清状态后继续跑完 → status=success', async () => {
    const ctx = getCtx();

    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 2 });
    ctx.trackExperiment(seeded);

    // 模拟"上次 stopped 后用户重提" 的状态:status=stopped + control_state=resume
    await ctx.db
      .update(experiments)
      .set({ status: 'stopped', controlState: 'resume' })
      .where(eq(experiments.id, seeded.experimentId));

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({
        status: experiments.status,
        controlState: experiments.controlState,
        processedSamples: experiments.processedSamples,
      })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);

    expect(rows[0]!.status).toBe('success');
    expect(rows[0]!.controlState).toBeNull();
    expect(rows[0]!.processedSamples).toBe(2);
    expect(ctx.bullmq.getCalls()).toHaveLength(2);
  });

  it('stopped: 第一 batch enqueue 后置 stop → batch 边界感知 → status=stopped, 不再 enqueue 第二 batch', async () => {
    const ctx = getCtx();
    // batchSize=1 + sampleCount=3:第一 batch enqueue 1 个 sample,mock 立刻把 run_result 写成功,
    // poll 满足后进入下一轮 batch 入口前 readControlState 应捕获到 stop。
    const seeded = await seedExperiment(ctx.db, ctx.testUserId, { sampleCount: 3, batchSize: 1 });
    ctx.trackExperiment(seeded);
    ctx.bullmq.setBehavior('all_success');

    // 拦截第一次 enqueue 后立即写 control_state=stop
    const originalEnqueue = ctx.bullmq.enqueueLlmJob.bind(ctx.bullmq);
    let stopWritten = false;
    ctx.bullmq.enqueueLlmJob = async (payload, runResultId) => {
      const result = await originalEnqueue(payload, runResultId);
      if (!stopWritten) {
        stopWritten = true;
        await ctx.db
          .update(experiments)
          .set({ controlState: 'stop' })
          .where(eq(experiments.id, seeded.experimentId));
      }
      return result;
    };

    await ctx.registrar.runWorkflow(seeded.experimentId);

    const rows = await ctx.db
      .select({ status: experiments.status })
      .from(experiments)
      .where(eq(experiments.id, seeded.experimentId))
      .limit(1);
    expect(rows[0]!.status).toBe('stopped');
    expect(ctx.bullmq.getCalls()).toHaveLength(1); // 第一 batch 已发,第二/第三 batch 应被拦下
  });

  it('failed: experiment 不存在 → loadPlan 抛错 → workflow 静默返回不抛', async () => {
    const ctx = getCtx();

    const nonExistentId = randomUUID();
    // 不应抛错;workflow 内部 catch 后调 finalize('failed'),finalize UPDATE 命中 0 行也不报错
    await expect(ctx.registrar.runWorkflow(nonExistentId)).resolves.toBeUndefined();
    expect(ctx.bullmq.getCalls()).toHaveLength(0);
  });
});
