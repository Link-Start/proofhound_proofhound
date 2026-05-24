/**
 * 本地 reset：DROP 当前数据库中的所有用户 schema。
 *
 * **仅本地与 staging——生产严禁。**
 *
 * 调用链：`pnpm db:reset` = `tsx src/reset.ts && pnpm migrate && pnpm seed`
 *   - 本脚本只负责清库；结构重建与 seed 由后续命令完成
 *
 * 保护机制：
 *   - 默认要求 DATABASE_URL 指向 localhost / 127.0.0.1 / ::1
 *   - 远端数据库（staging 等）必须显式设置 ALLOW_DB_RESET=1
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbClient } from './client';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function writeLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

function unwrapRows<T>(rawRows: unknown): T[] {
  return Array.isArray(rawRows) ? (rawRows as T[]) : ((rawRows as { rows?: T[] }).rows ?? []);
}

function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl.trim().replace(/^(['"])(.*)\1$/, '$2'));
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
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

  const local = isLocalDatabaseUrl(databaseUrl);
  const allowReset = process.env['ALLOW_DB_RESET'] === '1';
  if (!local && !allowReset) {
    console.error('❌  DATABASE_URL 指向远端数据库，拒绝执行 reset');
    console.error('    本地开发请用 localhost；如确需在远端（staging）执行，显式设置：');
    console.error('    ALLOW_DB_RESET=1 pnpm db:reset');
    process.exit(1);
  }

  const db = createDbClient(databaseUrl);

  const rawRows = await db.execute(sql`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name <> 'information_schema'
      AND schema_name NOT LIKE 'pg_%'
    ORDER BY schema_name
  `);
  const rows = unwrapRows<{ schema_name: string }>(rawRows);

  writeLine(`🗑   DROP 所有用户 schema (${rows.length})`);
  for (const { schema_name: schemaName } of rows) {
    await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schemaName)} CASCADE`);
    writeLine(`   ✓ ${schemaName}`);
  }
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "public"`);
  await db.execute(sql`GRANT USAGE ON SCHEMA "public" TO PUBLIC`);
  writeLine('   ✓ public (recreated)');

  writeLine('\n✅  Reset 完成，接下来由 pnpm migrate + pnpm seed 重建结构与默认本地项目');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Reset 失败:', err);
  process.exit(1);
});
