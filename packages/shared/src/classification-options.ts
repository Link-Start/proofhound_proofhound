import type { PromptOutputSchemaDto } from './dto/prompt.dto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanClassificationOption(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'`[\]{}()<>]+|[\s"'`[\]{}()<>]+$/gu, '')
    .trim();
}

function uniqueOptions(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanClassificationOption).filter((value) => value.length > 0)));
}

export function extractClassificationOptionsFromText(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  const quoted = Array.from(text.matchAll(/["'`]([^"'`]+)["'`]/gu), (match) =>
    cleanClassificationOption(match[1] ?? ''),
  ).filter(Boolean);
  if (quoted.length > 1) return uniqueOptions(quoted);

  const afterLabel = text.includes(':')
    ? text.split(':').slice(1).join(':')
    : text.includes('：')
      ? text.split('：').slice(1).join('：')
      : text;

  const parts = afterLabel
    .split(/[|/,，、;；\n]+|\s+(?:or|and|或者|或|和|与)\s+|(?:或者|或)/iu)
    .map(cleanClassificationOption)
    .filter((part) => part.length > 0 && part.length <= 160);

  return uniqueOptions(parts);
}

function readOptionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueOptions(
    value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!isRecord(item)) return '';
        return String(item.value ?? item.label ?? item.name ?? '');
      })
      .filter(Boolean),
  );
}

function readOptionsFromField(field: Record<string, unknown>): string[] {
  const direct = [
    ...readOptionValues(field.options),
    ...readOptionValues(field.values),
    ...readOptionValues(field.enum),
  ];
  if (direct.length > 0) return direct;
  return extractClassificationOptionsFromText(String(field.value ?? field.description ?? ''));
}

export function deriveClassificationOptionsFromPromptOutputSchema(
  outputSchema: PromptOutputSchemaDto | unknown,
): string[] {
  if (!isRecord(outputSchema) || !Array.isArray(outputSchema.fields)) return [];

  const values = new Set<string>();
  for (const field of outputSchema.fields) {
    if (!isRecord(field)) continue;
    if (!(field.isJudgment ?? field.is_decision ?? field.judgment)) continue;
    for (const option of readOptionsFromField(field)) values.add(option);
  }
  return Array.from(values);
}

export function deriveClassificationOptionsFromPromptVersionSnapshot(snapshot: unknown): string[] {
  if (!isRecord(snapshot)) return [];
  return deriveClassificationOptionsFromPromptOutputSchema(snapshot.outputSchema ?? snapshot.output_schema);
}

export function deriveClassificationOptionsFromAnnotationSchema(schema: unknown): string[] {
  const fields = Array.isArray(schema)
    ? schema
    : isRecord(schema) && Array.isArray(schema.fields)
      ? schema.fields
      : [];

  const expectedOutputField = fields
    .filter(isRecord)
    .find((field) => String(field.name ?? field.key ?? '') === 'expected_output');
  return expectedOutputField ? readOptionsFromField(expectedOutputField) : [];
}

export function formatClassificationAnnotationValue(value: string): string {
  return cleanClassificationOption(value);
}

export function parseClassificationAnnotationValue(value: string, options: readonly string[] = []): string[] {
  const cleaned = cleanClassificationOption(value);
  if (!cleaned) return [];
  if (options.includes(cleaned)) return [cleaned];

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) return uniqueOptions(parsed.map((item) => String(item)));
  } catch {
    // Fall back to delimiter-based parsing.
  }

  return extractClassificationOptionsFromText(cleaned);
}

export function normalizeClassificationAnnotationValue(value: string, options: readonly string[] = []): string | null {
  const parsed = parseClassificationAnnotationValue(value, options);
  if (parsed.length !== 1) return null;
  const selected = parsed[0] ?? '';
  if (options.length > 0 && !options.includes(selected)) return null;
  return selected;
}
