// BullmqService 的测试替身:不连 Redis,enqueue 时直接把 run_result 写进 ph_runs.run_results
// 模拟 worker 完成,让 ExperimentWorkflow 的 pollUntilBatchDone 立即满足。

import type { DbClient } from '@proofhound/db';
import { createLogger } from '@proofhound/logger';
import type { LlmJobPayload } from '@proofhound/orchestration-shared';
import { sql } from 'drizzle-orm';

const logger = createLogger('bullmq.mock', { service: 'integration-test' });

export type MockBullmqBehavior =
  | 'all_success' // 每个 sample 都写 status='success', judgment='correct'
  | 'all_error' // 每个 sample 都写 status='error', judgment=null
  | 'never_complete'; // 不写 run_result,让 workflow 一直 poll(测超时用,慎用)

export interface EnqueueCall {
  payload: LlmJobPayload;
  runResultId: string;
}

export class MockBullmqService {
  private behavior: MockBullmqBehavior = 'all_success';
  private calls: EnqueueCall[] = [];

  constructor(private readonly db: DbClient) {}

  setBehavior(behavior: MockBullmqBehavior): void {
    this.behavior = behavior;
    logger.debug({ behavior }, 'mock_set_behavior');
  }

  getCalls(): EnqueueCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.behavior = 'all_success';
    this.calls = [];
  }

  // 与真实 BullmqService.enqueueLlmJob 同签名
  async enqueueLlmJob(payload: LlmJobPayload, runResultId?: string): Promise<string> {
    const rrId = runResultId ?? payload.runResultId;
    if (!rrId) {
      throw new Error('mock_bullmq_missing_run_result_id');
    }
    this.calls.push({ payload, runResultId: rrId });
    logger.debug(
      {
        behavior: this.behavior,
        sourceId: payload.sourceId,
        sampleId: payload.sampleId,
        runResultId: rrId,
      },
      'mock_enqueue_llm_job',
    );

    if (this.behavior === 'never_complete') {
      return rrId;
    }

    const status: 'success' | 'error' = this.behavior === 'all_error' ? 'error' : 'success';
    const expectedOutputStr = String(payload.judgment?.expectedOutput ?? '');
    const decisionOutput = status === 'success' ? expectedOutputStr : null;
    const judgmentStatus = status === 'success' ? 'correct' : null;
    const isCorrect = status === 'success';

    const renderedPromptJson = JSON.stringify(payload.renderedPrompt);
    const inputVariablesJson = JSON.stringify(payload.inputVariables ?? {});
    await this.db.execute(sql`
      INSERT INTO ph_runs.run_results
        (id, project_id, source, source_id, prompt_version_id, model_id, sample_id,
         rendered_prompt, input_variables,
         status, is_correct, decision_output, expected_output, judgment_status,
         input_tokens, output_tokens, attempt)
      VALUES
        (${rrId}::uuid, ${payload.projectId}::uuid, ${payload.source}, ${payload.sourceId}::uuid,
         ${payload.promptVersionId}::uuid, ${payload.modelId}::uuid, ${payload.sampleId ?? null}::uuid,
         ${renderedPromptJson}::jsonb, ${inputVariablesJson}::jsonb,
         ${status}, ${isCorrect}, ${decisionOutput}, ${expectedOutputStr}, ${judgmentStatus},
         10, 5, 1)
    `);

    return rrId;
  }
}
