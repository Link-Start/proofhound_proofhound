// 连接器仓储:CRUD + 本地工作区 access 检查 + 引用计数(本期 stub)
// 详见 docs/specs/26-connectors.md §3 / docs/specs/06-database-schema.md §4.5 / §3.2
//
// webhook token 不再在 connectors 表反向引用,而是在 ph_core.tokens 表通过
// scope='webhook' + connector_id 正向关联,一个 connector 可同时持有多条有效 token 用于平滑轮换。
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { ConnectorListQueryDto } from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../infrastructure/database/database.constants';

const { tokens, connectors, projects } = schema;

export interface ConnectorProjectAccessRow {
  id: string;
}

export type ConnectorRow = typeof connectors.$inferSelect;
export type ConnectorInsertRow = typeof connectors.$inferInsert;

export interface ConnectorRowWithJoins extends ConnectorRow {
  createdByDisplayName: string | null;
}

export interface ConnectorReferenceCounts {
  canaryReleases: number;
  productionReleases: number;
}

export interface WebhookTokenRow {
  id: string;
  connectorId: string;
  projectId: string;
  name: string;
  prefix: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface WebhookTokenWithEncryptedRow extends WebhookTokenRow {
  tokenEncrypted: string | null;
}

export interface InsertWebhookTokenInput {
  connectorId: string;
  projectId: string;
  name: string;
  tokenHash: string;
  tokenEncrypted: string | null;
  prefix: string;
  expiresAt?: Date | null;
  createdBy: string;
}

@Injectable()
export class ConnectorRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  private readonly selectFields = {
    id: connectors.id,
    projectId: connectors.projectId,
    name: connectors.name,
    description: connectors.description,
    direction: connectors.direction,
    type: connectors.type,
    config: connectors.config,
    configEncrypted: connectors.configEncrypted,
    webhookPath: connectors.webhookPath,
    ipWhitelist: connectors.ipWhitelist,
    healthStatus: connectors.healthStatus,
    lastProbedAt: connectors.lastProbedAt,
    lastProbeError: connectors.lastProbeError,
    createdBy: connectors.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdAt: connectors.createdAt,
    updatedAt: connectors.updatedAt,
    deletedAt: connectors.deletedAt,
  } as const;

  // -------------------------------------------------------------------------
  // self-hosted 开源版不维护项目成员表:本地管理端默认允许访问。
  // -------------------------------------------------------------------------
  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<ConnectorProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------
  async listByProject(projectId: string, filters?: ConnectorListQueryDto): Promise<ConnectorRowWithJoins[]> {
    const conditions = [eq(connectors.projectId, projectId), isNull(connectors.deletedAt)];
    if (filters?.direction) conditions.push(eq(connectors.direction, filters.direction));
    if (filters?.type) conditions.push(eq(connectors.type, filters.type));
    if (filters?.healthStatus) conditions.push(eq(connectors.healthStatus, filters.healthStatus));

    return this.db
      .select(this.selectFields)
      .from(connectors)
      .where(and(...conditions))
      .orderBy(desc(connectors.updatedAt));
  }

