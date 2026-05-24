import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../infrastructure/database/database.constants';

const { apiTokens } = schema;

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type ApiTokenInsertRow = typeof apiTokens.$inferInsert;

export interface ApiTokenRowWithCreator extends ApiTokenRow {
  createdByDisplayName: string | null;
}

@Injectable()
export class TokenRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private readonly selectFields = {
    id: apiTokens.id,
    scope: apiTokens.scope,
    projectId: apiTokens.projectId,
    name: apiTokens.name,
    tokenHash: apiTokens.tokenHash,
    tokenEncrypted: apiTokens.tokenEncrypted,
    prefix: apiTokens.prefix,
    ipWhitelist: apiTokens.ipWhitelist,
    lastUsedAt: apiTokens.lastUsedAt,
    expiresAt: apiTokens.expiresAt,
    createdBy: apiTokens.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdAt: apiTokens.createdAt,
    revokedAt: apiTokens.revokedAt,
  } as const;

  async listApiTokens(projectId: string): Promise<ApiTokenRowWithCreator[]> {
    return this.db
      .select(this.selectFields)
      .from(apiTokens)
      .where(and(eq(apiTokens.scope, 'project_api'), eq(apiTokens.projectId, projectId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt));
  }

  async findApiTokenById(projectId: string, tokenId: string): Promise<ApiTokenRowWithCreator | null> {
    const rows = await this.db
      .select(this.selectFields)
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.scope, 'project_api'),
          eq(apiTokens.projectId, projectId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findApiTokenByName(projectId: string, name: string): Promise<ApiTokenRow | null> {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.scope, 'project_api'),
          eq(apiTokens.projectId, projectId),
          eq(apiTokens.name, name),
          isNull(apiTokens.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveGlobalMcpToken(): Promise<ApiTokenRowWithCreator | null> {
    const rows = await this.db
      .select(this.selectFields)
      .from(apiTokens)
      .where(and(eq(apiTokens.scope, 'global_mcp'), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findGlobalMcpTokenById(tokenId: string): Promise<ApiTokenRowWithCreator | null> {
    const rows = await this.db
      .select(this.selectFields)
      .from(apiTokens)
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.scope, 'global_mcp'), isNull(apiTokens.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertApiToken(values: ApiTokenInsertRow): Promise<ApiTokenRow> {
    const result = await this.db.insert(apiTokens).values(values).returning();
    const row = result[0];
    if (!row) throw new Error('API token insert returned no row');
    return row;
  }

  async updateApiToken(
    projectId: string,
    tokenId: string,
    values: Pick<ApiTokenInsertRow, 'name' | 'expiresAt'>,
  ): Promise<ApiTokenRowWithCreator | null> {
    const result = await this.db
      .update(apiTokens)
      .set(values)
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.scope, 'project_api'),
          eq(apiTokens.projectId, projectId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning(this.selectFields);
    return result[0] ?? null;
  }

  async updateGlobalMcpToken(
    tokenId: string,
    values: Pick<ApiTokenInsertRow, 'name' | 'expiresAt'>,
  ): Promise<ApiTokenRowWithCreator | null> {
    const result = await this.db
      .update(apiTokens)
      .set(values)
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.scope, 'global_mcp'), isNull(apiTokens.revokedAt)))
      .returning(this.selectFields);
    return result[0] ?? null;
  }

  async revokeApiToken(projectId: string, tokenId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.db
      .update(apiTokens)
      .set({ revokedAt })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.scope, 'project_api'),
          eq(apiTokens.projectId, projectId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });
    return result.length > 0;
  }

  async revokeGlobalMcpToken(tokenId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.db
      .update(apiTokens)
      .set({ revokedAt })
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.scope, 'global_mcp'), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    return result.length > 0;
  }
}
