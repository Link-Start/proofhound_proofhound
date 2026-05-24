import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import type {
  ListModelContextWindowsQueryDto,
  UpsertModelContextWindowDto,
} from '@proofhound/shared';
import { DATABASE_CLIENT } from '../../infrastructure/database/database.constants';

const { modelContextWindows, models, projects } = schema;

export type ModelContextWindowRow = typeof modelContextWindows.$inferSelect;
export type ModelRow = typeof models.$inferSelect;
export type ModelInsertRow = typeof models.$inferInsert;

export interface ModelRowWithCreator extends ModelRow {
  createdByDisplayName: string | null;
}

export type ProjectVisibleModelRow = ModelRowWithCreator;

export interface ModelProjectAccessRow {
  id: string;
}

export interface ModelReferenceCounts {
  experiments: number;
  optimizations: number;
  canaryReleases: number;
  productionReleases: number;
}

@Injectable()
export class ModelRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  // -------------------------------------------------------------------------
  // 4.1 模型 CRUD / 列表
  // -------------------------------------------------------------------------
  private readonly modelSelectFields = {
    id: models.id,
    projectId: models.projectId,
    name: models.name,
    providerType: models.providerType,
    providerModelId: models.providerModelId,
    endpoint: models.endpoint,
    apiKeyEncrypted: models.apiKeyEncrypted,
    contextWindowTokens: models.contextWindowTokens,
    rpmLimit: models.rpmLimit,
    tpmLimit: models.tpmLimit,
    concurrencyLimit: models.concurrencyLimit,
    inputTokenPricePerMillion: models.inputTokenPricePerMillion,
    outputTokenPricePerMillion: models.outputTokenPricePerMillion,
    capabilities: models.capabilities,
    extraBody: models.extraBody,
    isActive: models.isActive,
    lastProbedAt: models.lastProbedAt,
    lastProbeError: models.lastProbeError,
    createdBy: models.createdBy,
    createdByDisplayName: sql<string | null>`NULL`,
    createdAt: models.createdAt,
    updatedAt: models.updatedAt,
    deletedAt: models.deletedAt,
  } as const;

  async listProjectModels(projectId: string): Promise<ProjectVisibleModelRow[]> {
    return this.db
      .select(this.modelSelectFields)
      .from(models)
      .where(and(eq(models.projectId, projectId), isNull(models.deletedAt)))
      .orderBy(desc(models.createdAt));
  }

  async listQuickStartGlobalModels(): Promise<ProjectVisibleModelRow[]> {
    return this.db
      .select(this.modelSelectFields)
      .from(models)
      .where(isNull(models.deletedAt))
      .orderBy(desc(models.createdAt));
  }

  async findModelById(modelId: string): Promise<ModelRowWithCreator | null> {
    const rows = await this.db
      .select(this.modelSelectFields)
      .from(models)
      .where(and(eq(models.id, modelId), isNull(models.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findModelAccessibleToProject(projectId: string, modelId: string): Promise<ProjectVisibleModelRow | null> {
    const rows = await this.db
      .select(this.modelSelectFields)
      .from(models)
      .where(and(eq(models.projectId, projectId), eq(models.id, modelId), isNull(models.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createModel(values: ModelInsertRow): Promise<ModelRow> {
    const result = await this.db.insert(models).values(values).returning();
    const row = result[0];
    if (!row) throw new Error('Model insert returned no row');
    return row;
  }

  async updateModel(modelId: string, patch: Partial<ModelInsertRow>): Promise<ModelRow> {
    const result = await this.db
      .update(models)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(models.id, modelId), isNull(models.deletedAt)))
      .returning();
    const row = result[0];
    if (!row) throw new Error(`Model ${modelId} not found for update`);
    return row;
  }

  async updateProbeOutcome(modelId: string, lastProbedAt: Date, lastProbeError: string | null): Promise<void> {
    await this.db
      .update(models)
      .set({ lastProbedAt, lastProbeError, updatedAt: new Date() })
      .where(and(eq(models.id, modelId), isNull(models.deletedAt)));
  }

  async softDeleteModel(modelId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(models)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(models.id, modelId), isNull(models.deletedAt)));
  }

  // -------------------------------------------------------------------------
  // 4.2 引用统计 / 本地工作区可访问性
  // TODO（PR-N）: ph_runs.experiments / ph_runs.optimizations /
  //   ph_releases.release_line_events 接入后，把以下方法改成真实 JOIN。当前所有计数返回 0，
  //   保证 list / delete / reference-confirm 流程已经按 SPEC 21 §7 的形态接好，等表上线即填实数据。
  // -------------------------------------------------------------------------
  async getActiveReferenceCounts(_modelId: string): Promise<ModelReferenceCounts> {
    return { experiments: 0, optimizations: 0, canaryReleases: 0, productionReleases: 0 };
  }

  async getTotalReferenceCounts(_modelId: string): Promise<ModelReferenceCounts> {
    return { experiments: 0, optimizations: 0, canaryReleases: 0, productionReleases: 0 };
  }

  async findProjectAccess(
    _actorUserId: string,
    projectId: string,
    _isSuperAdmin: boolean,
  ): Promise<ModelProjectAccessRow | null> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // 4.3 模型上下文字典（保留原有方法）
  // -------------------------------------------------------------------------
  async findContextWindows(query: ListModelContextWindowsQueryDto): Promise<ModelContextWindowRow[]> {
    const rows = this.db.select().from(modelContextWindows);
    const filtered = query.search ? rows.where(ilike(modelContextWindows.providerModelId, `%${query.search}%`)) : rows;
    return filtered.orderBy(modelContextWindows.providerModelId).limit(query.limit);
  }

  async findContextWindowByProviderModelId(providerModelId: string): Promise<ModelContextWindowRow | undefined> {
    const result = await this.db
      .select()
      .from(modelContextWindows)
      .where(eq(modelContextWindows.providerModelId, providerModelId))
      .limit(1);
    return result[0];
  }

  async upsertContextWindow(dto: UpsertModelContextWindowDto, actorUserId: string): Promise<ModelContextWindowRow> {
    const result = await this.db
      .insert(modelContextWindows)
      .values({
        providerModelId: dto.providerModelId,
        contextWindowTokens: dto.contextWindowTokens,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: modelContextWindows.providerModelId,
        set: {
          contextWindowTokens: dto.contextWindowTokens,
          updatedBy: actorUserId,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = result[0];
    if (!row) throw new Error('Failed to upsert model context window');
    return row;
  }
}
