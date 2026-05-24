interface JsonParseResult {
  ok: boolean;
  value: unknown;
}

const MARKDOWN_JSON_FENCE_PATTERNS = [
  /^```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu,
  /^~~~[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n~~~$/iu,
];

export function parseJsonResponseWithMarkdownFallback(content: string): unknown {
  const strict = tryParseJson(content);
  if (strict.ok) return strict.value;

  const markdownJson = extractMarkdownJsonFence(content);
  if (markdownJson === null) return null;

  const fallback = tryParseJson(markdownJson);
  return fallback.ok ? fallback.value : null;
}

function tryParseJson(content: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch {
    return { ok: false, value: null };
  }
}

function extractMarkdownJsonFence(content: string): string | null {
  const trimmed = content.trim();

  for (const pattern of MARKDOWN_JSON_FENCE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}
