import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  optimizationControlActionSchema,
  optimizationDevMockTimelineSchema,
  optimizationFieldWhitelistSchema,
  optimizationGoalSchema,
  optimizationRunConfigSchema,
  optimizationSummarySchema,
  DEFAULT_PROMPT_LANGUAGE,
  type OptimizationBestMetricsDto,
  type OptimizationSummaryDto,
  type OptimizationControlActionDto,
  type OptimizationDetailDto,
  type OptimizationDetailExperimentConfigDto,
  type OptimizationDetailGoalProgressDto,
  type OptimizationDetailGoalScopeDto,
  type OptimizationDetailGoalsLineDto,
  type OptimizationDetailIterationConfigDto,
  type OptimizationDetailIterationRoundDto,
  type OptimizationDetailMetricComparisonDto,
  type OptimizationDetailRoundGoalChipDto,
  type OptimizationDetailTrendSeriesDto,
  type OptimizationDetailTrendSeriesKeyDto,
  type OptimizationDevMockTimelineDto,
  type OptimizationFieldWhitelistDto,
  type OptimizationGoalDto,
  type OptimizationListItemDto,
  type OptimizationListQueryDto,
  type OptimizationListResponseDto,
  type OptimizationRunConfigDto,
  type OptimizationStartingModeDto,
  type OptimizationStatusDto,
  type CreateOptimizationDto,
  type PromptLanguageDto,
  composeFullPrompt,
  outputSchemaToJsonSchema,
  promptLanguageSchema,
} from '@proofhound/shared';
import { createLogger } from '@proofhound/logger';
import { accessControl } from '../../common/access-control';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { isUniqueViolation } from '../../common/errors/db-error';
import { aggregateExperimentMetrics } from '../experiment/experiment.aggregator';
import { ExperimentRepository } from '../experiment/experiment.repository';
import { ExperimentService } from '../experiment/experiment.service';
import { PromptRepository } from '../prompt/prompt.repository';
import { RunResultService } from '../run-result/run-result.service';
import { OptimizationLauncher } from './optimization.launcher';
import { SYSTEM_ACTOR_OPTIMIZATION } from './optimization.workflow';
import {
  OptimizationRepository,
  type OptimizationProjectAccessRow,
  type OptimizationRoundExperimentRow,
  type OptimizationRoundLlmRow,
  type OptimizationRoundStepKind,
  type OptimizationRoundStepRow,
  type OptimizationRow,
} from './optimization.repository';

// 详情页聚合 helper 内部使用的 logger;独立 binding 便于在生产关闭 debug 后零成本,
// 与 class 内 this.logger 同源(都是 pino instance)。
const detailHelperLogger = createLogger('optimization.service.detail', { service: 'server' });

type AuditSource = 'api' | 'mcp' | 'system';
type BestMetricMap = NonNullable<OptimizationBestMetricsDto>;

interface EffectiveBestCandidate {
  metrics: BestMetricMap;
  promptVersionId: string | null;
  promptVersionNumber: number | null;
  generatedAtRoundLabel: string;
  generatedAtRoundIndex: number | null;
  experimentId: string | null;
  experimentName: string | null;
  isBaseline: boolean;
}

interface PromptBodyEntry {
  body: string | null;
  versionNumber: number;
  outputSchema: unknown;
  promptLanguage?: string | null;
}

@Injectable()
export class OptimizationService {
  private readonly logger = createLogger('optimization.service', { service: 'server' });

  constructor(
    private readonly repo: OptimizationRepository,
    private readonly launcher: OptimizationLauncher,
    private readonly experimentRepo: ExperimentRepository,
    private readonly experimentService: ExperimentService,
    private readonly runResults: RunResultService,
    private readonly promptRepo: PromptRepository,
  ) {}

  async listOptimizations(
    projectId: string,
    actor: CurrentUserPayload,
    query: OptimizationListQueryDto = {},
  ): Promise<OptimizationListResponseDto> {
    await this.getAccessibleProject(projectId, actor);

    const allRows = await this.repo.listOptimizations(projectId);
    // 按需为每个 optimization 加载 round experiments + round_steps:
    // - experiments 填充 trend（LiveCard sparkline）
    // - round_steps 让列表在分析/生成/子实验刚启动时也能显示最新轮次与更新时间
    const allItems: OptimizationListItemDto[] = [];
    for (const row of allRows) {
      const [rounds, roundSteps] = await Promise.all([
        this.repo.listRoundExperimentsForOptimization(row.id),
        this.repo.listRoundStepsForOptimization(row.id),
      ]);
      const liveRounds = await this.withLiveRoundMetrics(rounds);
      const liveProjection = deriveLiveProjection(row, liveRounds, roundSteps);
      const { values: trend, hasBaseline } = this.deriveListTrend(row, liveRounds);
      allItems.push(
        this.toListItem(row, {
          trend,
          trendHasBaseline: hasBaseline,
          currentRound: liveProjection.currentRound,
          updatedAt: liveProjection.updatedAt,
        }),
      );
    }
    const filtered = this.filterItems(allItems, query);
    const data = this.sortItems(filtered, query.sort);

    return { data, total: data.length };
  }

