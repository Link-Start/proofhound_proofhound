// LoopDependencies + InvokeLLMDependencies test doubles
import { StubLimiter } from '@proofhound/limiter';
import type {
  InvokeLLMDependencies,
  LLMCallLogger,
  LLMRunResultRecord,
  LLMRunResultWriter,
  ModelInvocationConfig,
} from '@proofhound/llm-client';
import type { LoopDependencies } from '../../loop/types';
import { FakeLLMAdapter, type FakeLLMAdapterOptions } from './fake-llm-adapter';

export class RecordingRunResultWriter implements LLMRunResultWriter {
  readonly records: LLMRunResultRecord[] = [];
  async writeRunResult(record: LLMRunResultRecord): Promise<void> {
    this.records.push(record);
  }
}

export const silentLogger: LLMCallLogger = {
  info() {
    /* no-op */
  },
  error() {
    /* no-op */
  },
};

export function makeAnalysisModel(overrides: Partial<ModelInvocationConfig> = {}): ModelInvocationConfig {
  return {
    id: 'model_analysis_001',
    providerType: 'fake',
    providerModelId: 'fake-haiku',
    endpoint: 'https://fake.local/v1',
    apiKey: 'sk-fake-analysis',
    rpmLimit: 1000,
    tpmLimit: 1_000_000,
    concurrencyLimit: 10,
    inputTokenPricePerMillion: 1,
    outputTokenPricePerMillion: 5,
    ...overrides,
  };
}

export function makeTaskModel(overrides: Partial<ModelInvocationConfig> = {}): ModelInvocationConfig {
  return makeAnalysisModel({
    id: 'model_task_001',
    providerModelId: 'fake-sonnet',
    apiKey: 'sk-fake-task',
    ...overrides,
  });
}

export function makeLoopDependencies(adapter: FakeLLMAdapter): LoopDependencies {
  return {
    llmAdapter: adapter,
    limiter: new StubLimiter(),
    logger: silentLogger,
    now: () => 1_700_000_000_000,
  };
}

export function makeInvokeLLMDependencies(
  adapter: FakeLLMAdapter,
  writer?: LLMRunResultWriter,
): InvokeLLMDependencies {
  return {
    adapters: [adapter],
    limiter: new StubLimiter(),
    logger: silentLogger,
    now: () => 1_700_000_000_000,
    runResultWriter: writer,
  };
}

export function createFakeAdapter(options: FakeLLMAdapterOptions): FakeLLMAdapter {
  return new FakeLLMAdapter(options);
}
