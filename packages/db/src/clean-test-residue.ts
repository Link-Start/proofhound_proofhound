/**
 * 一次性清理 DBOS 集成测试残留。
 *
 * 用途:把过去 vitest 中断/crash 留下的悬空 `dbos_test_*` schema 一次性清掉。
 * 之后 setup.ts 的 beforeAll 兜底逻辑 + schema 级隔离会保证新测试不再脏库。
 *
 * 仅清 information_schema.schemata 中 schema_name LIKE 'dbos_test_%' 的 schema (DROP CASCADE)。
 *
 * 不动:
 *   - 默认 dbos schema (无法按 application_id / name 区分测试与生产产生的行)
 *   - 任何业务表(models/datasets/prompts/...)数据
 *
 * 用法:pnpm db:clean-test-residue
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbClient } from './client';

function writeLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // CI / 其它已注入 env 的环境
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌  DATABASE_URL 未配置');
    process.exit(1);
  }

  const db = createDbClient(databaseUrl);

  // DBOS 系统库残留 schema
  const rawRows = await db.execute(sql`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dbos_test_%'
  `);
  const rows: Array<{ schema_name: string }> = Array.isArray(rawRows)
    ? (rawRows as unknown as Array<{ schema_name: string }>)
    : ((rawRows as unknown as { rows?: Array<{ schema_name: string }> }).rows ?? []);

  const droppedSchemas: string[] = [];
  for (const row of rows) {
    await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(row.schema_name)} CASCADE`);
    droppedSchemas.push(row.schema_name);
  }

  writeLine('✅  DBOS 集成测试残留清理完成');
  writeLine(`  • DBOS 系统 schema (dbos_test_*):               ${droppedSchemas.length}`);
  if (droppedSchemas.length > 0) {
    writeLine(`    ${droppedSchemas.join(', ')}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('❌  清理失败:', err);
  process.exit(1);
});
