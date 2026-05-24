import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/proofhound',
  },
  schemaFilter: ['ph_core', 'ph_assets', 'ph_runs', 'ph_releases'],
  verbose: true,
  strict: true,
} satisfies Config;