  async getOptimization(
    projectId: string,
    optimizationId: string,
    actor: CurrentUserPayload,
  ): Promise<OptimizationDetailDto> {
    await this.getAccessibleProject(projectId, actor);

    const row = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!row) {
      throw new NotFoundException(`Optimization ${optimizationId} not found`);
    }
    // 并发拉:experiments + LLM run_results + round_steps,三者合并喂 toDetail。
    const [rounds, llmRows, roundSteps] = await Promise.all([
      this.repo.listRoundExperimentsForOptimization(optimizationId),
      this.repo.listOptimizationLlmRunResults(optimizationId),
      this.repo.listRoundStepsForOptimization(optimizationId),
    ]);
    // running round 在 batch 聚合 step 之间补一层 live aggregate(对齐 ExperimentService.withLiveMetrics),
    // 让详情页 5 秒一刷的进度条 / 质量指标能跟着 run_results 实时推进,而不是卡在上次 batch 写回的快照。
    const liveRounds = await this.withLiveRoundMetrics(rounds);
    const versionIds = collectPromptVersionIds(row, liveRounds, llmRows);
    const promptBodyMap = await this.repo.loadPromptVersionsByIds(versionIds);
    return this.toDetail(row, { rounds: liveRounds, llmRows, roundSteps, promptBodyMap });
  }

  // 与 ExperimentService.withLiveMetrics 同构:仅对 running round 触发,从 ph_runs.run_results 实时聚合
  // 覆盖 processedSamples / failedSamples / metrics,让 deriveTrendSeries / deriveRoundDetails /
  // buildExperimentResult / goalChips 一并跟着动。聚合空(run_results 还无 terminal row)→ 保留快照,
  // 避免把进度回退成 0/null。终态 round 不动,继续读快照,避免每次 GET 都 GROUP BY。
  private async withLiveRoundMetrics(
    rounds: OptimizationRoundExperimentRow[],
  ): Promise<OptimizationRoundExperimentRow[]> {
    if (rounds.length === 0) return rounds;
    return Promise.all(
      rounds.map(async (round) => {
        if (round.status !== 'running' || !round.experimentId) return round;
        const [aggRows, latency] = await Promise.all([
          this.runResults.aggregateExperiment(round.experimentId),
          this.runResults.aggregateExperimentLatency(round.experimentId),
        ]);
        const live = aggregateExperimentMetrics(aggRows, latency);
        // 聚合空(run_results 还无 terminal row)→ 保留 experiments 快照,避免把进度回退到 0/null
        if (live.totalCount === 0) return round;
        return {
          ...round,
          processedSamples: live.totalCount,
          failedSamples: live.failedCount,
          metrics: live.metrics,
        };
      }),
    );
  }

  async createOptimization(
    projectId: string,
    body: CreateOptimizationDto,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<OptimizationListItemDto> {
    await this.getWritableProject(projectId, actor);
    const existing = await this.repo.findOptimizationByProjectAndName(projectId, body.name);
    if (existing) {
      throw new ConflictException('optimization_name_taken');
    }

    let resolvedPromptId = body.promptId ?? null;
    let resolvedBaseVersionId = body.baseVersionId ?? null;
    const requestedPromptLanguage = body.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;

    if (
      body.startingMode === 'from_experiment' &&
      body.sourceExperimentId &&
      (!resolvedPromptId || !resolvedBaseVersionId)
    ) {
      const sourceExperiment = await this.experimentRepo.findExperimentById(projectId, body.sourceExperimentId);
      if (!sourceExperiment) {
        throw new BadRequestException(`Source experiment ${body.sourceExperimentId} not found`);
      }
      resolvedBaseVersionId ??= sourceExperiment.promptVersionId;
      resolvedPromptId ??= sourceExperiment.promptId;
    }

    // SPEC 25 §2:from_prompt_version 起点的基线版本由系统自动选取
    //   优先 prompts.current_online_version_id;无则取该 prompt 最新版本号的版本。
    if (body.startingMode === 'from_prompt_version' && resolvedPromptId && !resolvedBaseVersionId) {
      resolvedBaseVersionId = await this.repo.findActiveVersionIdForPrompt(resolvedPromptId);
      if (!resolvedBaseVersionId) {
        throw new BadRequestException(`Prompt ${resolvedPromptId} has no usable version for optimization`);
      }
    }

    // SPEC 25 §2.1:from_dataset_only 起点自动创建一个空 prompt 作为承载实体,
    // baseVersionId 保持 null 等 workflow.generateFirstVersionStep 回填。
    if (body.startingMode === 'from_dataset_only' && !resolvedPromptId) {
      if (!body.analysisModelId) {
        throw new BadRequestException('analysis_model_required_for_dataset_only_starting_mode');
      }
      if (resolvedBaseVersionId) {
        throw new BadRequestException('base_version_must_be_unset_for_dataset_only_starting_mode');
      }
      const dataset = await this.repo.findDatasetForOptimization(projectId, body.datasetId);
      if (!dataset) {
        throw new BadRequestException(`Dataset ${body.datasetId} not found`);
      }
      resolvedPromptId = await this.createPlaceholderPromptWithRetry({
        projectId,
        datasetName: dataset.name,
        optimizationName: body.name,
        datasetId: body.datasetId,
        promptLanguage: requestedPromptLanguage,
        createdBy: actor.sub,
      });
    }

    const resolvedPromptLanguage = await this.resolvePromptLanguage(body.promptLanguage, resolvedBaseVersionId);

    const insertedId = await this.insertOptimizationOrThrowNameConflict({
      projectId,
      name: body.name,
      description: body.description ?? null,
      optimizationHint: normalizeOptimizationHint(body.optimizationHint),
      strategy: body.strategy,
      strategyConfig: body.strategyConfig ?? {},
      startingMode: body.startingMode,
      sourceExperimentId: body.sourceExperimentId ?? null,
      promptId: resolvedPromptId,
      baseVersionId: resolvedBaseVersionId,
      datasetId: body.datasetId,
      experimentModelId: body.experimentModelId,
      analysisModelId: body.analysisModelId,
      promptLanguage: resolvedPromptLanguage,
      status: 'running',
      goals: body.goals,
      fieldWhitelist: body.fieldWhitelist ?? null,
      runConfig: body.runConfig ?? {},
      maxRounds: body.loopLimits.maxRounds,
      createdBy: actor.sub,
    });

    let workflowId: string | null = null;
    try {
      workflowId = await this.launcher.launch(insertedId);
    } catch (error) {
      const reason = `launch_failed: ${(error as Error).message}`;
      const now = new Date();
      await this.repo.updateOptimization(projectId, insertedId, {
        status: 'failed',
        controlState: null,
        finishedAt: now,
        summary: { kind: 'failed', reason, finalizedAt: now.toISOString() },
      });
      throw error;
    }

    const inserted = await this.repo.findOptimizationById(projectId, insertedId);
    if (!inserted) {
      throw new NotFoundException(`Optimization ${insertedId} not found after insert`);
    }

    return this.toListItem(inserted);
  }

  private async resolvePromptLanguage(
    requested: PromptLanguageDto | undefined,
    baseVersionId: string | null,
  ): Promise<PromptLanguageDto> {
    if (requested) return requested;
    if (!baseVersionId) return DEFAULT_PROMPT_LANGUAGE;
    const stored = await this.repo.findPromptVersionLanguage(baseVersionId);
    const parsed = promptLanguageSchema.safeParse(stored);
    return parsed.success ? parsed.data : DEFAULT_PROMPT_LANGUAGE;
  }

  private async insertOptimizationOrThrowNameConflict(
    input: Parameters<OptimizationRepository['insertOptimization']>[0],
  ): Promise<string> {
    try {
      return await this.repo.insertOptimization(input);
    } catch (error) {
      if (isOptimizationNameUniqueViolation(error)) {
        throw new ConflictException('optimization_name_taken');
      }
      throw error;
    }
  }

  // SPEC 25 §2.1:from_dataset_only 起步时自动建空 prompt 承载首版。
  // 命名规则 `优化-${datasetName}-${ISO 时间到分钟}`;撞 prompts_project_name_unique 时
  // 附 8 字符 hash 后缀重试 1 次;二次仍冲突 → 抛 prompt_name_collision_v1。
  private async createPlaceholderPromptWithRetry(input: {
    projectId: string;
    datasetName: string;
    optimizationName: string;
    datasetId: string;
    promptLanguage: PromptLanguageDto;
    createdBy: string;
  }): Promise<string> {
    const baseName = buildOptimizationPromptName(input.datasetName, new Date(), input.promptLanguage);
    try {
      return await this.promptRepo.createPlaceholderPromptForOptimization({
        projectId: input.projectId,
        name: baseName,
        defaultDatasetId: input.datasetId,
        createdBy: input.createdBy,
      });
    } catch (err) {
      if (!isPromptNameUniqueViolation(err)) throw err;
      const suffix = `-${shortHash(`${input.optimizationName}|${Date.now()}`)}`;
      try {
        return await this.promptRepo.createPlaceholderPromptForOptimization({
          projectId: input.projectId,
          name: `${baseName}${suffix}`,
          defaultDatasetId: input.datasetId,
          createdBy: input.createdBy,
        });
      } catch (err2) {
        if (isPromptNameUniqueViolation(err2)) {
          throw new ConflictException('prompt_name_collision_v1');
        }
        throw err2;
      }
    }
  }

  async controlOptimization(
    projectId: string,
    optimizationId: string,
    action: OptimizationControlActionDto,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<OptimizationListItemDto> {
    await this.getWritableProject(projectId, actor);
    const parsedAction = optimizationControlActionSchema.parse(action);

    const current = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!current) {
      throw new NotFoundException(`Optimization ${optimizationId} not found`);
    }

    const patch = this.getControlPatch(parsedAction, current);
    await this.repo.updateOptimization(projectId, optimizationId, patch);

    // SPEC 25 §7 双路径联动: stop/cancel 立即调子实验 controlExperiment, 不阻塞父 control 落库
    // resume 时不在此处联动 — 子实验恢复由 workflow 在 isResumeRound 分支通过 controlChildExperimentStep 起
    if (parsedAction === 'stop' || parsedAction === 'cancel') {
      await this.tryLinkChildExperimentControl(optimizationId, parsedAction);
    }

    if (parsedAction === 'resume') {
      await this.launcher.resume(optimizationId);
    }

    const updated = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!updated) {
      throw new NotFoundException(`Optimization ${optimizationId} not found after update`);
    }

    return this.toListItem(updated);
  }

  // SPEC 25 §7: stop/cancel 父优化时即时联动 active 子实验。Best-effort:
  //   - 没有 active 子实验(已 terminal / 还未建)→ no-op
  //   - service 抛 Conflict / NotFound → warn 吞掉(workflow poll 兜底)
  //   - 其它错 → warn 吞掉(不抛出避免阻塞父 control_state 落库)
  private async tryLinkChildExperimentControl(optimizationId: string, action: 'stop' | 'cancel'): Promise<void> {
    const activeChild = await this.repo.findActiveChildExperiment(optimizationId);
    if (!activeChild) return;
    try {
      await this.experimentService.controlExperiment(
        activeChild.projectId,
        activeChild.id,
        action,
        SYSTEM_ACTOR_OPTIMIZATION,
        'system',
      );
      this.logger.info(
        {
          optimizationId,
          childExperimentId: activeChild.id,
          roundIndex: activeChild.roundIndex,
          action,
        },
        'optimization_child_control_linked_from_service',
      );
    } catch (error) {
      const level: 'skipped' | 'failed' =
        error instanceof ConflictException || error instanceof NotFoundException ? 'skipped' : 'failed';
      this.logger.warn(
        {
          optimizationId,
          childExperimentId: activeChild.id,
          action,
          err: (error as Error).message,
        },
        `optimization_child_control_${level}`,
      );
    }
  }

  async deleteOptimization(
    projectId: string,
    optimizationId: string,
    actor: CurrentUserPayload,
    source: AuditSource = 'api',
  ): Promise<void> {
    void source;
    await this.getWritableProject(projectId, actor);

    const row = await this.repo.findOptimizationById(projectId, optimizationId);
    if (!row) {
      throw new NotFoundException(`Optimization ${optimizationId} not found`);
    }

    await this.repo.hardDeleteOptimization(projectId, optimizationId);
  }

  // ----------------------------- helpers -----------------------------

  private async getAccessibleProject(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<OptimizationProjectAccessRow> {
    accessControl.assertCan(actor, 'project_read', { projectId });
    const project = await this.repo.findProjectAccess(actor.sub, projectId, actor.isSuperAdmin);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  private async getWritableProject(
    projectId: string,
    actor: CurrentUserPayload,
  ): Promise<OptimizationProjectAccessRow> {
    accessControl.assertCan(actor, 'project_write', { projectId });
    return this.getAccessibleProject(projectId, actor);
  }

  private getControlPatch(action: OptimizationControlActionDto, row: OptimizationRow) {
    const status = row.status as OptimizationStatusDto;
    const now = new Date();

    if (action === 'stop') {
      if (status !== 'running') {
        throw new ConflictException('optimization_stop_invalid_status');
      }
      // 抢占式终态化:同时写 status='stopped' + control_state='stop' + finished_at。
      // workflow 当前 LLM step 跑完后会调 finalize,但 repo.finalize 有 status='running' 守卫,
      // 第二次写会被跳过——避免覆盖 service 已经写好的终态、避免 finished_at 漂移。
      // control_state 保留,workflow 在下一轮顶部读到 status 已终态时直接退出。
      return {
        status: 'stopped' as const,
        controlState: 'stop' as const,
        finishedAt: now,
        updatedAt: now,
      };
    }

    if (action === 'resume') {
      if (status !== 'stopped') {
        throw new ConflictException('optimization_resume_invalid_status');
      }
      return {
        status: 'running' as const,
        controlState: 'resume' as const,
        startedAt: row.startedAt ?? now,
        finishedAt: null,
        updatedAt: now,
      };
    }

    if (status === 'success' || status === 'cancelled') {
      throw new ConflictException('optimization_cancel_invalid_status');
    }
    // cancel 同样抢占式终态化(无论原 status 是 running 还是 stopped/failed)。
    return {
      status: 'cancelled' as const,
      controlState: 'cancel' as const,
      finishedAt: now,
      updatedAt: now,
    };
  }

  private toListItem(
    row: OptimizationRow,
    options: {
      trend?: number[] | null;
      trendHasBaseline?: boolean;
      currentRound?: number;
      updatedAt?: Date;
    } = {},
  ): OptimizationListItemDto {
    return {
      trend: options.trend ?? null,
      trendHasBaseline: options.trendHasBaseline ?? false,
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description,
      strategy: row.strategy,
      startingMode: row.startingMode as OptimizationStartingModeDto,
      status: row.status as OptimizationStatusDto,
      controlState: row.controlState as OptimizationListItemDto['controlState'],

      sourceExperimentId: row.sourceExperimentId,
      sourceExperimentName: row.sourceExperimentName,
      promptId: row.promptId,
      promptName: row.promptName,
      baseVersionId: row.baseVersionId,
      baseVersionNumber: row.baseVersionNumber,
      datasetId: row.datasetId,
      datasetName: row.datasetName,
      datasetSamples: row.datasetSamples,
      experimentModelId: row.experimentModelId,
      experimentModelName: row.experimentModelName,
      analysisModelId: row.analysisModelId,
      analysisModelName: row.analysisModelName,
      promptLanguage: this.parsePromptLanguage(row.promptLanguage),

      goals: this.parseGoals(row.goals),
      fieldWhitelist: this.parseFieldWhitelist(row.fieldWhitelist),
      runConfig: this.parseRunConfig(row.runConfig),
      maxRounds: row.maxRounds,
      currentRound: options.currentRound ?? row.currentRound,
      bestVersionId: row.bestVersionId,
      bestVersionNumber: row.bestVersionNumber,
      bestMetrics: this.parseBestMetrics(row.bestMetrics),
      summary: this.parseSummary(row.summary),
      analysisFailureReason: this.parseAnalysisFailureReason(row.analysisFailureReason),

      dbosWorkflowId: row.dbosWorkflowId,
      createdBy: row.createdBy,
      createdByDisplayName: row.createdByDisplayName,
      createdByUsername: row.createdByUsername,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: (options.updatedAt ?? row.updatedAt).toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private toDetail(
    row: OptimizationRow,
    aggregation: {
      rounds: OptimizationRoundExperimentRow[];
      llmRows: OptimizationRoundLlmRow[];
      roundSteps?: OptimizationRoundStepRow[];
      promptBodyMap?: Map<string, PromptBodyEntry>;
    } = { rounds: [], llmRows: [], roundSteps: [] },
  ): OptimizationDetailDto {
    const roundSteps = aggregation.roundSteps ?? [];
    const hasSourceMetrics =
      row.sourceExperimentMetrics &&
      typeof row.sourceExperimentMetrics === 'object' &&
      Object.keys(row.sourceExperimentMetrics as Record<string, unknown>).length > 0;
    // 真实数据来源:experiments ∪ round_steps ∪ source experiment metrics(基线)。任一非空都走真聚合。
    // round_steps 的存在让 prepareRoundImpl 一开始(error_analysis=running)
    // 就能让该轮在详情页可见,不必等子实验创建后才出卡片;
    // 有 baseline metrics 时即便 0 round 也走真聚合,让指标趋势卡片立即可见基线首点。
    const realRounds = aggregation.rounds.length > 0 || roundSteps.length > 0 || hasSourceMetrics;
    this.logger.debug(
      {
        optimizationId: row.id,
        status: row.status,
        roundsLen: aggregation.rounds.length,
        llmRowsLen: aggregation.llmRows.length,
        roundStepsLen: roundSteps.length,
        llmRowsBySource: aggregation.llmRows.reduce<Record<string, number>>((acc, r) => {
          acc[r.source] = (acc[r.source] ?? 0) + 1;
          return acc;
        }, {}),
        realRounds,
      },
      'optimization_detail_aggregate_start',
    );
    const liveProjection = deriveLiveProjection(row, aggregation.rounds, roundSteps);
    const listTrend = this.deriveListTrend(row, aggregation.rounds);
    const base = this.toListItem(row, {
      trend: listTrend.values,
      trendHasBaseline: listTrend.hasBaseline,
      currentRound: liveProjection.currentRound,
      updatedAt: liveProjection.updatedAt,
    });
    const ownerHandle = row.createdByUsername ? `@${row.createdByUsername}` : (row.createdByDisplayName ?? '—');
    const startedAt = row.startedAt;
    const finishedAt = row.finishedAt;
    const elapsedMs = startedAt ? Math.max(0, (finishedAt ?? new Date()).getTime() - startedAt.getTime()) : null;
    const goalScope = this.deriveGoalScope(base.goals);
    const goalsLines = this.deriveGoalsLines(base.goals);
    const experimentConfig = this.deriveExperimentConfig(row, base.runConfig);
    const iterationConfig = this.deriveIterationConfig(row, base.runConfig);
    const sourceMetrics =
      row.sourceExperimentMetrics && typeof row.sourceExperimentMetrics === 'object'
        ? (row.sourceExperimentMetrics as Record<string, unknown>)
        : null;
    const derivedBaseline = this.deriveBaseline(row, sourceMetrics, aggregation.promptBodyMap ?? new Map());
    const derivedBestRoundLabel = row.bestVersionNumber ? `v${row.bestVersionNumber}` : null;

    if (realRounds) {
      // 真聚合
      const trend = this.deriveTrendSeries(base.goals, aggregation.rounds, sourceMetrics, base.startingMode);
      const rounds = this.deriveRoundDetails(
        aggregation.rounds,
        aggregation.llmRows,
        roundSteps,
        aggregation.promptBodyMap ?? new Map(),
        row.baseVersionId,
        base.goals,
        sourceMetrics,
        base.startingMode,
      );
      const effectiveBest = this.deriveEffectiveBest(
        row,
        aggregation.rounds,
        base.goals,
        base.bestMetrics,
        sourceMetrics,
        base.startingMode,
      );
      const goalProgress = this.deriveGoalProgress(base.goals, effectiveBest?.metrics ?? null);
      const bestVersion = this.deriveBestVersion(row, effectiveBest);
      const bestRoundLabel = bestVersion ? bestVersion.generatedAtRoundLabel : derivedBestRoundLabel;
      const baseline = derivedBaseline;

      return {
        ...base,
        optimizationHint: normalizeOptimizationHint(row.optimizationHint),
        ownerHandle,
        elapsedMs,
        experimentConfig,
        iterationConfig,
        goalScope,
        goalsLines,
        controlStrip: null,
        trend,
        trendBaselineRef: null,
        bestRoundLabel,
        rounds,
        baseline,
        goalProgress,
        bestVersion,
      };
    }

    // 无真数据 → 走 dev mock 兜底（dev seed 用于 demo / e2e）
    const mock = this.extractDevMockTimeline(base.runConfig);
    this.logger.debug(
      {
        optimizationId: row.id,
        reason: 'no_real_rounds',
        hasDevMock: !!mock,
        mockRoundsLen: mock?.rounds?.length ?? 0,
      },
      'optimization_detail_using_dev_mock',
    );
    const baseline =
      derivedBaseline && mock?.baselineMetrics
        ? { ...derivedBaseline, metrics: mock.baselineMetrics }
        : derivedBaseline;

    return {
      ...base,
      optimizationHint: normalizeOptimizationHint(row.optimizationHint),
      ownerHandle,
      elapsedMs,
      experimentConfig,
      iterationConfig,
      goalScope,
      goalsLines,
      controlStrip: mock?.controlStrip ?? null,
      trend: mock?.trend ?? [],
      trendBaselineRef: mock?.trendBaselineRef ?? null,
      bestRoundLabel: mock?.bestRoundLabel ?? derivedBestRoundLabel,
      rounds: mock?.rounds ?? [],
      baseline,
      goalProgress: mock?.goalProgress ?? [],
      bestVersion: mock?.bestVersion ?? null,
    };
  }

  private deriveListTrend(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
  ): { values: number[] | null; hasBaseline: boolean } {
    const goals = this.parseGoals(row.goals);
    const primary = goals[0]?.metric;
    if (!primary) return { values: null, hasBaseline: false };
    const baselineMetrics =
      row.sourceExperimentMetrics && typeof row.sourceExperimentMetrics === 'object'
        ? (row.sourceExperimentMetrics as Record<string, unknown>)
        : null;
    const sortedRounds = rounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);
    if (row.startingMode === 'from_dataset_only') {
      const baselineRound = sortedRounds.find((r) => r.roundIndex === 0);
      const baselineValue = extractMetric(baselineRound?.metrics ?? baselineMetrics, primary);
      const roundValues = sortedRounds
        .filter((r) => r.roundIndex > 0)
        .map((r) => extractMetric(r.metrics, primary))
        .filter((v): v is number => v !== null);
      const values: number[] = baselineValue !== null ? [baselineValue, ...roundValues] : roundValues;
      return { values: values.length > 0 ? values : null, hasBaseline: baselineValue !== null };
    }
    const baselineValue = baselineMetrics ? extractMetric(baselineMetrics, primary) : null;
    const hasBaseline = baselineValue !== null;
    const roundValues = sortedRounds
      .map((r) => extractMetric(r.metrics, primary))
      .filter((v): v is number => v !== null);
    const values: number[] = hasBaseline ? [baselineValue, ...roundValues] : roundValues;
    return { values: values.length > 0 ? values : null, hasBaseline };
  }

  private deriveTrendSeries(
    goals: OptimizationGoalDto[],
    rounds: OptimizationRoundExperimentRow[],
    baselineMetrics: Record<string, unknown> | null = null,
    startingMode?: OptimizationStartingModeDto | string,
  ): OptimizationDetailTrendSeriesDto[] {
    const sorted = rounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);
    const keyCandidates: Array<{ key: OptimizationDetailTrendSeriesKeyDto; metric: string }> = [
      { key: 'accuracy', metric: 'accuracy' },
      { key: 'recall', metric: 'recall' },
      { key: 'fpr', metric: 'fpr' },
    ];
    const series: OptimizationDetailTrendSeriesDto[] = [];
    for (const { key, metric } of keyCandidates) {
      const datasetBaselineRound =
        startingMode === 'from_dataset_only' ? sorted.find((r) => r.roundIndex === 0) : undefined;
      const baselineValue =
        startingMode === 'from_dataset_only'
          ? extractMetric(datasetBaselineRound?.metrics ?? baselineMetrics, metric)
          : baselineMetrics
            ? extractMetric(baselineMetrics, metric)
            : null;
      const optimizationRounds = startingMode === 'from_dataset_only' ? sorted.filter((r) => r.roundIndex > 0) : sorted;
      const roundValues = optimizationRounds
        .map((r) => extractMetric(r.metrics, metric))
        .filter((v): v is number => v !== null);
      const hasBaseline = baselineValue !== null;
      const values: number[] = hasBaseline ? [baselineValue, ...roundValues] : roundValues;
      if (values.length === 0) continue;
      const matchingGoal = goals.find((g) => g.metric === metric);
      // bestRoundIndex 仍指向 round 集合内的最佳序号（不含 baseline），保持 prop 语义
      let bestRoundIndex: number | undefined;
      if (roundValues.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < roundValues.length; i++) {
          if (
            matchingGoal?.comparator === 'lte'
              ? roundValues[i]! < roundValues[bestIdx]!
              : roundValues[i]! > roundValues[bestIdx]!
          ) {
            bestIdx = i;
          }
        }
        bestRoundIndex = bestIdx;
      }
      series.push({
        key,
        labelKey: `optimizations.metrics.${key}`,
        betterIsLower: matchingGoal?.comparator === 'lte',
        values,
        target: matchingGoal?.target,
        bestRoundIndex,
        hasBaseline,
      });
    }
    return series;
  }

  private deriveRoundDetails(
    rounds: OptimizationRoundExperimentRow[],
    llmRows: OptimizationRoundLlmRow[],
    roundSteps: OptimizationRoundStepRow[],
    promptBodyMap: Map<string, PromptBodyEntry>,
    baseVersionId: string | null,
    goals: OptimizationGoalDto[],
    baselineMetrics: Record<string, unknown> | null,
    startingMode: OptimizationStartingModeDto | string,
  ): OptimizationDetailIterationRoundDto[] {
    const llmByRound = new Map<number, OptimizationRoundLlmRow[]>();
    for (const llm of llmRows) {
      const arr = llmByRound.get(llm.roundIndex) ?? [];
      arr.push(llm);
      llmByRound.set(llm.roundIndex, arr);
    }
    // experiments 行按 roundIndex 索引,缺失时(分析/生成阶段)走 stepsByRound 单独出卡片
    const experimentByRound = new Map<number, OptimizationRoundExperimentRow>();
    for (const r of rounds) experimentByRound.set(r.roundIndex, r);
    const stepsByRound = new Map<number, OptimizationRoundStepRow[]>();
    for (const s of roundSteps) {
      const arr = stepsByRound.get(s.roundIndex) ?? [];
      arr.push(s);
      stepsByRound.set(s.roundIndex, arr);
    }
    // 合并 roundIndex 集合 → 排序后逐个生成卡片
    const allIndexes = new Set<number>([...rounds.map((r) => r.roundIndex), ...roundSteps.map((s) => s.roundIndex)]);
    const sortedIndexes = Array.from(allIndexes).sort((a, b) => a - b);
    // 同时维护一份 sortedExperiments(只含真正有 experiment 行的),仅作为历史数据兜底。
    // 新数据优先用 prompt_versions.parent_version_id / generate run_result.prompt_version_id,
    // 让 diff 对齐“当前版本实际从哪个 prompt 生成”。
    const sortedExperiments = rounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);

    return sortedIndexes.map((idx): OptimizationDetailIterationRoundDto => {
      const experiment = experimentByRound.get(idx) ?? null;
      const isDatasetBaseline = startingMode === 'from_dataset_only' && idx === 0;
      const stepsForRound = stepsByRound.get(idx) ?? [];
      const stepDtos = mapStepRowsToDtos(stepsForRound);
      // status 派生:有 steps 数据时走 steps 派生(分析期 / 生成期看不到 experiment 行);
      // 否则用 experiment.status 兜底。
      const status = isDatasetBaseline
        ? deriveDatasetBaselineStatus(stepDtos, experiment?.status)
        : deriveRoundStatusFromSteps(stepDtos, experiment?.status);
      const llms = llmByRound.get(idx) ?? [];
      const analysis = llms.find((r) => r.source === 'optimization_analysis');
      const generate = llms.find((r) => r.source === 'optimization_generate');
      this.logger.debug(
        {
          roundIndex: idx,
          status,
          hasAnalysis: !!analysis,
          hasGenerate: !!generate,
          hasExperiment: !!experiment,
          llmRowsForRoundLen: llms.length,
          stepsForRoundLen: stepDtos.length,
          analysisStatus: analysis?.status,
          generateStatus: generate?.status,
        },
        'optimization_detail_round_derive',
      );
      const analysisText = analysis ? extractAnalysisSummary(analysis, idx) : undefined;
      const generateText = isDatasetBaseline ? extractGenerateSummary(generate, idx) : undefined;
      const errorPatterns = isDatasetBaseline ? undefined : extractErrorPatterns(analysis, idx);
      const improvementSuggestions = isDatasetBaseline ? undefined : extractImprovementSuggestions(analysis, idx);
      const prevVersionId = isDatasetBaseline
        ? null
        : resolvePromptDiffBaseVersionId(experiment, generate, sortedExperiments, baseVersionId);
      const promptDiff = experiment
        ? buildPromptDiff(experiment, generate, prevVersionId, promptBodyMap)
        : buildPromptDiffWithoutExperiment(generate, idx, prevVersionId, promptBodyMap);
      const experimentResult = experiment ? buildExperimentResult(experiment, baselineMetrics) : undefined;
      const goalChips = this.buildRoundGoalChips(goals, experiment);
      const { autoPatched, patchedVariables } = extractAutoPatchInfo(generate);
      return {
        index: idx,
        status,
        isBaseline: isDatasetBaseline || experiment?.isBaseline === true ? true : undefined,
        kindLabel: isDatasetBaseline ? 'dataset baseline' : `Round ${idx}`,
        startedAt: experiment?.startedAt?.toISOString(),
        metrics: experiment ? extractRoundMetricCells(experiment.metrics) : [],
        promptVersionId: experiment?.promptVersionId ?? null,
        experimentId: experiment?.experimentId ?? null,
        summaryFallback: generateText ?? analysisText,
        errorPatterns,
        improvementSuggestions,
        promptDiff,
        experimentResult,
        steps: stepDtos,
        goalChips,
        autoPatched,
        patchedVariables,
      };
    });
  }

  private deriveGoalProgress(
    goals: OptimizationGoalDto[],
    bestMetrics: OptimizationBestMetricsDto,
  ): OptimizationDetailGoalProgressDto[] {
    return goals.map((goal) => {
      const current = typeof bestMetrics?.[goal.metric] === 'number' ? (bestMetrics[goal.metric] as number) : null;
      const achieved: OptimizationDetailGoalProgressDto['achieved'] =
        current === null
          ? 'miss'
          : goal.comparator === 'gte'
            ? current >= goal.target
              ? 'hit'
              : 'miss'
            : goal.comparator === 'gt'
              ? current > goal.target
                ? 'hit'
                : 'miss'
              : current <= goal.target
                ? 'hit'
                : 'miss';
      const comparatorText = goal.comparator === 'gte' ? '≥' : goal.comparator === 'gt' ? '>' : '≤';
      const percent =
        current === null ? 0 : Math.min(100, Math.max(0, Math.round((current / Math.max(0.0001, goal.target)) * 100)));
      return {
        label: this.formatMetricLabel(goal.metric),
        targetText: `${comparatorText} ${goal.target}`,
        currentText: current === null ? '—' : current.toFixed(3),
        achieved,
        percent,
      };
    });
  }

  // 每轮卡片头部右上角的"目标 vs 当前轮"chip 列表。
  // overall scope 取 metrics[goal.metric];class scope 从 metrics.perClass 按 label 取。
  private buildRoundGoalChips(
    goals: OptimizationGoalDto[],
    experiment: OptimizationRoundExperimentRow | null,
  ): OptimizationDetailRoundGoalChipDto[] {
    if (!experiment) return goals.map((g) => this.makeRoundGoalChip(g, null));
    const metricsObj =
      experiment.metrics && typeof experiment.metrics === 'object'
        ? (experiment.metrics as Record<string, unknown>)
        : null;
    if (!metricsObj) return goals.map((g) => this.makeRoundGoalChip(g, null));
    return goals.map((g) => {
      let current: number | null = null;
      if (g.scope === 'overall') {
        current = typeof metricsObj[g.metric] === 'number' ? (metricsObj[g.metric] as number) : null;
      } else {
        const perClass = Array.isArray(metricsObj['perClass']) ? metricsObj['perClass'] : [];
        const entry = perClass.find(
          (x): x is Record<string, unknown> =>
            !!x && typeof x === 'object' && (x as Record<string, unknown>)['label'] === g.scope,
        );
        current = entry && typeof entry[g.metric] === 'number' ? (entry[g.metric] as number) : null;
      }
      return this.makeRoundGoalChip(g, current);
    });
  }

  private makeRoundGoalChip(goal: OptimizationGoalDto, current: number | null): OptimizationDetailRoundGoalChipDto {
    const comparator = goal.comparator === 'gte' ? '≥' : goal.comparator === 'gt' ? '>' : '≤';
    const achieved: OptimizationDetailRoundGoalChipDto['achieved'] =
      current === null
        ? 'miss'
        : goal.comparator === 'gte'
          ? current >= goal.target
            ? 'hit'
            : 'miss'
          : goal.comparator === 'gt'
            ? current > goal.target
              ? 'hit'
              : 'miss'
            : current <= goal.target
              ? 'hit'
              : 'miss';
    const metricLabel = this.formatMetricLabel(goal.metric);
    const label = goal.scope === 'overall' ? metricLabel : `${goal.scope} ${metricLabel}`;
    return {
      label,
      targetText: `${comparator} ${goal.target}`,
      currentText: current === null ? '—' : current.toFixed(3),
      achieved,
    };
  }

  private deriveEffectiveBest(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
    goals: OptimizationGoalDto[],
    bestMetrics: OptimizationBestMetricsDto,
    sourceMetrics: Record<string, unknown> | null,
    startingMode: OptimizationStartingModeDto | string,
  ): EffectiveBestCandidate | null {
    const persistedBest = this.derivePersistedBestCandidate(row, rounds, bestMetrics);
    const baselineBest = this.deriveBaselineBestCandidate(row, rounds, sourceMetrics, startingMode);
    if (!baselineBest) return persistedBest;
    if (!persistedBest) return baselineBest;
    return this.isBetterBestMetrics(baselineBest.metrics, persistedBest.metrics, goals) ? baselineBest : persistedBest;
  }

  private derivePersistedBestCandidate(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
    bestMetrics: OptimizationBestMetricsDto,
  ): EffectiveBestCandidate | null {
    if (!row.bestVersionId || !bestMetrics) return null;
    const bestRound = rounds.find((r) => r.promptVersionId === row.bestVersionId);
    return {
      metrics: bestMetrics,
      promptVersionId: row.bestVersionId,
      promptVersionNumber: row.bestVersionNumber,
      generatedAtRoundLabel: row.bestVersionNumber ? `v${row.bestVersionNumber}` : '—',
      generatedAtRoundIndex: bestRound?.roundIndex ?? null,
      experimentId: bestRound?.experimentId ?? null,
      experimentName: bestRound?.experimentName ?? null,
      isBaseline: false,
    };
  }

  private deriveBaselineBestCandidate(
    row: OptimizationRow,
    rounds: OptimizationRoundExperimentRow[],
    sourceMetrics: Record<string, unknown> | null,
    startingMode: OptimizationStartingModeDto | string,
  ): EffectiveBestCandidate | null {
    const baselineRound = rounds.find(
      (r) => r.isBaseline === true || (startingMode === 'from_dataset_only' && r.roundIndex === 0),
    );
    const metrics = this.parseBestMetrics(baselineRound?.metrics ?? sourceMetrics);
    if (!metrics) return null;
    return {
      metrics,
      promptVersionId: baselineRound?.promptVersionId ?? row.sourceExperimentPromptVersionId ?? row.baseVersionId,
      promptVersionNumber:
        baselineRound?.promptVersionNumber ?? row.sourceExperimentPromptVersionNumber ?? row.baseVersionNumber,
      generatedAtRoundLabel: 'baseline',
      generatedAtRoundIndex: 0,
      experimentId: baselineRound?.experimentId ?? row.sourceExperimentId,
      experimentName: baselineRound?.experimentName ?? row.sourceExperimentName,
      isBaseline: true,
    };
  }

  private isBetterBestMetrics(candidate: BestMetricMap, current: BestMetricMap, goals: OptimizationGoalDto[]): boolean {
    if (goals.length === 0) return false;
    const candidateUnmet = this.unmetGoalCount(candidate, goals);
    const currentUnmet = this.unmetGoalCount(current, goals);
    if (candidateUnmet !== currentUnmet) return candidateUnmet < currentUnmet;
    return this.directionalGoalScore(candidate, goals) > this.directionalGoalScore(current, goals);
  }

  private unmetGoalCount(metrics: BestMetricMap, goals: OptimizationGoalDto[]): number {
    let count = 0;
    for (const goal of goals) {
      const value = this.readBestMetric(metrics, goal);
      const hit =
        value !== null &&
        (goal.comparator === 'gte'
          ? value >= goal.target
          : goal.comparator === 'gt'
            ? value > goal.target
            : value <= goal.target);
      if (!hit) count += 1;
    }
    return count;
  }

  private directionalGoalScore(metrics: BestMetricMap, goals: OptimizationGoalDto[]): number {
    let score = 0;
    for (const goal of goals) {
      const value = this.readBestMetric(metrics, goal);
      score += value === null ? Number.NEGATIVE_INFINITY : goal.comparator === 'lte' ? -value : value;
    }
    return score;
  }

  private readBestMetric(metrics: BestMetricMap, goal: OptimizationGoalDto): number | null {
    const value = metrics[goal.metric];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private deriveBestVersion(
    row: OptimizationRow,
    best: EffectiveBestCandidate | null,
  ): OptimizationDetailDto['bestVersion'] {
    if (!best) return null;
    const metricCells = Object.entries(best.metrics).map(([k, v]) => ({ label: this.formatMetricLabel(k), value: v }));
    return {
      promptRef: row.promptName ?? '—',
      promptVersion: best.promptVersionNumber ? `v${best.promptVersionNumber}` : '—',
      generatedAtRoundLabel: best.generatedAtRoundLabel,
      generatedAtRoundIndex: best.generatedAtRoundIndex,
      metrics: metricCells,
      experimentRef: best.experimentName ?? '—',
      promptVersionId: best.promptVersionId,
      experimentId: best.experimentId,
    };
  }

  private extractDevMockTimeline(runConfig: OptimizationRunConfigDto): OptimizationDevMockTimelineDto | null {
    const raw = (runConfig as Record<string, unknown>)['devMockTimeline'];
    if (raw === undefined || raw === null) return null;
    const parsed = optimizationDevMockTimelineSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private deriveGoalScope(goals: OptimizationGoalDto[]): OptimizationDetailGoalScopeDto {
    const classes = Array.from(new Set(goals.map((g) => g.scope).filter((scope) => scope && scope !== 'overall')));
    if (classes.length === 0) return { kind: 'overall' };
    return { kind: 'class', classes };
  }

  private deriveGoalsLines(goals: OptimizationGoalDto[]): OptimizationDetailGoalsLineDto[] {
    return goals.map((goal) => {
      const tone: OptimizationDetailGoalsLineDto['tone'] = goal.scope === 'overall' ? 'overall' : 'class';
      const label =
        goal.scope === 'overall'
          ? this.formatMetricLabel(goal.metric)
          : `${this.formatMetricLabel(goal.metric)} · ${goal.scope}`;
      const comparatorText = goal.comparator === 'gte' ? '≥' : goal.comparator === 'gt' ? '>' : '≤';
      const targetText = `${comparatorText} ${goal.target}`;
      return { label, targetText, tone };
    });
  }

  private formatMetricLabel(metric: string): string {
    if (!metric) return metric;
    if (metric === 'fpr') return 'FPR';
    if (metric === 'f1') return 'F1';
    return metric.charAt(0).toUpperCase() + metric.slice(1);
  }

  private deriveExperimentConfig(
    row: OptimizationRow,
    runConfig: OptimizationRunConfigDto,
  ): OptimizationDetailExperimentConfigDto | null {
    if (!row.datasetName || !row.experimentModelName) return null;
    const promptVersion = row.baseVersionNumber ? `v${row.baseVersionNumber}` : '—';
    const baselineExperiment = row.sourceExperimentName ?? '—';
    return {
      datasetName: row.datasetName,
      promptName: row.promptName ?? '—',
      promptVersion,
      modelName: row.experimentModelName,
      baselineExperiment,
      temperature: typeof runConfig.temperature === 'number' ? runConfig.temperature : 0,
      concurrency: typeof runConfig.concurrency === 'number' ? runConfig.concurrency : 0,
      rpm: typeof runConfig.rpmLimit === 'number' ? runConfig.rpmLimit : 0,
      tpm: typeof runConfig.tpmLimit === 'number' ? runConfig.tpmLimit : 0,
    };
  }

  private deriveIterationConfig(
    row: OptimizationRow,
    runConfig: OptimizationRunConfigDto,
  ): OptimizationDetailIterationConfigDto | null {
    if (!row.analysisModelName) return null;
    const noImprovement = (runConfig as Record<string, unknown>)['stopAfterNoImprovementRounds'];
    const regressionRaw = (runConfig as Record<string, unknown>)['regressionThreshold'];
    return {
      analysisModel: row.analysisModelName,
      strategy: row.strategy,
      maxRounds: row.maxRounds,
      noImprovementStop: typeof noImprovement === 'number' ? noImprovement : 0,
      regressionThreshold: typeof regressionRaw === 'number' ? regressionRaw : 0,
    };
  }

  private deriveBaseline(
    row: OptimizationRow,
    sourceMetrics: Record<string, unknown> | null,
    promptBodyMap: Map<string, PromptBodyEntry>,
  ): OptimizationDetailDto['baseline'] {
    if (!row.sourceExperimentName) return null;
    const promptVersionId = row.baseVersionId ?? row.sourceExperimentPromptVersionId;
    const promptVersion = row.baseVersionNumber ?? row.sourceExperimentPromptVersionNumber;
    const prompt = promptVersionId ? promptBodyMap.get(promptVersionId) : undefined;
    const promptPreview = prompt
      ? composeFullPrompt(prompt.body ?? '', outputSchemaToJsonSchema(prompt.outputSchema), {
          language: this.parsePromptLanguage(prompt.promptLanguage),
        })
      : null;
    const baselineExperiment = buildBaselineExperimentRow(row);
    return {
      promptVersion: promptVersion ? `v${promptVersion}` : '—',
      baselineExperiment: row.sourceExperimentName,
      metrics: extractRoundMetricCells(sourceMetrics),
      promptPreview,
      ...(baselineExperiment ? { experimentResult: buildExperimentResult(baselineExperiment, null) } : {}),
    };
  }

  private parseGoals(value: unknown): OptimizationGoalDto[] {
    const parse = optimizationGoalSchema.array().safeParse(value ?? []);
    if (!parse.success) {
      const legacy = this.parseLegacyGoals(value);
      if (legacy) return legacy;
      throw new BadRequestException('optimization_goals_invalid');
    }
    return parse.data;
  }

  private parseLegacyGoals(value: unknown): OptimizationGoalDto[] | null {
    const entries = Array.isArray(value) ? value : [value];
    const goals = entries.map((entry) => this.parseLegacyGoal(entry));
    return goals.every((goal): goal is OptimizationGoalDto => goal !== null) ? goals : null;
  }

  private parseLegacyGoal(value: unknown): OptimizationGoalDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const legacy = value as Record<string, unknown>;
    const metric = legacy['primary_metric'] ?? legacy['metric'];
    const target = legacy['target'] ?? legacy['value'];
    const comparator = legacy['comparator'] ?? legacy['op'] ?? 'gte';
    const scope = legacy['scope'] ?? 'overall';
    const parse = optimizationGoalSchema.safeParse({ metric, comparator, target, scope });
    return parse.success ? parse.data : null;
  }

  private parseFieldWhitelist(value: unknown): OptimizationFieldWhitelistDto | null {
    if (value === null || value === undefined) return null;
    const parse = optimizationFieldWhitelistSchema.safeParse(value);
    return parse.success ? parse.data : null;
  }

  private parseRunConfig(value: unknown): OptimizationRunConfigDto {
    const parse = optimizationRunConfigSchema.safeParse(value ?? {});
    return parse.success ? parse.data : {};
  }

  private parsePromptLanguage(value: unknown): PromptLanguageDto {
    const parse = promptLanguageSchema.safeParse(value);
    return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
  }

  private parseBestMetrics(value: unknown): OptimizationBestMetricsDto {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;
    const result: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) result[key] = entry;
    }
    return result;
  }

  private parseSummary(value: unknown): OptimizationSummaryDto | null {
    if (value === null || value === undefined) return null;
    const parse = optimizationSummarySchema.safeParse(value);
    if (!parse.success) return null;
    // reason 可能含上游 API 报文,截断 500 字符防止外泄
    const reason = parse.data.reason.length > 500 ? `${parse.data.reason.slice(0, 500)}…` : parse.data.reason;
    return { ...parse.data, reason };
  }

  private parseAnalysisFailureReason(value: string | null): string | null {
    if (!value) return null;
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  private filterItems(items: OptimizationListItemDto[], query: OptimizationListQueryDto) {
    const search = query.search?.trim().toLowerCase();
    return items.filter((item) => {
      if (query.status && item.status !== query.status) return false;
      if (!search) return true;
      return [
        item.name,
        item.description ?? '',
        item.datasetName,
        item.experimentModelName,
        item.analysisModelName,
        item.sourceExperimentName ?? '',
        item.promptName ?? '',
        item.createdByDisplayName ?? '',
        item.createdByUsername ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  }

  private sortItems(items: OptimizationListItemDto[], sort: OptimizationListQueryDto['sort']) {
    return [...items].sort((a, b) => {
      if (sort === 'bestMetric') {
        const av = this.bestMetricScalar(a.bestMetrics);
        const bv = this.bestMetricScalar(b.bestMetrics);
        return bv - av;
      }
      if (sort === 'round') {
        return b.currentRound / Math.max(1, b.maxRounds) - a.currentRound / Math.max(1, a.maxRounds);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  private bestMetricScalar(metrics: OptimizationBestMetricsDto): number {
    if (!metrics) return -1;
    const values = Object.values(metrics).filter((value) => Number.isFinite(value));
    return values.length === 0 ? -1 : Math.max(...values);
  }
}

// ---------------- module helpers ----------------

function deriveLiveProjection(
  row: OptimizationRow,
  rounds: OptimizationRoundExperimentRow[],
  roundSteps: OptimizationRoundStepRow[],
): { currentRound: number; updatedAt: Date } {
  let currentRound = row.currentRound;
  let updatedAt = row.updatedAt;
  const baselineRoundIndexes = new Set<number>();
  const progressRoundIndexes: number[] = [];

  for (const round of rounds) {
    if (isBaselineProgressRound(round)) {
      baselineRoundIndexes.add(round.roundIndex);
    } else if (isProgressRoundIndex(round.roundIndex)) {
      progressRoundIndexes.push(round.roundIndex);
    }
    updatedAt = latestDate(updatedAt, round.updatedAt, round.finishedAt, round.startedAt);
  }
  for (const step of roundSteps) {
    if (!isProgressRoundIndex(step.roundIndex)) {
      baselineRoundIndexes.add(step.roundIndex);
    } else {
      progressRoundIndexes.push(step.roundIndex);
    }
    updatedAt = latestDate(updatedAt, step.updatedAt, step.finishedAt, step.startedAt, step.createdAt);
  }

  if (baselineRoundIndexes.size > 0 && progressRoundIndexes.length === 0) {
    currentRound = 0;
  } else if (baselineRoundIndexes.has(currentRound) && !progressRoundIndexes.some((index) => index >= currentRound)) {
    currentRound = progressRoundIndexes.length > 0 ? Math.max(...progressRoundIndexes) : 0;
  }
  for (const roundIndex of progressRoundIndexes) {
    currentRound = Math.max(currentRound, roundIndex);
  }

  return {
    currentRound: Math.min(Math.max(0, row.maxRounds), Math.max(0, currentRound)),
    updatedAt,
  };
}

function isBaselineProgressRound(round: OptimizationRoundExperimentRow): boolean {
  return round.isBaseline === true || round.roundIndex <= 0;
}

function isProgressRoundIndex(roundIndex: number): boolean {
  return roundIndex > 0;
}

function latestDate(current: Date, ...candidates: Array<Date | null | undefined>): Date {
  let latest = current;
  for (const candidate of candidates) {
    if (candidate && candidate.getTime() > latest.getTime()) latest = candidate;
  }
  return latest;
}

// 把 ph_runs.optimization_round_steps 行映射成 DTO,按固定顺序排列
// (error_analysis → generate_prompt → experiment),前端 stepper 据此索引。
const STEP_ORDER: OptimizationRoundStepKind[] = ['error_analysis', 'generate_prompt', 'experiment'];

function mapStepRowsToDtos(
  rows: OptimizationRoundStepRow[],
): NonNullable<OptimizationDetailIterationRoundDto['steps']> {
  const byKind = new Map<OptimizationRoundStepKind, OptimizationRoundStepRow>();
  for (const r of rows) byKind.set(r.step, r);
  const out: NonNullable<OptimizationDetailIterationRoundDto['steps']> = [];
  for (const kind of STEP_ORDER) {
    const row = byKind.get(kind);
    if (!row) continue;
    out.push({
      step: row.step,
      status: row.status,
      errorClass: row.errorClass,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      runResultId: row.runResultId,
      experimentId: row.experimentId,
    });
  }
  return out;
}

// 根据 steps 派生 round 卡片整体 status:
//   - 任一 step running → running(优先级最高,因为本轮还在跑)
//   - 任一 step failed  → failed
//   - 全部 success      → success
//   - 全部 skipped      → paused
//   - 都不沾边(只有 pending)→ 兜底用 experiment.status
function deriveRoundStatusFromSteps(
  steps: NonNullable<OptimizationDetailIterationRoundDto['steps']>,
  experimentStatus: string | undefined,
): OptimizationDetailIterationRoundDto['status'] {
  if (steps.length === 0) {
    // 没有 round_steps 数据时退回到原有逻辑:基于 experiments 行的 status
    if (experimentStatus === 'success') return 'success';
    if (experimentStatus === 'failed') return 'failed';
    if (experimentStatus === 'stopped' || experimentStatus === 'cancelled') return 'paused';
    return 'running';
  }
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.length > 0 && steps.every((s) => s.status === 'success')) return 'success';
  if (steps.length > 0 && steps.every((s) => s.status === 'skipped')) return 'paused';
  return 'running';
}

function deriveDatasetBaselineStatus(
  steps: NonNullable<OptimizationDetailIterationRoundDto['steps']>,
  experimentStatus: string | undefined,
): OptimizationDetailIterationRoundDto['status'] {
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (!experimentStatus) return 'running';
  if (experimentStatus === 'success') return 'success';
  if (experimentStatus === 'failed') return 'failed';
  if (experimentStatus === 'stopped' || experimentStatus === 'cancelled') return 'paused';
  return 'running';
}

function parsePromptLanguageValue(value: unknown): PromptLanguageDto {
  const parse = promptLanguageSchema.safeParse(value);
  return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
}

// experiment 行尚未创建(分析/生成阶段)时仍尝试从 generate run_result 还原 promptDiff。
// 拿不到 promptVersionNumber 就用 round-N 标签兜底。
function buildPromptDiffWithoutExperiment(
  generate: OptimizationRoundLlmRow | undefined,
  roundIndex: number,
  prevVersionId: string | null,
  promptBodyMap: Map<string, PromptBodyEntry>,
): OptimizationDetailIterationRoundDto['promptDiff'] {
  if (!generate) {
    detailHelperLogger.debug(
      {
        roundIndex,
        status: 'no_generate',
        hasGenerate: false,
        hasNewBody: false,
        hasPrev: !!prevVersionId,
        path: 'without_experiment',
      },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const newBody = extractGeneratedPromptBody(generate);
  if (!newBody) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_new_body', path: 'without_experiment', generateRowStatus: generate.status },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const prev = prevVersionId ? promptBodyMap.get(prevVersionId) : undefined;
  const current = generate.promptVersionId ? promptBodyMap.get(generate.promptVersionId) : undefined;
  const effectiveNewSchema = extractGeneratedOutputSchema(
    generate,
    current?.outputSchema ?? prev?.outputSchema ?? null,
  );
  // 桥接成标准 JSON Schema 后再交给 composeFullPrompt，确保 diff 与「实际下发给业务 LLM」拼装路径一致。
  const fromText = composeFullPrompt(prev?.body ?? '', outputSchemaToJsonSchema(prev?.outputSchema), {
    language: parsePromptLanguageValue(prev?.promptLanguage),
  });
  const toText = composeFullPrompt(newBody, outputSchemaToJsonSchema(effectiveNewSchema), {
    language: parsePromptLanguageValue(current?.promptLanguage ?? prev?.promptLanguage),
  });
  const fromLabel = prev?.versionNumber ? `v${prev.versionNumber}` : 'baseline';
  return {
    from: fromLabel,
    to: `Round ${roundIndex}`,
    fromText,
    toText,
    lines: [],
  };
}

function extractMetric(metrics: unknown, key: string): number | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const v = (metrics as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function extractAnalysisSummary(row: OptimizationRoundLlmRow, roundIndex: number): string | undefined {
  const parsedOutputKeys =
    row.parsedOutput && typeof row.parsedOutput === 'object'
      ? Object.keys(row.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  const rawLen = typeof row.rawResponse === 'string' ? row.rawResponse.length : 0;
  if (row.parsedOutput && typeof row.parsedOutput === 'object') {
    const obj = row.parsedOutput as Record<string, unknown>;
    if (typeof obj['summary'] === 'string') {
      detailHelperLogger.debug(
        { roundIndex, resolvedFrom: 'summary', parsedOutputKeys, rawLen, status: row.status },
        'optimization_detail_analysis_summary_resolve',
      );
      return obj['summary'] as string;
    }
    if (typeof obj['errorAnalysisText'] === 'string') {
      detailHelperLogger.debug(
        { roundIndex, resolvedFrom: 'errorAnalysisText', parsedOutputKeys, rawLen, status: row.status },
        'optimization_detail_analysis_summary_resolve',
      );
      return obj['errorAnalysisText'] as string;
    }
  }
  if (typeof row.rawResponse === 'string' && row.rawResponse.length > 0) {
    detailHelperLogger.debug(
      { roundIndex, resolvedFrom: 'raw', parsedOutputKeys, rawLen, status: row.status },
      'optimization_detail_analysis_summary_resolve',
    );
    return row.rawResponse.slice(0, 400);
  }
  detailHelperLogger.debug(
    { roundIndex, resolvedFrom: 'none', parsedOutputKeys, rawLen, status: row.status },
    'optimization_detail_analysis_summary_resolve',
  );
  return undefined;
}

function extractRoundMetricCells(metrics: unknown): OptimizationDetailIterationRoundDto['metrics'] {
  if (!metrics || typeof metrics !== 'object') return [];
  const out: OptimizationDetailIterationRoundDto['metrics'] = [];
  for (const [k, v] of Object.entries(metrics as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ label: k, value: v });
    }
  }
  return out;
}

export function collectPromptVersionIds(
  row: OptimizationRow,
  rounds: OptimizationRoundExperimentRow[],
  llmRows: OptimizationRoundLlmRow[] = [],
): string[] {
  const ids: string[] = [];
  if (row.baseVersionId) ids.push(row.baseVersionId);
  if (row.sourceExperimentPromptVersionId) ids.push(row.sourceExperimentPromptVersionId);
  for (const round of rounds) {
    if (round.promptVersionId) ids.push(round.promptVersionId);
    if (round.parentVersionId) ids.push(round.parentVersionId);
  }
  for (const llm of llmRows) {
    if (llm.promptVersionId) ids.push(llm.promptVersionId);
  }
  return Array.from(new Set(ids));
}

function resolvePromptDiffBaseVersionId(
  experiment: OptimizationRoundExperimentRow | null,
  generate: OptimizationRoundLlmRow | undefined,
  sortedExperiments: OptimizationRoundExperimentRow[],
  baseVersionId: string | null,
): string | null {
  if (experiment?.parentVersionId) return experiment.parentVersionId;
  if (generate?.promptVersionId) return generate.promptVersionId;

  // 兼容旧数据:没有 parent_version_id / generate prompt_version_id 时,
  // 退回到历史的“上一条 experiment prompt”语义。
  const prevExperimentIdx = sortedExperiments.findIndex((r) => r.roundIndex === experiment?.roundIndex);
  const prevExperiment = prevExperimentIdx > 0 ? (sortedExperiments[prevExperimentIdx - 1] ?? null) : null;
  return prevExperiment?.promptVersionId ?? baseVersionId;
}

function extractErrorPatterns(
  analysis: OptimizationRoundLlmRow | undefined,
  roundIndex: number,
): OptimizationDetailIterationRoundDto['errorPatterns'] {
  if (!analysis) {
    detailHelperLogger.debug({ roundIndex, status: 'no_analysis' }, 'optimization_detail_error_patterns_resolve');
    return undefined;
  }
  const parsedOutputKeys =
    analysis.parsedOutput && typeof analysis.parsedOutput === 'object'
      ? Object.keys(analysis.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  if (!analysis.parsedOutput || typeof analysis.parsedOutput !== 'object') {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_parsed_output', parsedOutputKeys, analysisRowStatus: analysis.status },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  const obj = analysis.parsedOutput as Record<string, unknown>;
  const raw = obj['errorPatterns'];
  if (!Array.isArray(raw)) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_array', parsedOutputKeys },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  if (raw.length === 0) {
    detailHelperLogger.debug(
      { roundIndex, status: 'empty_array', parsedOutputKeys, rawLen: 0 },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  const parsed: Array<{ label: string; count: number; reason: string }> = [];
  let filteredCount = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      filteredCount += 1;
      continue;
    }
    const i = item as Record<string, unknown>;
    const label = typeof i['label'] === 'string' ? (i['label'] as string) : null;
    if (!label) {
      filteredCount += 1;
      continue;
    }
    const count = typeof i['count'] === 'number' && Number.isFinite(i['count']) ? (i['count'] as number) : 0;
    const reason = typeof i['reason'] === 'string' ? (i['reason'] as string) : '';
    parsed.push({ label, count, reason });
  }
  if (parsed.length === 0) {
    detailHelperLogger.debug(
      { roundIndex, status: 'all_filtered', parsedOutputKeys, rawLen: raw.length, filteredCount },
      'optimization_detail_error_patterns_resolve',
    );
    return undefined;
  }
  detailHelperLogger.debug(
    {
      roundIndex,
      status: 'ok',
      parsedOutputKeys,
      rawLen: raw.length,
      keptCount: parsed.length,
      filteredCount,
    },
    'optimization_detail_error_patterns_resolve',
  );
  const total = parsed.reduce((acc, p) => acc + p.count, 0);
  return parsed.map((p) => ({
    percent: total > 0 ? Math.round((p.count / total) * 100) : 0,
    title: p.label,
    detail: p.reason,
    count: { hit: p.count, total },
  }));
}

function extractImprovementSuggestions(
  analysis: OptimizationRoundLlmRow | undefined,
  roundIndex: number,
): OptimizationDetailIterationRoundDto['improvementSuggestions'] {
  if (!analysis) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_analysis' },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  const parsedOutputKeys =
    analysis.parsedOutput && typeof analysis.parsedOutput === 'object'
      ? Object.keys(analysis.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  if (!analysis.parsedOutput || typeof analysis.parsedOutput !== 'object') {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_parsed_output', parsedOutputKeys, analysisRowStatus: analysis.status },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  const obj = analysis.parsedOutput as Record<string, unknown>;
  const raw = obj['suggestedChanges'];
  if (!Array.isArray(raw)) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_array', parsedOutputKeys },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  if (raw.length === 0) {
    detailHelperLogger.debug(
      { roundIndex, status: 'empty_array', parsedOutputKeys },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  const out: NonNullable<OptimizationDetailIterationRoundDto['improvementSuggestions']> = [];
  let missingSection = 0;
  let missingChange = 0;
  let nonObject = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      nonObject += 1;
      continue;
    }
    const i = item as Record<string, unknown>;
    const section = typeof i['section'] === 'string' ? (i['section'] as string) : null;
    const change = typeof i['change'] === 'string' ? (i['change'] as string) : null;
    if (!section) missingSection += 1;
    if (!change) missingChange += 1;
    if (!section || !change) continue;
    const rationale = typeof i['rationale'] === 'string' ? (i['rationale'] as string) : '';
    const rawPriority = i['priority'];
    const priority =
      rawPriority === 'high' || rawPriority === 'medium' || rawPriority === 'low' ? rawPriority : undefined;
    out.push({
      section,
      title: change,
      detail: rationale || undefined,
      priority,
    });
  }
  if (out.length === 0) {
    detailHelperLogger.debug(
      {
        roundIndex,
        status: 'all_filtered',
        parsedOutputKeys,
        rawLen: raw.length,
        missingSection,
        missingChange,
        nonObject,
      },
      'optimization_detail_improvement_suggestions_resolve',
    );
    return undefined;
  }
  detailHelperLogger.debug(
    {
      roundIndex,
      status: 'ok',
      parsedOutputKeys,
      rawLen: raw.length,
      keptCount: out.length,
      missingSection,
      missingChange,
      nonObject,
    },
    'optimization_detail_improvement_suggestions_resolve',
  );
  return out;
}

function buildPromptDiff(
  round: OptimizationRoundExperimentRow,
  generate: OptimizationRoundLlmRow | undefined,
  prevVersionId: string | null,
  promptBodyMap: Map<string, PromptBodyEntry>,
): OptimizationDetailIterationRoundDto['promptDiff'] {
  const roundIndex = round.roundIndex;
  if (!generate) {
    detailHelperLogger.debug(
      { roundIndex, status: 'no_generate', hasGenerate: false, hasNewBody: false, hasPrev: !!prevVersionId },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const generateParsedKeys =
    generate.parsedOutput && typeof generate.parsedOutput === 'object'
      ? Object.keys(generate.parsedOutput as Record<string, unknown>).slice(0, 10)
      : [];
  const newBody = extractGeneratedPromptBody(generate);
  if (!newBody) {
    detailHelperLogger.debug(
      {
        roundIndex,
        status: 'no_new_body',
        hasGenerate: true,
        hasNewBody: false,
        hasPrev: !!prevVersionId,
        generateRowStatus: generate.status,
        generateParsedKeys,
      },
      'optimization_detail_prompt_diff_resolve',
    );
    return undefined;
  }
  const prev = prevVersionId ? promptBodyMap.get(prevVersionId) : undefined;
  const current = round.promptVersionId ? promptBodyMap.get(round.promptVersionId) : undefined;
  const effectiveNewSchema = extractGeneratedOutputSchema(
    generate,
    current?.outputSchema ?? prev?.outputSchema ?? null,
  );
  // 桥接成标准 JSON Schema 后再交给 composeFullPrompt，确保 diff 与「实际下发给业务 LLM」拼装路径一致。
  const fromText = composeFullPrompt(prev?.body ?? '', outputSchemaToJsonSchema(prev?.outputSchema), {
    language: parsePromptLanguageValue(prev?.promptLanguage),
  });
  const toText = composeFullPrompt(newBody, outputSchemaToJsonSchema(effectiveNewSchema), {
    language: parsePromptLanguageValue(current?.promptLanguage ?? prev?.promptLanguage),
  });
  const toLabel = round.promptVersionNumber ? `v${round.promptVersionNumber}` : `Round ${round.roundIndex}`;
  const fromLabel = prev?.versionNumber ? `v${prev.versionNumber}` : 'baseline';
  detailHelperLogger.debug(
    {
      roundIndex,
      status: prev ? 'ok' : 'no_prev_version',
      hasGenerate: true,
      hasNewBody: true,
      hasPrev: !!prev,
      generateRowStatus: generate.status,
      generateParsedKeys,
      prevVersionId,
      newBodyLen: newBody.length,
      fromTextLen: fromText.length,
      schemaChanged: effectiveNewSchema !== (prev?.outputSchema ?? null),
    },
    'optimization_detail_prompt_diff_resolve',
  );
  return {
    from: fromLabel,
    to: toLabel,
    fromText,
    toText,
    lines: [],
  };
}

function extractGeneratedPromptBody(generate: OptimizationRoundLlmRow | undefined): string | null {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') return null;
  const obj = generate.parsedOutput as Record<string, unknown>;
  const body = obj['newPromptBody'];
  if (typeof body === 'string' && body.length > 0) return body;
  return null;
}

function extractGenerateSummary(generate: OptimizationRoundLlmRow | undefined, roundIndex: number): string | undefined {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') {
    detailHelperLogger.debug(
      { roundIndex, status: generate ? 'no_parsed_output' : 'no_generate' },
      'optimization_detail_generate_summary_resolve',
    );
    return undefined;
  }
  const obj = generate.parsedOutput as Record<string, unknown>;
  const summary = obj['changeSummary'];
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary.trim().slice(0, 400);
  }
  return undefined;
}

// SPEC 25 §11: generate retry 用尽仍丢占位时,会在 parsedOutput 里写 autoPatched=true + patchedVariables 数组。
// 前端轮次卡片据此渲染"系统补丁" chip 提醒用户人工微调占位融入位置。autoPatched=false / 字段缺失时返回 undefined,
// DTO 字段保持 optional 形态,不污染历史 round。
function extractAutoPatchInfo(generate: OptimizationRoundLlmRow | undefined): {
  autoPatched?: boolean;
  patchedVariables?: string[];
} {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') {
    return {};
  }
  const obj = generate.parsedOutput as Record<string, unknown>;
  if (obj['autoPatched'] !== true) return {};
  const vars = Array.isArray(obj['patchedVariables'])
    ? (obj['patchedVariables'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return { autoPatched: true, patchedVariables: vars };
}

// 从 generate run_result 提取本轮真正生效的 outputSchema:
// 优先 parsedOutput.newOutputSchema(LLM 提供且通过校验时已写入),否则回退 fallback(基线 / 上一版本 schema)。
// 写入时 safeValidateNewOutputSchema 已校验过,这里只做"对象形态"判断,不再重复校验,
// 避免历史 round 的展示行为受新校验规则影响。
function extractGeneratedOutputSchema(
  generate: OptimizationRoundLlmRow | undefined,
  fallbackOldSchema: unknown,
): unknown {
  if (!generate || !generate.parsedOutput || typeof generate.parsedOutput !== 'object') {
    return fallbackOldSchema;
  }
  const obj = generate.parsedOutput as Record<string, unknown>;
  const candidate = obj['newOutputSchema'];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate;
  }
  return fallbackOldSchema;
}

function buildBaselineExperimentRow(row: OptimizationRow): OptimizationRoundExperimentRow | null {
  if (!row.sourceExperimentId || !row.sourceExperimentName || !row.sourceExperimentStatus) return null;
  return {
    experimentId: row.sourceExperimentId,
    experimentName: row.sourceExperimentName,
    roundIndex: 0,
    isBaseline: true,
    promptVersionId: row.sourceExperimentPromptVersionId ?? row.baseVersionId ?? '',
    promptVersionNumber: row.sourceExperimentPromptVersionNumber ?? row.baseVersionNumber,
    parentVersionId: null,
    status: row.sourceExperimentStatus,
    metrics: row.sourceExperimentMetrics,
    failureReason: row.sourceExperimentFailureReason,
    startedAt: row.sourceExperimentStartedAt,
    finishedAt: row.sourceExperimentFinishedAt,
    totalSamples: Math.max(0, row.sourceExperimentTotalSamples ?? row.datasetSamples),
    processedSamples: Math.max(0, row.sourceExperimentProcessedSamples ?? 0),
    failedSamples: Math.max(0, row.sourceExperimentFailedSamples ?? 0),
  };
}

function buildExperimentResult(
  round: OptimizationRoundExperimentRow,
  baselineMetrics: Record<string, unknown> | null,
): OptimizationDetailIterationRoundDto['experimentResult'] {
  if (!round.experimentId) return undefined;
  const status: NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['experimentStatus'] =
    round.status === 'success' ? 'success' : round.status === 'failed' ? 'failed' : 'running';
  const samplesDone = Math.max(0, round.processedSamples);
  const samplesTotal = Math.max(samplesDone, round.totalSamples);
  const metricsObj =
    round.metrics && typeof round.metrics === 'object' ? (round.metrics as Record<string, unknown>) : null;
  const accuracy = metricsObj && typeof metricsObj['accuracy'] === 'number' ? (metricsObj['accuracy'] as number) : null;
  const correct = accuracy !== null ? Math.round(accuracy * samplesDone) : 0;
  const wrong = Math.max(0, samplesDone - correct);
  const elapsed = formatElapsed(round.startedAt, round.finishedAt);
  const inputTokens =
    metricsObj && typeof metricsObj['inputTokens'] === 'number' ? (metricsObj['inputTokens'] as number) : null;
  const outputTokens =
    metricsObj && typeof metricsObj['outputTokens'] === 'number' ? (metricsObj['outputTokens'] as number) : null;
  const costEstimate =
    metricsObj && typeof metricsObj['costEstimate'] === 'number' ? (metricsObj['costEstimate'] as number) : null;
  const tokenSummary =
    inputTokens !== null && outputTokens !== null
      ? `${formatThousands(inputTokens)} → ${formatThousands(outputTokens)} tok`
      : '—';
  const costLabel = costEstimate !== null ? `$${costEstimate.toFixed(4)}` : '—';
  const vsLabel = 'baseline';
  const overallRow = buildOverallRow(metricsObj, baselineMetrics, vsLabel);
  const classRows = buildClassRows(metricsObj, baselineMetrics, vsLabel);
  return {
    experimentRef: round.experimentName || `Round ${round.roundIndex}`,
    experimentStatus: status,
    samplesDone,
    samplesTotal,
    correct,
    wrong,
    elapsed,
    tokenSummary,
    costLabel,
    overallRow,
    classRows,
    vsPrevLabel: vsLabel,
  };
}

function buildOverallRow(
  metricsObj: Record<string, unknown> | null,
  baselineMetricsObj: Record<string, unknown> | null,
  vsLabel: string,
): NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['overallRow'] {
  if (!metricsObj) return null;
  const accuracy = typeof metricsObj['accuracy'] === 'number' ? (metricsObj['accuracy'] as number) : null;
  const precision = typeof metricsObj['precision'] === 'number' ? (metricsObj['precision'] as number) : null;
  const recall = typeof metricsObj['recall'] === 'number' ? (metricsObj['recall'] as number) : null;
  if (accuracy === null && precision === null && recall === null) return null;
  const baselineAccuracy =
    baselineMetricsObj && typeof baselineMetricsObj['accuracy'] === 'number'
      ? (baselineMetricsObj['accuracy'] as number)
      : null;
  const baselinePrecision =
    baselineMetricsObj && typeof baselineMetricsObj['precision'] === 'number'
      ? (baselineMetricsObj['precision'] as number)
      : null;
  const baselineRecall =
    baselineMetricsObj && typeof baselineMetricsObj['recall'] === 'number'
      ? (baselineMetricsObj['recall'] as number)
      : null;
  const accuracyComparison = buildMetricComparison(accuracy, baselineAccuracy, vsLabel);
  const precisionComparison = buildMetricComparison(precision, baselinePrecision, vsLabel);
  const recallComparison = buildMetricComparison(recall, baselineRecall, vsLabel);
  const vsDelta = accuracyComparison?.value ?? null;
  const vsTone: 'ok' | 'bad' | 'neutral' = accuracyComparison?.tone ?? 'neutral';
  const deltas = compactMetricComparisons({
    accuracy: accuracyComparison,
    precision: precisionComparison,
    recall: recallComparison,
  });
  return {
    accuracy: accuracy ?? 0,
    precision: precision ?? 0,
    recall: recall ?? 0,
    vsLabel,
    vsDelta,
    vsTone,
    ...(deltas ? { deltas } : {}),
  };
}

function buildClassRows(
  metricsObj: Record<string, unknown> | null,
  baselineMetricsObj: Record<string, unknown> | null,
  vsLabel: string,
): NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['classRows'] {
  if (!metricsObj) return [];
  const perClass = metricsObj['perClass'];
  if (!Array.isArray(perClass)) return [];
  const baselinePerClass =
    baselineMetricsObj && Array.isArray(baselineMetricsObj['perClass']) ? baselineMetricsObj['perClass'] : null;
  const baselineByLabel = new Map<string, { precision: number | null; recall: number | null }>();
  if (baselinePerClass) {
    for (const item of baselinePerClass) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const label = typeof it['label'] === 'string' ? (it['label'] as string) : null;
      if (!label) continue;
      baselineByLabel.set(label, {
        precision: typeof it['precision'] === 'number' ? (it['precision'] as number) : null,
        recall: typeof it['recall'] === 'number' ? (it['recall'] as number) : null,
      });
    }
  }
  const out: NonNullable<OptimizationDetailIterationRoundDto['experimentResult']>['classRows'] = [];
  for (const item of perClass) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const label = typeof it['label'] === 'string' ? (it['label'] as string) : null;
    if (!label) continue;
    const accuracy = typeof it['accuracy'] === 'number' ? (it['accuracy'] as number) : null;
    const precision = typeof it['precision'] === 'number' ? (it['precision'] as number) : 0;
    const recall = typeof it['recall'] === 'number' ? (it['recall'] as number) : 0;
    const f1 = typeof it['f1'] === 'number' ? (it['f1'] as number) : null;
    const fpr = typeof it['fpr'] === 'number' ? (it['fpr'] as number) : null;
    const baselineEntry = baselineByLabel.get(label);
    const baselinePrecision = baselineEntry?.precision ?? null;
    const baselineRecall = baselineEntry?.recall ?? null;
    const precisionComparison = buildMetricComparison(precision, baselinePrecision, vsLabel);
    const recallComparison = buildMetricComparison(recall, baselineRecall, vsLabel);
    const vsDelta = precisionComparison?.value ?? null;
    const vsTone: 'ok' | 'bad' | 'neutral' = precisionComparison?.tone ?? 'neutral';
    const deltas = compactMetricComparisons({
      precision: precisionComparison,
      recall: recallComparison,
    });
    out.push({
      label,
      ...(accuracy !== null ? { accuracy } : {}),
      precision,
      recall,
      ...(f1 !== null ? { f1 } : {}),
      ...(fpr !== null ? { fpr } : {}),
      vsLabel,
      vsDelta,
      vsTone,
      ...(deltas ? { deltas } : {}),
    });
  }
  return out;
}

function buildMetricComparison(
  current: number | null,
  baseline: number | null,
  vsLabel: string,
  betterIsLower = false,
): OptimizationDetailMetricComparisonDto | undefined {
  if (current === null || baseline === null) return undefined;
  const value = current - baseline;
  const adjusted = betterIsLower ? -value : value;
  const tone: OptimizationDetailMetricComparisonDto['tone'] =
    adjusted > 0.001 ? 'ok' : adjusted < -0.001 ? 'bad' : 'neutral';
  return { value, vsLabel, tone, ...(betterIsLower ? { betterIsLower } : {}) };
}

function compactMetricComparisons(
  comparisons: Partial<Record<'accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto | undefined>>,
): Partial<Record<'accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto>> | undefined {
  const entries = Object.entries(comparisons).filter(
    (entry): entry is ['accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto] =>
      entry[1] !== undefined,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Partial<
    Record<'accuracy' | 'precision' | 'recall', OptimizationDetailMetricComparisonDto>
  >;
}

function formatElapsed(startedAt: Date | null, finishedAt: Date | null): string {
  if (!startedAt) return '—';
  const end = finishedAt ?? new Date();
  const ms = Math.max(0, end.getTime() - startedAt.getTime());
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
}

function formatThousands(n: number): string {
  return n.toLocaleString('en-US');
}

function normalizeOptimizationHint(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// SPEC 25 §2.1:from_dataset_only 自动建 prompt 的命名规则。
// `优化-${datasetName}-${YYYY-MM-DDTHH:MM}`,例：`优化-客户反馈-2026-05-20T14:30`
function buildOptimizationPromptName(datasetName: string, now: Date, promptLanguage: PromptLanguageDto): string {
  // toISOString 输出 `YYYY-MM-DDTHH:MM:SS.sssZ`;截到分钟
  const iso = now.toISOString().slice(0, 16);
  if (promptLanguage === 'en-US') return `Optimization-${datasetName}-${iso}`;
  return `优化-${datasetName}-${iso}`;
}

// 撞 prompts_project_name_unique 时附 8 字符 hash 后缀重试用 — 同一秒大量并发创建才有概率
// 二次冲突,8 字符 base36 hash 提供 36^8 ≈ 2.8e12 空间足够。
function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).padStart(8, '0').slice(0, 8);
}

// pg unique_violation 错误识别:Drizzle / pg 包透出 code='23505',且 message 含约束名。
function isPromptNameUniqueViolation(err: unknown): boolean {
  return isUniqueViolation(err, /idx_prompts_project_name_active|prompts_project_name_unique/);
}

function isOptimizationNameUniqueViolation(err: unknown): boolean {
  return isUniqueViolation(err, /idx_optimization_project_name_active/);
}
