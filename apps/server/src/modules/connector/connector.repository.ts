// 连接器仓储:CRUD + 本地工作区 access 检查 + 引用计数(本期 stub)
// 详见 docs/specs/26-connectors.md §3 / docs/specs/06-database-schema.md §4.5
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type { ConnectorListQueryDto } from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../infrastructure/database/database.constants';

const { apiTokens, connectors, projects } = schema;

export interface ConnectorProjectAccessRow {
  id: string;
}

export type ConnectorRow = typeof connectors.$inferSelect;
export type ConnectorInsertRow = typeof connectors.$inferInsert;

export interface ConnectorRowWithJoins extends ConnectorRow {
  createdByDisplayName: string | null;
  tokenName: string | null;
  tokenPrefix: string | null;
}

export interface ConnectorReferenceCounts {
  canaryReleases: number;
  productionReleases: number;
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
    webhookTokenId: connectors.webhookTokenId,
    ipWhitelist: connectors.ipWhitelist,
    healthStatus: connectors.healthStatus,
    lastProbedAt: connectors.lastProbedAt,
    lastProbeError: connectors.lastProbeError,
    createdBy: connectors.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    tokenName: apiTokens.name,
    tokenPrefix: apiTokens.prefix,
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
      .leftJoin(apiTokens, eq(apiTokens.id, connectors.webhookTokenId))
      .where(and(...conditions))
      .orderBy(desc(connectors.updatedAt));
  }

  async findById(projectId: string, connectorId: string): Promise<ConnectorRowWithJoins | null> {
    const rows = await this.db
      .select(this.selectFields)
      .from(connectors)
      .leftJoin(apiTokens, eq(apiTokens.id, connectors.webhookTokenId))
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

  async findTokenByIdAndProject(tokenId: string, projectId: string): Promise<typeof apiTokens.$inferSelect | null> {
    const rows = await this.db
      .select()
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
      .leftJoin(apiTokens, eq(apiTokens.id, connectors.webhookTokenId))
      .where(and(eq(connectors.projectId, projectId), inArray(connectors.id, ids), isNull(connectors.deletedAt)));
  }
}
