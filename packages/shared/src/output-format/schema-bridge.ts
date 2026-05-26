// Bridges prompt_versions.output_schema into a "standard JSON Schema object", shared between composeFullPrompt
// and the LLM response_format, so both use one conversion logic.
//
// Historically the ph_assets.prompt_versions.output_schema column has stored two shapes:
//   1. {fields:[{key, value, isJudgment}, ...]}  — manually edited / DTO shape
//   2. {type:'object', properties:{...}, ...}    — directly produced by the optimization generate LLM and persisted
// Therefore the bridge function recognizes both input shapes. Anything else returns undefined (the caller should treat it as "no schema").

export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: boolean;
}

interface OutputSchemaFieldLike {
  key: string;
  value?: string;
  isJudgment?: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isOutputSchemaDto(v: unknown): v is { fields: OutputSchemaFieldLike[] } {
  if (!isPlainObject(v)) return false;
  return Array.isArray((v as { fields?: unknown }).fields);
}

function isJsonSchemaObject(v: unknown): v is JsonSchemaObject {
  if (!isPlainObject(v)) return false;
  const t = (v as { type?: unknown }).type;
  const props = (v as { properties?: unknown }).properties;
  return (t === undefined || t === 'object') && isPlainObject(props);
}

export function outputSchemaToJsonSchema(outputSchema: unknown): JsonSchemaObject | undefined {
  if (outputSchema === null || outputSchema === undefined) return undefined;

  if (isOutputSchemaDto(outputSchema)) {
    const fields = outputSchema.fields ?? [];
    if (fields.length === 0) return undefined;
    return {
      type: 'object',
      properties: Object.fromEntries(
        fields.map((field) => [
          field.key,
          {
            type: 'string',
            description: field.value && field.value.length > 0 ? field.value : undefined,
          },
        ]),
      ),
      required: fields.map((field) => field.key),
      additionalProperties: false,
    };
  }

  if (isJsonSchemaObject(outputSchema)) {
    const properties = outputSchema.properties;
    const rawRequired = (outputSchema as { required?: unknown }).required;
    const required = Array.isArray(rawRequired)
      ? rawRequired.filter((k): k is string => typeof k === 'string')
      : Object.keys(properties);
    const rawAdditional = (outputSchema as { additionalProperties?: unknown }).additionalProperties;
    const additionalProperties = typeof rawAdditional === 'boolean' ? rawAdditional : false;
    return { type: 'object', properties, required, additionalProperties };
  }

  return undefined;
}
