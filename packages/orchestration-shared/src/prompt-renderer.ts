import {
  composeFullPrompt,
  outputSchemaToJsonSchema,
  type JsonSchemaObject,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptVariableDto,
} from '@proofhound/shared';
import type { LlmJobPayload } from './job-payloads';

export interface PromptVersionForRender {
  body: string;
  variables: PromptVariableDto[];
  outputSchema: PromptOutputSchemaDto;
  promptLanguage?: PromptLanguageDto;
}

export interface SampleForRender {
  data: Record<string, unknown>;
}

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/gu;

function resolveSampleValue(sample: SampleForRender, variable: PromptVariableDto): unknown {
  const fieldKey = variable.datasetField && variable.datasetField.length > 0 ? variable.datasetField : variable.name;
  return sample.data[fieldKey];
}

function stringifyValueForBody(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildInputVariables(promptVersion: PromptVersionForRender, sample: SampleForRender): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const variable of promptVersion.variables) {
    out[variable.name] = resolveSampleValue(sample, variable);
  }
  return out;
}

function buildImageRefs(promptVersion: PromptVersionForRender, sample: SampleForRender): unknown[] | undefined {
  const refs: Array<Record<string, unknown>> = [];
  for (const variable of promptVersion.variables) {
    if (variable.type !== 'image_url' && variable.type !== 'image_base64' && variable.type !== 'image') continue;
    const raw = resolveSampleValue(sample, variable);
    if (raw === undefined || raw === null) continue;
    for (const [index, value] of imageReferenceValues(raw).entries()) {
      refs.push({
        name: variable.name,
        type: resolveImageRefType(variable.type, value),
        value,
        ...(Array.isArray(raw) ? { index } : {}),
      });
    }
  }
  return refs.length === 0 ? undefined : refs;
}

function imageReferenceValues(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [raw];
  return raw.filter((value) => typeof value === 'string' && value.trim().length > 0);
}

function resolveImageRefType(variableType: PromptVariableDto['type'], value: unknown): PromptVariableDto['type'] {
  if (variableType !== 'image' || typeof value !== 'string') return variableType;
  if (/^https?:\/\//iu.test(value)) return 'image_url';
  if (/^data:image\//iu.test(value)) return 'image_base64';
  return 'image';
}

function renderBody(body: string, inputVariables: Record<string, unknown>): string {
  return body.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(inputVariables, name)) {
      return stringifyValueForBody(inputVariables[name]);
    }
    return _match;
  });
}

function buildResponseFormat(jsonSchema: JsonSchemaObject | undefined): unknown {
  if (!jsonSchema) return undefined;
  return {
    type: 'json_schema',
    json_schema: {
      name: 'output',
      schema: jsonSchema,
    },
  };
}

export function renderPromptForSample(
  promptVersion: PromptVersionForRender,
  sample: SampleForRender,
): {
  renderedPrompt: LlmJobPayload['renderedPrompt'];
  inputVariables: Record<string, unknown>;
} {
  const inputVariables = buildInputVariables(promptVersion, sample);
  const renderedBody = renderBody(promptVersion.body, inputVariables);
  const jsonSchema = outputSchemaToJsonSchema(promptVersion.outputSchema);
  // composeFullPrompt 在 jsonSchema 为 undefined 时返回 renderedBody 原样；
  // 有 schema 时按 promptLanguage 追加输出格式段（含 "json" 字面量与 ```json 代码块），
  // 同时满足阿里 DashScope「messages 必须含 json 字样」的硬要求。
  const composedBody = composeFullPrompt(renderedBody, jsonSchema, { language: promptVersion.promptLanguage });
  const messages = [{ role: 'user' as const, content: composedBody }];
  const responseFormat = buildResponseFormat(jsonSchema);
  const imageRefs = buildImageRefs(promptVersion, sample);

  return {
    inputVariables,
    renderedPrompt: {
      messages,
      prompt: composedBody,
      responseFormat,
      imageRefs,
    },
  };
}
