import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDbClient } from './client';

function writeLine(message = ''): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  // Load .env from monorepo root (packages/db is two levels deep)
  try {
    process.loadEnvFile(resolve(process.cwd(), '../../.env'));
  } catch {
    // Not found is fine in CI / production — env vars supplied externally
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('❌  DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDbClient(databaseUrl);

  writeLine('⏳  Running migrations…');
  await migrate(db, {
    migrationsFolder: resolve(__dirname, './migrations'),
  });
  writeLine('✅  Migrations complete');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
