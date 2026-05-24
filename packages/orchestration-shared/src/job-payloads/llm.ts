import { z } from 'zod';
import { webhookAsyncCallContextSchema } from '../webhook-async-call';

export const LLM_SOURCES = [
  'experiment',
  'optimization_analysis',
  'optimization_generate',
  'release',
] as const;
export type LlmJobSource = (typeof LLM_SOURCES)[number];

const llmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});

const renderedPromptSchema = z.object({
  messages: z.array(llmMessageSchema).optional(),
  prompt: z.string().optional(),
  tools: z.unknown().optional(),
  responseFormat: z.unknown().optional(),
  imageRefs: z.unknown().optional(),
});

const inferenceSchema = z.object({
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().optional(),
  apiVersion: z.string().optional(),
});

// 实验级 / 优化级"自我节流"上限：worker 在 invokeLLM 前与 model 级配额取 min；
// 模型级始终是天花板（SPEC 21 §配额 / SPEC 24 §4：所有调用通道共用同一份模型配额）。
const runtimeLimitsSchema = z.object({
  rpmLimit: z.number().int().positive().optional(),
  tpmLimit: z.number().int().positive().optional(),
  concurrency: z.number().int().positive().optional(),
});

// 单条样本 LLM 调用的内部重试上限；不影响 BullMQ job 级 attempts。
const runtimeRetrySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export const llmJudgmentContextSchema = z.object({
  outputSchema: z.unknown(),
  judgmentRules: z.unknown(),
  expectedOutput: z.unknown().optional(),
});
export type LlmJudgmentContext = z.infer<typeof llmJudgmentContextSchema>;

export const llmJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  source: z.enum(LLM_SOURCES),
  sourceId: z.string().uuid(),
  releaseVariantId: z.string().uuid().nullable().optional(),
  promptVersionId: z.string().uuid(),
  modelId: z.string().uuid(),
  runResultId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  promptId: z.string().uuid().optional(),
  sampleId: z.string().uuid().nullable().optional(),
  externalId: z.string().nullable().optional(),
  // 由 enqueue 端(实验 / 优化 workflow 在 step 内通过 DBOS.workflowID 取值)注入,
  // worker 端透传到 LLM 调用日志与 ph_runs.run_results.dbos_workflow_id;发布 runner 来源为 undefined
  dbosWorkflowId: z.string().optional(),
  renderedPrompt: renderedPromptSchema,
  inputVariables: z.unknown().optional(),
  inference: inferenceSchema.optional(),
  limits: runtimeLimitsSchema.optional(),
  retry: runtimeRetrySchema.optional(),
  judgment: llmJudgmentContextSchema.optional(),
  webhookAsyncCall: webhookAsyncCallContextSchema.optional(),
});

export type LlmJobPayload = z.infer<typeof llmJobPayloadSchema>;
