// 按 system prompt 内容嗅探来分流响应的 LLMAdapter 替身
import type { AdapterInvokeArgs, AdapterInvokeResult, LLMAdapter, LLMMessage } from '@proofhound/llm-client';

export type AnalyzeStep =
  | 'confusion'
  | 'regression'
  | 'summarize'
  | 'generate'
  | 'generateInitial'
  | 'unknown';

export interface FakeAdapterCall {
  step: AnalyzeStep;
  messages: LLMMessage[] | undefined;
  params: AdapterInvokeArgs['params'];
  systemPrompt: string;
  userPrompt: string;
}

export interface FakeStepResponse {
  content: string;
  finishReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

export type StepResponseConfig =
  | FakeStepResponse
  | FakeStepResponse[]
  | ((call: FakeAdapterCall, idx: number) => FakeStepResponse);

export interface FakeLLMAdapterOptions {
  confusion?: StepResponseConfig;
  regression?: StepResponseConfig;
  summarize?: StepResponseConfig;
  generate?: StepResponseConfig;
  generateInitial?: StepResponseConfig;
}

function detectStep(systemPrompt: string): AnalyzeStep {
  if (systemPrompt.includes('混淆对分析子任务')) return 'confusion';
  if (systemPrompt.includes('回归样本分析子任务')) return 'regression';
  if (systemPrompt.includes('错误模式分析汇总师')) return 'summarize';
  // 顺序敏感:首版生成的 system prompt 也含"提示词",但角色名"首版提示词草拟工程师"独特,放在 generate 之前匹配
  if (systemPrompt.includes('首版提示词草拟工程师')) return 'generateInitial';
  if (systemPrompt.includes('提示词改写工程师')) return 'generate';
  return 'unknown';
}

function extractText(content: LLMMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const text = (part as Record<string, unknown>).text;
        return typeof text === 'string' ? text : '';
      })
      .join('\n');
  }
  return '';
}

export class FakeLLMAdapter implements LLMAdapter {
  readonly providerType = 'fake';
  readonly calls: FakeAdapterCall[] = [];
  private counts: Record<AnalyzeStep, number> = {
    confusion: 0,
    regression: 0,
    summarize: 0,
    generate: 0,
    generateInitial: 0,
    unknown: 0,
  };
  private steps: FakeLLMAdapterOptions;

  constructor(options: FakeLLMAdapterOptions) {
    this.steps = options;
  }

  async invoke(args: AdapterInvokeArgs): Promise<AdapterInvokeResult> {
    const messages = args.messages ?? [];
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsg = messages.find((m) => m.role === 'user');
    const systemPrompt = systemMsg ? extractText(systemMsg.content) : '';
    const userPrompt = userMsg ? extractText(userMsg.content) : (args.prompt ?? '');
    const step = detectStep(systemPrompt);

    const call: FakeAdapterCall = { step, messages: args.messages, params: args.params, systemPrompt, userPrompt };
    this.calls.push(call);
    const idx = this.counts[step];
    this.counts[step] = idx + 1;

    const cfg =
      step === 'confusion'
        ? this.steps.confusion
        : step === 'regression'
          ? this.steps.regression
          : step === 'summarize'
            ? this.steps.summarize
            : step === 'generate'
              ? this.steps.generate
              : step === 'generateInitial'
                ? this.steps.generateInitial
                : undefined;

    if (!cfg) {
      throw new Error(
        `FakeLLMAdapter: no response configured for step="${step}" (systemPrompt head="${systemPrompt.slice(0, 60)}")`,
      );
    }

    let resp: FakeStepResponse;
    if (typeof cfg === 'function') {
      resp = cfg(call, idx);
    } else if (Array.isArray(cfg)) {
      const item = cfg[idx] ?? cfg[cfg.length - 1];
      if (!item) throw new Error(`FakeLLMAdapter: ran out of responses for step="${step}" at call #${idx + 1}`);
      resp = item;
    } else {
      resp = cfg;
    }

    return {
      content: resp.content,
      rawResponse: { fake: true, step, content: resp.content },
      finishReason: resp.finishReason ?? 'stop',
      usage: { inputTokens: resp.inputTokens ?? 100, outputTokens: resp.outputTokens ?? 200 },
    };
  }

  callsFor(step: AnalyzeStep): FakeAdapterCall[] {
    return this.calls.filter((c) => c.step === step);
  }
}
