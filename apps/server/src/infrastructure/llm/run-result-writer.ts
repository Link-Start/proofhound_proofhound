import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbClient } from '@proofhound/db';
import type { LLMRunResultRecord, LLMRunResultWriter } from '@proofhound/llm-client';
import { DATABASE_CLIENT } from '../database/database.constants';

// ph_runs.run_results 是按 created_at 月分区,无法对单列 id 加 UNIQUE 约束;
// 用 INSERT ... SELECT ... WHERE NOT EXISTS 做幂等(SPEC 25 §11.2):
//  - DBOS workflow 重试 / replay 时同一 runResultId 不会写重复行
//  - 与 apps/worker/src/runners/run-result-writer.ts 行为等价(双实现差异由抽到 packages 时统一)
@Injectable()
export class DrizzleRunResultWriter implements LLMRunResultWriter {
  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async writeRunResult(record: LLMRunResultRecord): Promise<void> {
    const sampleId = record.sampleId ?? null;
    const externalId = record.externalId ?? null;
    const inputVariables = record.inputVariables ?? null;
    const rawResponse = record.rawResponse ?? null;
    const parsedOutput = record.parsedOutput ?? null;
    const decisionOutput = record.decisionOutput ?? null;
    const expectedOutput = record.expectedOutput ?? null;
    const isCorrect = record.isCorrect ?? null;
    const judgmentStatus = record.judgmentStatus ?? null;
    const errorClass = record.errorClass ?? null;
    const errorMessage = record.errorMessage ?? null;
    const latencyMs = record.latencyMs ?? null;
    const inputTokens = record.inputTokens ?? null;
    const outputTokens = record.outputTokens ?? null;
    const costEstimate = record.costEstimate ?? null;
    const attempt = record.attempt ?? 1;
    const dbosWorkflowId = record.dbosWorkflowId ?? null;
    const bullmqJobId = record.bullmqJobId ?? null;
    const roundIndex = record.roundIndex ?? null;
    const releaseVariantId = record.releaseVariantId ?? null;

    await this.db.execute(sql`
      INSERT INTO ph_runs.run_results (
        id, project_id, source, source_id, release_variant_id, prompt_version_id, model_id,
        sample_id, external_id, rendered_prompt, input_variables,
        raw_response, parsed_output, decision_output, expected_output, is_correct, judgment_status,
        status, error_class, error_message,
        latency_ms, input_tokens, output_tokens, cost_estimate, attempt,
        dbos_workflow_id, bullmq_job_id, round_index
      )
      SELECT
        ${record.id}::uuid, ${record.projectId}::uuid, ${record.source},
        ${record.sourceId}::uuid, ${releaseVariantId}::uuid, ${record.promptVersionId}::uuid, ${record.modelId}::uuid,
        ${sampleId}::uuid, ${externalId},
        ${JSON.stringify(record.renderedPrompt)}::jsonb,
        ${JSON.stringify(inputVariables)}::jsonb,
        ${rawResponse}, ${JSON.stringify(parsedOutput)}::jsonb,
        ${decisionOutput}, ${expectedOutput},
        ${isCorrect}, ${judgmentStatus},
        ${record.status}, ${errorClass}, ${errorMessage},
        ${latencyMs}, ${inputTokens}, ${outputTokens},
        ${costEstimate}, ${attempt},
        ${dbosWorkflowId}, ${bullmqJobId}, ${roundIndex}
      WHERE NOT EXISTS (
        SELECT 1 FROM ph_runs.run_results WHERE id = ${record.id}::uuid
      )
    `);
  }
}