  async findById(projectId: string, connectorId: string): Promise<ConnectorRowWithJoins | null> {
    const rows = await this.db
      .select(this.selectFields)
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), eq(connectors.id, connectorId), isNull(connectors.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByProjectAndName(projectId: string, name: string, excludeId?: string): Promise<ConnectorRow | null> {
    const rows = await this.db
      .select()
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), eq(connectors.name, name), isNull(connectors.deletedAt)))
      .limit(2);
    const match = rows.find((row) => row.id !== excludeId);
    return match ?? null;
  }

  async findByWebhookPath(projectId: string, webhookPath: string): Promise<ConnectorRow | null> {
    const rows = await this.db
      .select()
      .from(connectors)
      .where(
        and(eq(connectors.projectId, projectId), eq(connectors.webhookPath, webhookPath), isNull(connectors.deletedAt)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // webhook token: scope='webhook' AND connector_id=<connector.id> AND revoked_at IS NULL
  // -------------------------------------------------------------------------
  async listWebhookTokensForConnector(connectorId: string): Promise<WebhookTokenRow[]> {
    const rows = await this.db
      .select({
        id: tokens.id,
        connectorId: tokens.connectorId,
        projectId: tokens.projectId,
        name: tokens.name,
        prefix: tokens.prefix,
        expiresAt: tokens.expiresAt,
        lastUsedAt: tokens.lastUsedAt,
        createdAt: tokens.createdAt,
      })
      .from(tokens)
      .where(
        and(eq(tokens.scope, 'webhook'), eq(tokens.connectorId, connectorId), isNull(tokens.revokedAt)),
      )
      .orderBy(desc(tokens.createdAt));
    return rows.map((row) => ({
      id: row.id,
      connectorId: row.connectorId as string,
      projectId: row.projectId as string,
      name: row.name,
      prefix: row.prefix,
      expiresAt: row.expiresAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      createdAt: row.createdAt,
    }));
  }

  async findWebhookTokenById(connectorId: string, tokenId: string): Promise<WebhookTokenRow | null> {
    const rows = await this.db
      .select({
        id: tokens.id,
        connectorId: tokens.connectorId,
        projectId: tokens.projectId,
        name: tokens.name,
        prefix: tokens.prefix,
        expiresAt: tokens.expiresAt,
        lastUsedAt: tokens.lastUsedAt,
        createdAt: tokens.createdAt,
      })
      .from(tokens)
      .where(
        and(
          eq(tokens.scope, 'webhook'),
          eq(tokens.connectorId, connectorId),
          eq(tokens.id, tokenId),
          isNull(tokens.revokedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      connectorId: row.connectorId as string,
      projectId: row.projectId as string,
      name: row.name,
      prefix: row.prefix,
      expiresAt: row.expiresAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  // 单独提供"含 token_encrypted"的方法,只在 reveal 路径调用,避免普通列表 / 校验路径意外把
  // 加密明文字段带出。
  async findWebhookTokenWithEncryptedById(
    connectorId: string,
    tokenId: string,
  ): Promise<WebhookTokenWithEncryptedRow | null> {
    const rows = await this.db
      .select({
        id: tokens.id,
        connectorId: tokens.connectorId,
        projectId: tokens.projectId,
        name: tokens.name,
        prefix: tokens.prefix,
        expiresAt: tokens.expiresAt,
        lastUsedAt: tokens.lastUsedAt,
        createdAt: tokens.createdAt,
        tokenEncrypted: tokens.tokenEncrypted,
      })
      .from(tokens)
      .where(
        and(
          eq(tokens.scope, 'webhook'),
          eq(tokens.connectorId, connectorId),
          eq(tokens.id, tokenId),
          isNull(tokens.revokedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      connectorId: row.connectorId as string,
      projectId: row.projectId as string,
      name: row.name,
      prefix: row.prefix,
      expiresAt: row.expiresAt ?? null,
      lastUsedAt: row.lastUsedAt ?? null,
      createdAt: row.createdAt,
      tokenEncrypted: row.tokenEncrypted ?? null,
    };
  }

  async insertWebhookToken(input: InsertWebhookTokenInput): Promise<{ id: string }> {
    const result = await this.db
      .insert(tokens)
      .values({
        scope: 'webhook',
        projectId: input.projectId,
        connectorId: input.connectorId,
        name: input.name,
        tokenHash: input.tokenHash,
        tokenEncrypted: input.tokenEncrypted,
        prefix: input.prefix,
        ipWhitelist: null,
        expiresAt: input.expiresAt ?? null,
        createdBy: input.createdBy,
      })
      .returning({ id: tokens.id });
    const row = result[0];
    if (!row) throw new Error('webhook token insert returned no row');
    return { id: row.id };
  }

  async revokeWebhookToken(connectorId: string, tokenId: string): Promise<boolean> {
    const result = await this.db
      .update(tokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(tokens.id, tokenId),
          eq(tokens.scope, 'webhook'),
          eq(tokens.connectorId, connectorId),
          isNull(tokens.revokedAt),
        ),
      )
      .returning({ id: tokens.id });
    return result.length > 0;
  }

  async countActiveWebhookTokens(connectorId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tokens)
      .where(
        and(eq(tokens.scope, 'webhook'), eq(tokens.connectorId, connectorId), isNull(tokens.revokedAt)),
      );
    return Number(rows[0]?.count ?? 0);
  }

  async countActiveWebhookTokensByConnectorIds(connectorIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (connectorIds.length === 0) return result;
    const rows = await this.db
      .select({
        connectorId: tokens.connectorId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(tokens)
      .where(
        and(
          eq(tokens.scope, 'webhook'),
          inArray(tokens.connectorId, connectorIds),
          isNull(tokens.revokedAt),
        ),
      )
      .groupBy(tokens.connectorId);
    for (const id of connectorIds) result.set(id, 0);
    for (const row of rows) {
      if (row.connectorId) result.set(row.connectorId, Number(row.count ?? 0));
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 写
  // -------------------------------------------------------------------------
  async insert(values: ConnectorInsertRow): Promise<ConnectorRow> {
    const result = await this.db.insert(connectors).values(values).returning();
    const row = result[0];
    if (!row) throw new Error('Connector insert returned no row');
    return row;
  }

  async update(projectId: string, id: string, patch: Partial<ConnectorInsertRow>): Promise<ConnectorRow> {
    const result = await this.db
      .update(connectors)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(connectors.projectId, projectId), eq(connectors.id, id), isNull(connectors.deletedAt)))
      .returning();
    const row = result[0];
    if (!row) throw new Error(`Connector ${id} not found for update`);
    return row;
  }

  async softDelete(projectId: string, id: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(connectors)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(connectors.projectId, projectId), eq(connectors.id, id), isNull(connectors.deletedAt)));
  }

  async updateProbeOutcome(
    projectId: string,
    id: string,
    lastProbedAt: Date,
    lastProbeError: string | null,
  ): Promise<void> {
    const healthStatus = lastProbeError ? 'unhealthy' : 'healthy';
    await this.db
      .update(connectors)
      .set({ lastProbedAt, lastProbeError, healthStatus, updatedAt: new Date() })
      .where(and(eq(connectors.projectId, projectId), eq(connectors.id, id), isNull(connectors.deletedAt)));
  }

  // -------------------------------------------------------------------------
  // 引用统计:占位实现
  // TODO(PR-N):基于 ph_releases.release_lines / release_line_events
  // 补真实引用统计(详见 docs/specs/27-releases.md),
  // 改成真实 SELECT COUNT(*) ... GROUP BY connector_id;同时回填 listReferenceDetails()
  // -------------------------------------------------------------------------
  async countReferences(connectorIds: string[]): Promise<Map<string, ConnectorReferenceCounts>> {
    const result = new Map<string, ConnectorReferenceCounts>();
    for (const id of connectorIds) {
      result.set(id, { canaryReleases: 0, productionReleases: 0 });
    }
    return result;
  }

  async listReferenceDetails(
    _connectorId: string,
  ): Promise<
    Array<{ id: string; kind: 'canary_release' | 'production_release'; name: string | null; status: string }>
  > {
    return [];
  }

  async countByProject(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), isNull(connectors.deletedAt)));
    return Number(rows[0]?.count ?? 0);
  }

  async findManyByIds(projectId: string, ids: string[]): Promise<ConnectorRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select(this.selectFields)
      .from(connectors)
      .where(and(eq(connectors.projectId, projectId), inArray(connectors.id, ids), isNull(connectors.deletedAt)));
  }
}
