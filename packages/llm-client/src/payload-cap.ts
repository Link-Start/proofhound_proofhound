import { createHash } from 'node:crypto';

// 256KB 应用日志硬上限兜底（docs/specs/05-logging.md §5.6）
export const MAX_LLM_LOG_PAYLOAD_BYTES = 256 * 1024;
const PAYLOAD_SUMMARY_CHARS = 4 * 1024;

export interface CappedPayload<T> {
  payload: T | PayloadOverflowSummary;
  overflow: boolean;
  bytes: number;
}

export interface PayloadOverflowSummary {
  payload_overflow: true;
  payload_bytes: number;
  payload_sha256: string;
  head: string;
  tail: string;
}

export function capLLMLogPayload<T>(payload: T, maxBytes = MAX_LLM_LOG_PAYLOAD_BYTES): CappedPayload<T> {
  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  if (bytes <= maxBytes) {
    return { payload, overflow: false, bytes };
  }

  return {
    payload: {
      payload_overflow: true,
      payload_bytes: bytes,
      payload_sha256: createHash('sha256').update(serialized).digest('hex'),
      head: serialized.slice(0, PAYLOAD_SUMMARY_CHARS),
      tail: serialized.slice(-PAYLOAD_SUMMARY_CHARS),
    },
    overflow: true,
    bytes,
  };
}
