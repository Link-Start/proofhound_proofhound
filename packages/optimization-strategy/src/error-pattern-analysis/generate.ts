// 新版本生成 — 9 大块 system prompt + 变量白名单校验 + token budget
import {
  invokeLLM,
  type InvokeLLMDependencies,
  type InvokeLLMResult,
  type LLMMessage,
  type ModelInvocationConfig,
} from '@proofhound/llm-client';
import type { OptimizationGoal, FieldWhitelist, MetricSnapshot, PromptVersionRef, RoundHistoryEntry } from '../loop/types';
import { buildRunResultForCall, type AnalyzeFailuresResult, type OptimizationRunResultMeta } from './analyze';
import type { ErrorPatternAnalysisConfig } from './config.schema';
import {
  InvalidVariableUsageError,
  InvalidAppliedChangeReferenceError,
  parseGenerateOutput,
  safeValidateNewOutputSchema,
  validatePromptVariables,
  type AnalysisEvidenceBundle,
  type GenerateOutput,
  type VariableValidationResult,
} from './parse';
import {
  DEFAULT_PROMPT_LANGUAGE,
  buildOutputFormatInstruction,
  composeFullPrompt,
  outputSchemaToJsonSchema,
  type PromptLanguageDto,
} from '@proofhound/shared';
import { buildGenerateMessages, extractVariableNames, fitRoundHistoryToBudget } from './prompts';
import { computeSampleBudget, estimateMessagesTokens, truncateLongText } from './token-budget';

export interface GenerateNextVersionArgs {
  optimizationId: string;
  roundNumber: number;
  analysisModel: ModelInvocationConfig;
  currentVersion: PromptVersionRef;
  analysis: AnalyzeFailuresResult;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  optimizationHint?: string;
  strategyConfig: ErrorPatternAnalysisConfig;
  promptLanguage?: PromptLanguageDto;
  // 跨轮历史(SPEC 25 §11.3)：非首轮时由 caller 聚合传入；首轮 undefined / [] 不渲染历史段
  roundHistory?: RoundHistoryEntry[];
  // 「## 工具箱轮换提示」段输入(SPEC 25 §11.3「工具箱轮换提示」)
  // caller 在 streak >= 2(连续 ≥2 轮 !isBest) 时构造;undefined 时不渲染。
  // 透传给 probe + actual 两次 buildGenerateMessages,保证 token budget 估算与实际 user prompt 一致。
  toolboxSwitchHint?: { recentlyUsedTips: string[]; allTipNames: readonly string[] };
  // 提供时,invokeLLM 自动写 ph_runs.run_results 一行(source='optimization_generate')。
  // 不传则维持旧行为(只打日志,不写表)。
  runResultMeta?: OptimizationRunResultMeta;
  generateRunResultId?: string;
}

export interface GenerateBudgetReport {
  baselineInputTokens: number;
  errorAnalysisBudgetTokens: number;
  errorAnalysisTruncated: boolean;
  originalErrorAnalysisChars: number;
  evidenceBundleBudgetTokens: number;
  evidenceBundleTruncated: boolean;
  originalEvidenceBundleTokens: number;
  // 跨轮历史 budget 观测字段(SPEC 25 §11.3)
  roundHistoryEntryCount: number;
  roundHistoryFittedLevel: 0 | 1 | 2 | 3;
  roundHistoryBudgetTokens: number;
  roundHistoryTruncated: boolean;
}

export interface GenerateNextVersionResult extends GenerateOutput {
  variableValidation: {
    ok: boolean;
    disallowed: string[];
    missing: string[];
    detected: string[];
  };
  budget: GenerateBudgetReport;
  // 真正用于本轮新版本的 outputSchema:LLM 提供且校验通过则用新的,否则回退旧 schema。
  // 也是 outputFormatInstruction / composedFullPrompt 的拼接依据。
  effectiveOutputSchema: unknown;
  // 从 effectiveOutputSchema 自动拼出的「## 输出格式」段（无 schema 时为空串）。
  // newPromptBody 故意不含输出格式 — 业务 LLM 调用时再把本段拼到 body 尾部，保证输出契约稳定。
  outputFormatInstruction: string;
  // newPromptBody + outputFormatInstruction 的拼接结果 — 真正发给业务模型的完整 prompt。
  composedFullPrompt: string;
  // LLM 实际发起的 generate 调用次数 - 1：0 = 首次成功；>=1 = 重试若干次（可能伴随 autoPatched=true）
  retries: number;
  // 是否走了系统兜底补丁(重试到上限仍丢占位 → 系统在 newPromptBody 末尾自动拼回缺失占位)
  autoPatched: boolean;
  // 被系统补回的占位名（autoPatched=false 时为 []）
  patchedVariables: string[];
}

