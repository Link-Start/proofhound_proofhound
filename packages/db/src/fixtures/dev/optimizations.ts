export type DevOptimizationGoal = {
  metric: 'accuracy' | 'precision' | 'recall' | 'f1' | 'fpr';
  comparator: 'gte' | 'gt' | 'lte';
  target: number;
  scope: string;
};

export type DevOptimizationFieldWhitelist = {
  inputFields: string[];
  metaFields: string[];
};

export type DevOptimizationFixture = {
  id: string;
  name: string;
  description: string | null;
  optimizationHint: string | null;
  strategy: string;
  strategyConfig: Record<string, unknown>;
  startingMode: 'from_experiment' | 'from_prompt_version' | 'from_dataset_only';
  sourceExperimentId: string | null;
  promptId: string | null;
  baseVersionId: string | null;
  datasetId: string;
  experimentModelId: string;
  analysisModelId: string;
  promptLanguage: 'zh-CN' | 'en-US';
  status: 'running' | 'success' | 'failed' | 'stopped' | 'cancelled';
  dbosWorkflowId: string | null;
  controlState: 'stop' | 'resume' | 'cancel' | null;
  goals: DevOptimizationGoal[];
  fieldWhitelist: DevOptimizationFieldWhitelist | null;
  runConfig: Record<string, unknown>;
  maxRounds: number;
  currentRound: number;
  bestVersionId: string | null;
  bestMetrics: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  analysisFailureReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DevOptimizationRoundStepFixture = {
  id: string;
  optimizationId: string;
  roundIndex: number;
  step: 'error_analysis' | 'generate_prompt' | 'experiment';
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  errorClass: string | null;
  errorMessage: string | null;
  runResultId: string | null;
  experimentId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempt: number;
  dbosWorkflowId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const DEV_OPTIMIZATIONS: DevOptimizationFixture[] = [
  {
    id: '1f9d680e-355c-4f14-a0b6-aef5e6c062c6',
    name: 'iter-2026-0523-',
    description: null,
    optimizationHint: null,
    strategy: 'error_pattern_analysis',
    strategyConfig: {},
    startingMode: 'from_experiment',
    sourceExperimentId: 'ef6c9622-7fe1-455b-a4fd-85176f80bce5',
    promptId: '246bc6d3-8ac9-43d5-a055-f9098884e227',
    baseVersionId: '6f06843e-f897-473e-b0e4-4bbdd0a56fda',
    datasetId: 'db945aa9-fe6e-4591-9b99-42f0b4dd567e',
    experimentModelId: '826d092f-0afa-4e01-b223-d608d1db519d',
    analysisModelId: '45be9255-88d5-4e32-b650-ba624f33c8f0',
    promptLanguage: 'en-US',
    status: 'success',
    dbosWorkflowId: 'optimization:1f9d680e-355c-4f14-a0b6-aef5e6c062c6:start:1779519869340',
    controlState: null,
    goals: [
      {
        scope: 'overall',
        metric: 'accuracy',
        target: 0.95,
        comparator: 'gte',
      },
    ],
    fieldWhitelist: {
      metaFields: [],
      inputFields: ['text'],
    },
    runConfig: {
      retries: 0,
      rpmLimit: 60,
      tpmLimit: 120000,
      concurrency: 8,
      temperature: 0,
      imageEncoding: 'url',
      sampleTimeoutSeconds: 20,
    },
    maxRounds: 5,
    currentRound: 1,
    bestVersionId: '8eab5ca8-08f2-5bdc-b69e-bedf4c6f188e',
    bestMetrics: {
      f1: 0.9589490968801313,
      recall: 0.9545454545454546,
      accuracy: 0.96,
      precision: 0.9666666666666667,
      inputTokens: 21913,
      costEstimate: 0.004593,
      outputTokens: 4750,
      p50LatencyMs: 3982.5,
      p95LatencyMs: 21245.499999999956,
      averageLatencyMs: 5980.26,
    },
    summary: {
      kind: 'success',
      reason: 'goals_met',
      finalizedAt: '2026-05-23T07:07:33.643Z',
    },
    analysisFailureReason: null,
    startedAt: '2026-05-23T07:04:29.379Z',
    finishedAt: '2026-05-23T07:07:33.643Z',
    createdAt: '2026-05-23T07:04:29.336Z',
    updatedAt: '2026-05-23T07:07:33.643Z',
  },
];

export const DEV_OPTIMIZATION_ROUND_STEPS: DevOptimizationRoundStepFixture[] = [
  {
    id: '713007de-9b21-4112-8b08-ec7354be4d4f',
    optimizationId: '1f9d680e-355c-4f14-a0b6-aef5e6c062c6',
    roundIndex: 1,
    step: 'error_analysis',
    status: 'success',
    errorClass: null,
    errorMessage: null,
    experimentId: null,
    startedAt: '2026-05-23T07:04:29.406Z',
    finishedAt: '2026-05-23T07:05:28.433Z',
    attempt: 0,
    dbosWorkflowId: 'optimization:1f9d680e-355c-4f14-a0b6-aef5e6c062c6:start:1779519869340',
    createdAt: '2026-05-23T07:04:29.407Z',
    updatedAt: '2026-05-23T07:05:28.433Z',
    runResultId: null,
  },
  {
    id: 'c0c44caf-a91e-4c04-ae70-a85f749bd39a',
    optimizationId: '1f9d680e-355c-4f14-a0b6-aef5e6c062c6',
    roundIndex: 1,
    step: 'experiment',
    status: 'success',
    errorClass: null,
    errorMessage: null,
    experimentId: '7c54873b-8d0a-5003-8cfb-26f8b8ba7096',
    startedAt: '2026-05-23T07:05:49.538Z',
    finishedAt: '2026-05-23T07:07:33.635Z',
    attempt: 0,
    dbosWorkflowId: 'optimization:1f9d680e-355c-4f14-a0b6-aef5e6c062c6:start:1779519869340',
    createdAt: '2026-05-23T07:05:49.538Z',
    updatedAt: '2026-05-23T07:07:33.636Z',
    runResultId: null,
  },
  {
    id: 'd7b1d0b0-ac1b-4b9c-94c8-86012a3a9c96',
    optimizationId: '1f9d680e-355c-4f14-a0b6-aef5e6c062c6',
    roundIndex: 1,
    step: 'generate_prompt',
    status: 'success',
    errorClass: null,
    errorMessage: null,
    experimentId: null,
    startedAt: '2026-05-23T07:05:28.438Z',
    finishedAt: '2026-05-23T07:05:49.524Z',
    attempt: 0,
    dbosWorkflowId: 'optimization:1f9d680e-355c-4f14-a0b6-aef5e6c062c6:start:1779519869340',
    createdAt: '2026-05-23T07:05:28.438Z',
    updatedAt: '2026-05-23T07:05:49.524Z',
    runResultId: null,
  },
];
