// In-memory implementation of the 5 ports — used for integration test assertions
import type {
  OptimizationResult,
  ControlSignal,
  ControlSignalReader,
  ExperimentRunnerInput,
  ExperimentRunnerOutput,
  ExperimentRunnerPort,
  MetricSnapshot,
  PreviousRoundReadInput,
  PreviousRoundRunResultsReaderPort,
  PromptVersionRef,
  PromptVersionWriteInput,
  PromptVersionWriterPort,
  RoundOutcome,
  RoundRecorderPort,
  RunResultRecord,
} from '../../loop/types';

export type RunnerBehavior =
  | ExperimentRunnerOutput
  | ((input: ExperimentRunnerInput, callIndex: number) => ExperimentRunnerOutput | Promise<ExperimentRunnerOutput>);

export class InMemoryExperimentRunner implements ExperimentRunnerPort {
  readonly calls: ExperimentRunnerInput[] = [];
  private behaviors: RunnerBehavior[];
  private idx = 0;

  constructor(behaviors: RunnerBehavior[]) {
    this.behaviors = behaviors;
  }

  async runExperiment(input: ExperimentRunnerInput): Promise<ExperimentRunnerOutput> {
    this.calls.push(input);
    const behavior = this.behaviors[this.idx];
    if (!behavior) {
      throw new Error(`InMemoryExperimentRunner: no behavior configured for call #${this.idx + 1}`);
    }
    this.idx++;
    if (typeof behavior === 'function') {
      return behavior(input, this.idx - 1);
    }
    return behavior;
  }
}

// Default runResults generator — 1 correct + 1 failed (one confusion pair A→B each)
function defaultRunResults(round: number): RunResultRecord[] {
  return [
    {
      id: `rr_${round}_a`,
      sampleId: 'sample_1',
      parsedOutput: { decision: 'A' },
      decisionOutput: 'A',
      isCorrect: true,
    },
    {
      id: `rr_${round}_b`,
      sampleId: 'sample_2',
      parsedOutput: { decision: 'A' },
      decisionOutput: 'A',
      isCorrect: false,
    },
  ];
}

export function runnerFromMetricCurve(
  curve: MetricSnapshot[],
  makeRunResults?: (round: number, metrics: MetricSnapshot) => RunResultRecord[],
): InMemoryExperimentRunner {
  const behaviors: RunnerBehavior[] = curve.map((metrics, idx) => (input) => ({
    experimentId: `exp_${idx + 1}_${input.versionId}`,
    metrics,
    runResults: makeRunResults ? makeRunResults(input.roundNumber, metrics) : defaultRunResults(input.roundNumber),
  }));
  return new InMemoryExperimentRunner(behaviors);
}

export class InMemoryPromptVersionWriter implements PromptVersionWriterPort {
  readonly writes: PromptVersionWriteInput[] = [];
  private counter = 0;

  async writePromptVersion(input: PromptVersionWriteInput): Promise<PromptVersionRef> {
    this.writes.push(input);
    this.counter++;
    return {
      id: `pv_generated_${this.counter}`,
      promptId: input.promptId,
      versionNumber: this.counter + 1,
      body: input.body,
      outputSchema: input.outputSchema,
      judgmentRules: input.judgmentRules,
    };
  }
}

export class InMemoryRoundRecorder implements RoundRecorderPort {
  readonly rounds: RoundOutcome[] = [];
  finalResult: OptimizationResult | null = null;

  async recordRound(round: RoundOutcome): Promise<void> {
    this.rounds.push(round);
  }

  async recordFinal(result: OptimizationResult): Promise<void> {
    this.finalResult = result;
  }
}

export type ControlSignalSequence = ControlSignal[] | ((callIndex: number) => ControlSignal);

export class InMemoryControlSignalReader implements ControlSignalReader {
  private idx = 0;
  private sequence: ControlSignalSequence;

  constructor(sequence: ControlSignalSequence = []) {
    this.sequence = sequence;
  }

  async read(): Promise<ControlSignal> {
    const current = this.idx;
    this.idx++;
    if (typeof this.sequence === 'function') return this.sequence(current);
    return this.sequence[current] ?? null;
  }
}

// Regression reader
// - Array form: indexed by currentRoundNumber-1 (round 1 takes [0], round 2 takes [1] ...)
// - Function form: full control over the return value
// - null form: always returns null (treated as no comparable previous round)
export type PreviousRunResultsSequence =
  | Array<RunResultRecord[] | null>
  | ((input: PreviousRoundReadInput) => RunResultRecord[] | null | Promise<RunResultRecord[] | null>)
  | null;

export class InMemoryPreviousRoundRunResultsReader implements PreviousRoundRunResultsReaderPort {
  readonly calls: PreviousRoundReadInput[] = [];
  private sequence: PreviousRunResultsSequence;

  constructor(sequence: PreviousRunResultsSequence = null) {
    this.sequence = sequence;
  }

  async read(input: PreviousRoundReadInput): Promise<RunResultRecord[] | null> {
    this.calls.push(input);
    if (this.sequence === null) return null;
    if (typeof this.sequence === 'function') return this.sequence(input);
    return this.sequence[input.currentRoundNumber - 1] ?? null;
  }
}

export interface InMemoryPorts {
  experimentRunner: InMemoryExperimentRunner;
  promptVersionWriter: InMemoryPromptVersionWriter;
  roundRecorder: InMemoryRoundRecorder;
  controlSignals: InMemoryControlSignalReader;
  previousRoundRunResultsReader: InMemoryPreviousRoundRunResultsReader;
}

export function makeInMemoryPorts(opts: {
  runner: InMemoryExperimentRunner;
  controlSignals?: ControlSignalSequence;
  previousRunResults?: PreviousRunResultsSequence;
}): InMemoryPorts {
  return {
    experimentRunner: opts.runner,
    promptVersionWriter: new InMemoryPromptVersionWriter(),
    roundRecorder: new InMemoryRoundRecorder(),
    controlSignals: new InMemoryControlSignalReader(opts.controlSignals ?? []),
    previousRoundRunResultsReader: new InMemoryPreviousRoundRunResultsReader(opts.previousRunResults ?? null),
  };
}
