import { DEFAULT_PROMPT_LANGUAGE, type PromptLanguageDto } from '../dto/prompt.dto';

// 输出格式段构造器 — 从 prompt_version.outputSchema 自动生成「## 输出格式」指令。
//
// 设计意图（详见 docs/specs/23-prompts.md 自描述原则）：
// prompt body / variables / output_schema / judgment_rules / prompt_language 是版本执行契约；
// body 不应重复
// output_schema 的语义。优化生成的 newPromptBody 只承载「任务 / 角色 / 指引 / 示例」，
// 运行时再由本模块从 outputSchema 自动拼出输出格式段，保证输出契约稳定。
//
// 仅识别 JSON Schema (draft-7 兼容) 中最常见的 type=object + properties 形态；
// 对识别不出的 schema 降级为原样 JSON.stringify 包裹在 ```json 代码块里。

interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  description?: string;
  items?: JsonSchemaProperty;
}

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface OutputFormatInstructionOptions {
  language?: PromptLanguageDto;
}

const COPY: Record<
  PromptLanguageDto,
  {
    heading: string;
    schemaInstruction: string;
    objectInstruction: string;
    emptyObjectInstruction: string;
    fieldDescriptions: string;
    enumPrefix: string;
    typePrefix: string;
    bulletColon: string;
    partSeparator: string;
  }
> = {
  'zh-CN': {
    heading: '## 输出格式',
    schemaInstruction: '请严格按以下 JSON Schema 输出对应的 JSON（仅输出 JSON，不要任何额外字符）：',
    objectInstruction: '请严格按以下 JSON 输出（仅输出 JSON 对象，不要任何额外字符，不要 Markdown 包裹）：',
    emptyObjectInstruction: '请输出一个合法 JSON 对象（无强约束字段）。',
    fieldDescriptions: '字段说明：',
    enumPrefix: '枚举值，必须是以下之一：',
    typePrefix: '类型',
    bulletColon: '：',
    partSeparator: '；',
  },
  'en-US': {
    heading: '## Output Format',
    schemaInstruction: 'Output JSON that strictly follows this JSON Schema. Output only JSON with no extra text:',
    objectInstruction:
      'Output JSON that strictly follows this shape. Output only a JSON object with no extra text and no Markdown wrapper:',
    emptyObjectInstruction: 'Output a valid JSON object. No additional fields are constrained.',
    fieldDescriptions: 'Field descriptions:',
    enumPrefix: 'Enum value; must be one of: ',
    typePrefix: 'Type',
    bulletColon: ': ',
    partSeparator: '; ',
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isObjectSchema(schema: unknown): schema is JsonSchemaObject {
  if (!isPlainObject(schema)) return false;
  const t = (schema as { type?: unknown }).type;
  const props = (schema as { properties?: unknown }).properties;
  return (t === undefined || t === 'object') && isPlainObject(props);
}

function placeholderFor(prop: JsonSchemaProperty): string {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    return `<${prop.enum.map((v) => String(v)).join(' | ')}>`;
  }
  switch (prop.type) {
    case 'string':
      return '<string>';
    case 'number':
    case 'integer':
      return '<number>';
    case 'boolean':
      return '<boolean>';
    case 'array':
      return prop.items ? `[${placeholderFor(prop.items)}, ...]` : '[<...>]';
    case 'object':
      return '{...}';
    default:
      return '<value>';
  }
}

function getCopy(language: PromptLanguageDto | undefined) {
  return COPY[language ?? DEFAULT_PROMPT_LANGUAGE] ?? COPY[DEFAULT_PROMPT_LANGUAGE];
}

function describeField(name: string, prop: JsonSchemaProperty, language: PromptLanguageDto): string {
  const parts: string[] = [];
  const copy = getCopy(language);
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    parts.push(`${copy.enumPrefix}${prop.enum.map((v) => `\`${String(v)}\``).join(' / ')}`);
  } else if (prop.type) {
    parts.push(`${copy.typePrefix} \`${prop.type}\``);
  }
  if (prop.description) parts.push(prop.description);
  return `- \`${name}\`${copy.bulletColon}${parts.join(copy.partSeparator)}`;
}

/**
 * 从 outputSchema 自动生成中文「## 输出格式」段。
 *
 * - JSON Schema (type=object + properties)：列出 JSON 模板 + 字段说明（含 enum labels）。
 * - 缺失 / 非对象：返回空字符串（调用方应跳过拼接）。
 * - 无法识别的 schema 结构：降级为 JSON.stringify 包裹的 schema 块。
 */
export function buildOutputFormatInstruction(
  outputSchema: unknown,
  options: OutputFormatInstructionOptions = {},
): string {
  if (outputSchema === undefined || outputSchema === null) return '';
  const language = options.language ?? DEFAULT_PROMPT_LANGUAGE;
  const copy = getCopy(language);

  if (!isObjectSchema(outputSchema)) {
    return [copy.heading, '', copy.schemaInstruction, '', '```json', JSON.stringify(outputSchema, null, 2), '```'].join(
      '\n',
    );
  }

  const properties = outputSchema.properties ?? {};
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return [copy.heading, '', copy.emptyObjectInstruction].join('\n');
  }

  const templateLines = entries.map(([name, prop], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    return `  "${name}": ${placeholderFor(prop)}${comma}`;
  });
  const fieldDescriptions = entries.map(([name, prop]) => describeField(name, prop, language));

  return [
    copy.heading,
    '',
    copy.objectInstruction,
    '',
    '```json',
    '{',
    ...templateLines,
    '}',
    '```',
    '',
    copy.fieldDescriptions,
    ...fieldDescriptions,
  ].join('\n');
}

/**
 * 拼接 LLM 生成的 prompt body 与自动生成的输出格式段。
 * 业务 LLM 调用方调用本函数得到「最终发给业务模型的完整 prompt」。
 */
export function composeFullPrompt(
  body: string,
  outputSchema: unknown,
  options: OutputFormatInstructionOptions = {},
): string {
  const instruction = buildOutputFormatInstruction(outputSchema, options);
  if (instruction.length === 0) return body;
  return `${body.trimEnd()}\n\n${instruction}`;
}
