import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

function encodeUrlCredentialPart(value: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
}

function normalizeDatabaseUrl(databaseUrl: string): string {
  const trimmed = databaseUrl.trim().replace(/^(['"])(.*)\1$/, '$2');

  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    // Fall through and tolerate common unescaped password characters.
  }

  const match = /^(postgres(?:ql)?:\/\/)(.+)$/iu.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  const protocol = match[1];
  const rest = match[2];
  if (!protocol || !rest) {
    return trimmed;
  }

  const atIndex = rest.lastIndexOf('@');
  if (atIndex === -1) {
    return trimmed;
  }

  const credentials = rest.slice(0, atIndex);
  const hostAndPath = rest.slice(atIndex + 1);
  const separatorIndex = credentials.indexOf(':');
  if (separatorIndex === -1) {
    return trimmed;
  }

  const user = credentials.slice(0, separatorIndex);
  const password = credentials.slice(separatorIndex + 1);

  return `${protocol}${encodeUrlCredentialPart(user)}:${encodeUrlCredentialPart(password)}@${hostAndPath}`;
}

export function createDbClient(databaseUrl: string): DbClient {
  const sql = postgres(normalizeDatabaseUrl(databaseUrl));
  return drizzle(sql, { schema });
}