// LLM 重试上限 — 总共最多 1 次首调 + N 次重试；retry 用尽仍丢占位 → 走系统自动补丁
const MAX_VARIABLE_RETRY_ATTEMPTS = 2;

// 拼接系统补丁段：在新 body 末尾追加结构化提示，保证缺失占位以 ASCII {{var}} 形式回到 body 中。
// 该段用空行 + --- 分隔，UI 可截取尾段提示用户人工微调占位融入位置。
function autoPatchPromptBody(
  body: string,
  missingVariables: string[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  const lines = missingVariables.map((v) => `- ${v}：{{${v}}}`).join('\n');
  if (language === 'en-US') {
    return `${body}\n\n---\n(System auto-patch: these input variables were restored; please review and place them naturally.)\n${lines}`;
  }
  return `${body}\n\n---\n（系统自动补丁：以下输入变量被系统补回，请人工核查并调整使用位置）\n${lines}`;
}

// 构造 retry 时反馈给 LLM 的 user 消息：明确告知它上一轮丢了哪些占位 + 必须以 ASCII 双花括号语法回填
function buildVariableRetryFeedback(
  removedVariables: string[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  const occList = removedVariables.map((v) => `- \`{{${v}}}\``).join('\n');
  if (language === 'en-US') {
    return [
      '## Previous newPromptBody violated hard constraint #1 (must preserve base placeholders)',
      'Your newPromptBody is missing these placeholders. They were used by the base prompt and are still whitelisted:',
      occList,
      '',
      'Return the complete JSON again with these requirements:',
      '- newPromptBody must include every placeholder above exactly with ASCII double braces, e.g. `{{var}}`.',
      '- Do not use `{var}`, `<var>`, `[var]`, full-width braces, or any other syntax variant.',
      '- Keep the other fields aligned with your intended change.',
    ].join('\n');
  }
  return [
    '## 上一轮 newPromptBody 违反硬约束 #1（必须保留 base 已用占位）',
    `你的 newPromptBody 中缺少以下占位（base 已用 ∩ 白名单内 → 必须逐字保留）：`,
    occList,
    '',
    '请重新输出完整 JSON，要求：',
    '- **newPromptBody 中必须以 ASCII 双花括号语法 `{{var}}` 原样包含上述全部占位**（位置可调整）',
    '- 禁止用 `{var}` / `<var>` / `[var]` / 全角 `｛｛var｝｝` 等任何变体语法',
    '- 其他字段（changeSummary / appliedChanges / appliedTips / variablesUsed / newOutputSchema）按你的原意保留',
  ].join('\n');
}

export async function generateNextVersion(
  args: GenerateNextVersionArgs,
  deps: InvokeLLMDependencies,
): Promise<GenerateNextVersionResult> {
  const promptLanguage = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const evidenceBundle = args.analysis.evidenceBundle ?? legacyEvidenceBundle(args.analysis);

  // 0) 跨轮历史 token budget 降级 — 给 probe + actual call 共用同一份 fitted history
  // history 最多占用 batch input budget 的 40%,其余留给错误样本 / evidence
  const historyCap = Math.floor(args.strategyConfig.maxInputTokensPerBatch * 0.4);
  const fittedHistoryResult = fitRoundHistoryToBudget(args.roundHistory, historyCap, args.goals, promptLanguage);
  const fittedHistory = fittedHistoryResult.fitted;

  // 1) 探针：把证据包清空构造一次 message 估 baseline（含已 fit 的跨轮历史 + 工具箱轮换提示）
  const probe = buildGenerateMessages({
    currentVersion: args.currentVersion,
    errorAnalysisText: '',
    analysisEvidenceBundle: {
      evidenceBundleVersion: 1,
      summary: '',
      errorPatterns: [],
      suggestedChanges: [],
      conflicts: [],
      sourceStats: {
        batchCount: 0,
        totalConfusionFailures: 0,
        totalRegressionSamples: 0,
        truncated: false,
      },
    },
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    optimizationHint: args.optimizationHint,
    roundHistory: fittedHistory,
    toolboxSwitchHint: args.toolboxSwitchHint,
    promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxGenerationOutputTokens);
  const errorAnalysisBudgetTokens = computeSampleBudget(
    args.strategyConfig.maxInputTokensPerBatch,
    baseline.inputTokens,
  );

  // 2) 结构化证据包按权重裁剪；旧摘要文本仍作为 fallback 一并保留
  const fittedEvidence = fitEvidenceBundleToBudget(evidenceBundle, errorAnalysisBudgetTokens);

  const maxErrorAnalysisChars = errorAnalysisBudgetTokens * 4;
  const originalText = args.analysis.errorAnalysisText;
  const fittedText = truncateLongText(originalText, maxErrorAnalysisChars);
  const errorAnalysisTruncated = fittedText !== originalText;

  // 3) 用 fitted 证据包构造最终 messages
  const { system, user } = buildGenerateMessages({
    currentVersion: args.currentVersion,
    errorAnalysisText: fittedText,
    analysisEvidenceBundle: fittedEvidence.bundle,
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    optimizationHint: args.optimizationHint,
    roundHistory: fittedHistory,
    toolboxSwitchHint: args.toolboxSwitchHint,
    promptLanguage,
  });

  // base body 已经用过 ∩ 白名单内 = 新版本必须保留的占位
  // （丢失会让模型推理不到 input，输出立即塌缩到先验，见 docs/specs/25 §11 优化摆动）
  const allowedSet = new Set(args.fieldWhitelist.promptVariables);
  const requiredVariables = extractVariableNames(args.currentVersion.body).filter((v) => allowedSet.has(v));

  // 循环结构 — 一次首调 + 最多 N 次重试 + 兜底自动补丁。中间次不写 ph_runs.run_results；
  // 循环外用最终采纳那次的 InvokeLLMResult + parsed 手动写一行（含 autoPatched/patchedVariables）。
  let messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let finalInvokeResult: InvokeLLMResult | null = null;
  let parsed: GenerateOutput | null = null;
  let validation: VariableValidationResult | null = null;
  let retries = 0;
  let autoPatched = false;
  let patchedVariables: string[] = [];

  for (let attempt = 0; attempt <= MAX_VARIABLE_RETRY_ATTEMPTS; attempt++) {
    const result = await invokeLLM(
      {
        model: args.analysisModel,
        messages,
        params: {
          temperature: args.strategyConfig.temperature,
          maxTokens: args.strategyConfig.maxGenerationOutputTokens,
        },
        context: {
          source: 'optimization_generate',
          stepName: 'error_pattern_generate',
          requestId: `optimization:${args.optimizationId}:r${args.roundNumber}:generate${attempt > 0 ? `:retry${attempt}` : ''}`,
          promptVersionId: args.currentVersion.id,
          promptLanguage,
        },
        // 中间次不写 run_result — 循环外手动写最终采纳那次（含 autoPatched / patchedVariables）
        parseResponse: (content) => {
          try {
            return parseGenerateOutput(content, null);
          } catch {
            return null;
          }
        },
      },
      deps,
    );

    finalInvokeResult = result;
    const attemptParsed = parseGenerateOutput(result.content, result.finishReason);
    validateAppliedChanges(attemptParsed, fittedEvidence.bundle);
    const attemptValidation = validatePromptVariables(
      attemptParsed.newPromptBody,
      args.fieldWhitelist.promptVariables,
      attemptParsed.variablesUsed,
      requiredVariables,
    );

    // disallowed 不可挽救（LLM 用了白名单外变量 → 业务方字段配置错误，重试也救不了） → 立即 fatal
    if (attemptValidation.disallowed.length > 0) {
      throw new InvalidVariableUsageError(
        attemptValidation.disallowed,
        attemptValidation.missing,
        attemptValidation.removed,
      );
    }

    // 校验通过 → 收工
    if (attemptValidation.ok) {
      parsed = attemptParsed;
      validation = attemptValidation;
      retries = attempt;
      break;
    }

    // 仅 removed 错误：还有重试机会就反馈给 LLM，否则走兜底自动补丁
    if (attempt === MAX_VARIABLE_RETRY_ATTEMPTS) {
      const removedToPatch = [...attemptValidation.removed];
      const patchedBody = autoPatchPromptBody(attemptParsed.newPromptBody, removedToPatch, promptLanguage);
      const reValidation = validatePromptVariables(
        patchedBody,
        args.fieldWhitelist.promptVariables,
        attemptParsed.variablesUsed,
        requiredVariables,
      );
      if (!reValidation.ok) {
        // 兜底句直接拼了 {{var}} 字面量，理论不可达；保险起见仍抛错
        throw new InvalidVariableUsageError(reValidation.disallowed, reValidation.missing, reValidation.removed);
      }
      parsed = { ...attemptParsed, newPromptBody: patchedBody };
      validation = reValidation;
      autoPatched = true;
      patchedVariables = removedToPatch;
      retries = attempt;
      deps.logger.info(
        {
          optimizationId: args.optimizationId,
          roundNumber: args.roundNumber,
          patchedVariables,
          retries,
          promptVersionId: args.currentVersion.id,
          level: 'warn',
        },
        'optimization_generate_auto_patched',
      );
      break;
    }

    // 反馈失败原因，准备下一轮
    const removedSnapshot = [...attemptValidation.removed];
    deps.logger.info(
      {
        optimizationId: args.optimizationId,
        roundNumber: args.roundNumber,
        attempt,
        removedVariables: removedSnapshot,
        promptVersionId: args.currentVersion.id,
      },
      'optimization_generate_retry',
    );
    messages = [
      ...messages,
      { role: 'assistant', content: result.content },
      { role: 'user', content: buildVariableRetryFeedback(removedSnapshot, promptLanguage) },
    ];
  }

  if (!parsed || !validation || !finalInvokeResult) {
    // unreachable — 循环必走 break 或 throw
    throw new Error('generate_loop_invariant_violated');
  }

  // 手动写 run_result（合并 autoPatched / patchedVariables / retries 到 parsedOutput，
  // 供详情页 service 端读取并填入 round DTO）
  const runResultCtx = buildRunResultForCall({
    meta: args.runResultMeta,
    runResultId: args.generateRunResultId,
    source: 'optimization_generate',
    roundIndex: args.roundNumber,
    messages,
    inputVariables: {
      optimizationId: args.optimizationId,
      roundNumber: args.roundNumber,
      stepName: 'error_pattern_generate',
      retries,
      autoPatched,
      promptLanguage,
    },
  });
  if (runResultCtx && deps.runResultWriter) {
    await deps.runResultWriter.writeRunResult({
      ...runResultCtx,
      roundIndex: runResultCtx.roundIndex ?? null,
      rawResponse: finalInvokeResult.content,
      parsedOutput: { ...parsed, autoPatched, patchedVariables, retries },
      decisionOutput: null,
      isCorrect: null,
      judgmentStatus: null,
      status: 'success',
      errorClass: null,
      errorMessage: null,
      latencyMs: finalInvokeResult.durationMs,
      inputTokens: finalInvokeResult.usage.inputTokens,
      outputTokens: finalInvokeResult.usage.outputTokens,
      costEstimate: finalInvokeResult.costEstimate,
    });
  }

  // 校验 LLM 输出的 newOutputSchema:仅在通过白名单约束(加字段/保 type)时才采纳;
  // 校验失败 → warn 并降级为沿用旧 schema(不抛错,避免阻塞 round)。
  let effectiveOutputSchema: unknown = args.currentVersion.outputSchema;
  if (parsed.newOutputSchema !== undefined) {
    const schemaCheck = safeValidateNewOutputSchema(parsed.newOutputSchema, args.currentVersion.outputSchema);
    if (schemaCheck.ok) {
      effectiveOutputSchema = parsed.newOutputSchema;
    } else {
      deps.logger.info(
        {
          optimizationId: args.optimizationId,
          roundNumber: args.roundNumber,
          promptVersionId: args.currentVersion.id,
          level: 'warn',
          errors: schemaCheck.errors,
          rejectedSchema: parsed.newOutputSchema,
        },
        'optimization_generate_new_output_schema_rejected',
      );
      delete parsed.newOutputSchema;
      delete parsed.outputSchemaChangeReason;
    }
  }

  // 桥接成标准 JSON Schema 后再生成「## 输出格式」段；与 experiment.renderer 真实下发拼装路径一致。
  // 落库的 effectiveOutputSchema 保留原形态（DTO 或 LLM 直出的 JSON Schema），交由 workflow 写入新版本。
  const effectiveJsonSchema = outputSchemaToJsonSchema(effectiveOutputSchema);
  const outputFormatInstruction = buildOutputFormatInstruction(effectiveJsonSchema, { language: promptLanguage });
  const composedFullPrompt = composeFullPrompt(parsed.newPromptBody, effectiveJsonSchema, { language: promptLanguage });

  return {
    ...parsed,
    variableValidation: validation,
    budget: {
      baselineInputTokens: baseline.inputTokens,
      errorAnalysisBudgetTokens,
      errorAnalysisTruncated,
      originalErrorAnalysisChars: originalText.length,
      evidenceBundleBudgetTokens: errorAnalysisBudgetTokens,
      evidenceBundleTruncated: fittedEvidence.truncated,
      originalEvidenceBundleTokens: fittedEvidence.originalTokens,
      roundHistoryEntryCount: fittedHistoryResult.entryCount,
      roundHistoryFittedLevel: fittedHistoryResult.level,
      roundHistoryBudgetTokens: fittedHistoryResult.budgetTokens,
      roundHistoryTruncated: fittedHistoryResult.truncated,
    },
    effectiveOutputSchema,
    outputFormatInstruction,
    composedFullPrompt,
    retries,
    autoPatched,
    patchedVariables,
  };
}

function validateAppliedChanges(parsed: GenerateOutput, evidenceBundle: AnalysisEvidenceBundle): void {
  const applied = parsed.appliedChanges ?? [];
  if (applied.length === 0) return;
  const valid = new Set(
    evidenceBundle.suggestedChanges
      .map((c) => c.changeId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const invalid = applied.map((c) => c.changeId).filter((changeId) => changeId && !valid.has(changeId));
  if (invalid.length > 0) {
    throw new InvalidAppliedChangeReferenceError(invalid);
  }
}

function priorityRank(priority: string | undefined): number {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
}

function sortEvidenceBundle(bundle: AnalysisEvidenceBundle): AnalysisEvidenceBundle {
  return {
    ...bundle,
    errorPatterns: [...bundle.errorPatterns].sort(
      (a, b) => (b.affectedCount ?? b.count ?? 0) - (a.affectedCount ?? a.count ?? 0),
    ),
    suggestedChanges: [...bundle.suggestedChanges].sort((a, b) => {
      const byPriority = priorityRank(b.priority) - priorityRank(a.priority);
      if (byPriority !== 0) return byPriority;
      return (b.affectedCount ?? 0) - (a.affectedCount ?? 0);
    }),
    conflicts: [...(bundle.conflicts ?? [])],
  };
}

function fitEvidenceBundleToBudget(
  bundle: AnalysisEvidenceBundle,
  budgetTokens: number,
): { bundle: AnalysisEvidenceBundle; truncated: boolean; originalTokens: number } {
  const originalTokens = estimateMessagesTokens('', JSON.stringify(bundle), 0).inputTokens;
  if (originalTokens <= budgetTokens) {
    return { bundle, truncated: false, originalTokens };
  }

  let fitted: AnalysisEvidenceBundle = sortEvidenceBundle({
    ...bundle,
    summary: truncateLongText(bundle.summary, 1200),
    conflicts: (bundle.conflicts ?? []).slice(0, 5),
  });

  let truncated = fitted.summary !== bundle.summary || fitted.conflicts.length !== (bundle.conflicts ?? []).length;

  while (
    estimateMessagesTokens('', JSON.stringify(fitted), 0).inputTokens > budgetTokens &&
    (fitted.suggestedChanges.length > 1 || fitted.errorPatterns.length > 1)
  ) {
    truncated = true;
    if (fitted.suggestedChanges.length >= fitted.errorPatterns.length && fitted.suggestedChanges.length > 1) {
      fitted = { ...fitted, suggestedChanges: fitted.suggestedChanges.slice(0, -1) };
    } else if (fitted.errorPatterns.length > 1) {
      const keptPatterns = fitted.errorPatterns.slice(0, -1);
      const keptIds = new Set(
        keptPatterns.map((p) => p.patternId).filter((id): id is string => typeof id === 'string'),
      );
      fitted = {
        ...fitted,
        errorPatterns: keptPatterns,
        suggestedChanges: fitted.suggestedChanges.filter(
          (c) =>
            !c.addressesPatternIds ||
            c.addressesPatternIds.length === 0 ||
            c.addressesPatternIds.some((id) => keptIds.has(id)),
        ),
      };
    }
  }

  if (estimateMessagesTokens('', JSON.stringify(fitted), 0).inputTokens > budgetTokens) {
    truncated = true;
    fitted = {
      ...fitted,
      summary: truncateLongText(fitted.summary, 400),
      conflicts: [],
    };
  }

  return { bundle: fitted, truncated, originalTokens };
}

function legacyEvidenceBundle(analysis: AnalyzeFailuresResult): AnalysisEvidenceBundle {
  return {
    evidenceBundleVersion: 1,
    summary: analysis.summary.summary || analysis.errorAnalysisText,
    errorPatterns: analysis.summary.errorPatterns ?? [],
    suggestedChanges: analysis.summary.suggestedChanges ?? [],
    conflicts: analysis.summary.conflicts ?? [],
    sourceStats: {
      batchCount: analysis.batches.length,
      totalConfusionFailures: analysis.totalConfusionFailures,
      totalRegressionSamples: analysis.totalRegressionSamples,
      truncated: analysis.truncated,
    },
  };
}
