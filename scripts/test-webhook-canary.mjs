#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATASET = '@datasets/chnsenticorp/subsets/random-50/chnsenticorp-random-50.csv';
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'cancelled', 'expired']);
const ASYNC_SUCCESS_STATUSES = new Set(['completed', 'success']);
const ASYNC_PENDING_STATUSES = new Set(['accepted', 'pending', 'queued', 'running', 'processing']);

const HELP = `
Usage:
  pnpm test:webhook:canary -- --mode both --sync-url http://localhost:4000/webhooks/project/sync --async-url http://localhost:4000/webhooks/project/async --token <PROJECT_API_TOKEN>

Options:
  --mode <sync|async|both>       Mode to exercise. Default: both
  --url <url>                    Webhook URL used when a mode-specific URL is not provided
  --sync-url <url>               Webhook URL for sync connector mode
  --async-url <url>              Webhook URL for async connector mode
  --async-query-url <url>        Async query URL template. Use {call_id}; otherwise /calls/:call_id is appended to --async-url
  --token <token>                Project API token. Also reads PROOFHOUND_WEBHOOK_TOKEN or PROJECT_API_TOKEN
  --dataset <path>               CSV path. Default: ${DEFAULT_DATASET}
  --id-field <name>              CSV id column. Default: sample_id
  --text-field <name>            CSV text column. Default: text
  --offset <n>                   Number of rows to skip. Default: 0
  --limit <n>                    Number of rows to send. Default: 1
  --concurrency <n>              Concurrent requests per mode. Default: 1
  --timeout-ms <n>               Per HTTP request timeout. Default: 60000
  --poll-timeout-ms <n>          Async polling timeout per row. Default: 120000
  --poll-interval-ms <n>         Async polling interval. Default: 1000
  --dry-run                      Print resolved payloads without sending requests
  --verbose                      Print successful responses
  --help                         Show this help

Environment:
  PROOFHOUND_WEBHOOK_URL, PROOFHOUND_WEBHOOK_SYNC_URL, PROOFHOUND_WEBHOOK_ASYNC_URL,
  PROOFHOUND_WEBHOOK_ASYNC_QUERY_URL, PROOFHOUND_WEBHOOK_TOKEN, PROJECT_API_TOKEN
`;

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(HELP.trimStart());
    return;
  }

  const options = normalizeOptions(flags);
  const rows = loadDataset(options);
  const modes = options.mode === 'both' ? ['sync', 'async'] : [options.mode];

  console.log(`Dataset: ${options.datasetPath}`);
  const payloadFields = rows[0] ? Object.keys(rows[0].payload).join(', ') : '(none)';
  console.log(`Rows: ${rows.length}; payload fields: ${payloadFields}`);
  console.log(`Mode: ${options.mode}; concurrency: ${options.concurrency}`);

  if (options.dryRun) {
    console.log('Dry run: no HTTP requests will be sent.');
    console.log(`Sync URL: ${options.syncUrl ?? '(not set)'}`);
    console.log(`Async URL: ${options.asyncUrl ?? '(not set)'}`);
    console.log('Sample payloads:');
    for (const row of rows.slice(0, 3)) console.log(JSON.stringify(row.payload));
    return;
  }

  const summaries = [];
  for (const mode of modes) {
    const url = mode === 'sync' ? options.syncUrl : options.asyncUrl;
    if (!url) {
      throw new Error(`Missing ${mode} webhook URL. Pass --${mode}-url or --url.`);
    }
    summaries.push(await exerciseMode(mode, url, rows, options));
  }

  const failed = summaries.reduce((sum, item) => sum + item.failed, 0);
  for (const item of summaries) {
    const p50 = percentile(item.latenciesMs, 50);
    const p95 = percentile(item.latenciesMs, 95);
    console.log(
      `[${item.mode}] summary: ok=${item.ok} failed=${item.failed} p50=${formatMs(p50)} p95=${formatMs(p95)}`,
    );
  }

  if (failed > 0) process.exitCode = 1;
}

async function exerciseMode(mode, url, rows, options) {
  console.log(`[${mode}] target: ${url}`);
  const summary = { mode, ok: 0, failed: 0, latenciesMs: [] };

  await runWithConcurrency(rows, options.concurrency, async (row, index) => {
    const startedAt = Date.now();
    try {
      const response =
        mode === 'sync' ? await sendSync(url, row.payload, options) : await sendAsync(url, row.payload, options);
      const elapsedMs = Date.now() - startedAt;
      summary.ok += 1;
      summary.latenciesMs.push(elapsedMs);
      const status = getResponseStatus(response.data) ?? response.httpStatus;
      const externalId = getExternalId(response.data);
      const modelOutput = formatModelOutput(response.data);
      console.log(
        [
          `[${mode}] ${index + 1}/${rows.length} ${row.id} ok ${formatMs(elapsedMs)} status=${status}${externalId ? ` external_id=${externalId}` : ''}`,
          modelOutput ? `[${mode}] ${row.id} model output: ${modelOutput}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      if (options.verbose) {
        console.log(JSON.stringify(response.data, null, 2));
      }
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      summary.failed += 1;
      console.error(
        `[${mode}] ${index + 1}/${rows.length} ${row.id} failed ${formatMs(elapsedMs)}: ${formatError(error)}`,
      );
    }
  });

  return summary;
}

async function sendSync(url, payload, options) {
  const response = await requestJson(url, {
    method: 'POST',
    token: options.token,
    body: payload,
    timeoutMs: options.timeoutMs,
  });
  const status = getResponseStatus(response.data);
  if (status && FAILURE_STATUSES.has(status)) {
    throw new Error(`sync response status=${status}`);
  }
  return response;
}

async function sendAsync(url, payload, options) {
  const accepted = await requestJson(url, {
    method: 'POST',
    token: options.token,
    body: payload,
    timeoutMs: options.timeoutMs,
  });
  const callId = getCallId(accepted.data);
  if (!callId) {
    throw new Error(`async response did not include call_id: ${JSON.stringify(accepted.data)}`);
  }

  const deadline = Date.now() + options.pollTimeoutMs;
  let lastResponse = accepted;
  while (Date.now() <= deadline) {
    const queryUrl = buildAsyncQueryUrl(options.asyncQueryUrl, url, callId);
    const response = await requestJson(queryUrl, {
      method: 'GET',
      token: options.token,
      timeoutMs: options.timeoutMs,
    });
    lastResponse = response;

    const status = getResponseStatus(response.data);
    if (status && ASYNC_SUCCESS_STATUSES.has(status)) return response;
    if (status && FAILURE_STATUSES.has(status)) {
      throw new Error(`async call ${callId} finished with status=${status}`);
    }
    if (hasOwn(response.data, 'result') && !status) return response;

    await delay(options.pollIntervalMs);
    if (status && !ASYNC_PENDING_STATUSES.has(status) && options.verbose) {
      console.log(`[async] call_id=${callId} still polling unknown status=${status}`);
    }
  }

  throw new Error(`async call ${callId} timed out; last=${JSON.stringify(lastResponse.data)}`);
}

async function requestJson(url, { method, token, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: buildHeaders(token, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    const data = parseJsonMaybe(raw);
    if (!response.ok) {
      throw new HttpError(response.status, data);
    }
    return { httpStatus: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(token, hasBody) {
  const headers = {
    Accept: 'application/json',
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function loadDataset(options) {
  const csv = readFileSync(options.datasetPath, 'utf8');
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error(`CSV has no data rows: ${options.datasetPath}`);

  const headers = rows[0].map((value) => value.trim());
  const idIndex = headers.indexOf(options.idField);
  const textIndex = headers.indexOf(options.textField);
  if (idIndex < 0) throw new Error(`CSV id field "${options.idField}" not found in ${headers.join(', ')}`);
  if (textIndex < 0) throw new Error(`CSV text field "${options.textField}" not found in ${headers.join(', ')}`);

  return rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim().length > 0))
    .slice(options.offset)
    .slice(0, options.limit ?? undefined)
    .map((row) => {
      const id = (row[idIndex] ?? '').trim();
      const text = (row[textIndex] ?? '').trim();
      if (!id || !text) throw new Error(`CSV row is missing id/text: ${JSON.stringify(row)}`);
      const payload = {
        [options.idField]: id,
        [options.textField]: text,
      };
      if (!hasOwn(payload, 'id')) payload.id = id;
      if (!hasOwn(payload, 'text')) payload.text = text;
      return { id, payload };
    });
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(trimCr(field));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(trimCr(field));
    rows.push(row);
  }

  return rows;
}

function normalizeOptions(flags) {
  const mode = stringOption(flags, 'mode', 'both');
  if (!['sync', 'async', 'both'].includes(mode)) {
    throw new Error(`Invalid --mode "${mode}". Expected sync, async, or both.`);
  }

  const dataset = stringOption(flags, 'dataset', DEFAULT_DATASET);
  const sharedUrl = stringOption(flags, 'url', process.env.PROOFHOUND_WEBHOOK_URL);
  const syncUrl = stringOption(flags, 'sync-url', process.env.PROOFHOUND_WEBHOOK_SYNC_URL ?? sharedUrl);
  const asyncUrl = stringOption(flags, 'async-url', process.env.PROOFHOUND_WEBHOOK_ASYNC_URL ?? sharedUrl);

  return {
    mode,
    datasetPath: resolveDatasetPath(dataset),
    idField: stringOption(flags, 'id-field', 'sample_id'),
    textField: stringOption(flags, 'text-field', 'text'),
    syncUrl,
    asyncUrl,
    asyncQueryUrl: stringOption(flags, 'async-query-url', process.env.PROOFHOUND_WEBHOOK_ASYNC_QUERY_URL),
    token: stringOption(flags, 'token', process.env.PROOFHOUND_WEBHOOK_TOKEN ?? process.env.PROJECT_API_TOKEN),
    offset: numberOption(flags, 'offset', 0, { min: 0 }),
    limit: numberOption(flags, 'limit', 1, { min: 1 }),
    concurrency: numberOption(flags, 'concurrency', 1, { min: 1, max: 50 }),
    timeoutMs: numberOption(flags, 'timeout-ms', 60_000, { min: 1_000 }),
    pollTimeoutMs: numberOption(flags, 'poll-timeout-ms', 120_000, { min: 1_000 }),
    pollIntervalMs: numberOption(flags, 'poll-interval-ms', 1_000, { min: 100 }),
    dryRun: Boolean(flags['dry-run']),
    verbose: Boolean(flags.verbose),
  };
}

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);

    const eq = arg.indexOf('=');
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function stringOption(flags, key, fallback) {
  const value = flags[key] ?? fallback;
  if (value === undefined || value === null || value === true) return undefined;
  return String(value);
}

function numberOption(flags, key, fallback, bounds = {}) {
  const value = flags[key] === undefined ? fallback : Number(flags[key]);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`--${key} must be an integer`);
  }
  if (bounds.min !== undefined && value < bounds.min) throw new Error(`--${key} must be >= ${bounds.min}`);
  if (bounds.max !== undefined && value > bounds.max) throw new Error(`--${key} must be <= ${bounds.max}`);
  return value;
}

function optionalNumberOption(flags, key, bounds = {}) {
  if (flags[key] === undefined) return null;
  return numberOption(flags, key, undefined, bounds);
}

function resolveDatasetPath(value) {
  if (value.startsWith('@datasets/')) return resolve(ROOT, value.replace(/^@datasets\//u, 'datasets/'));
  return resolve(ROOT, value);
}

function parseJsonMaybe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getResponseStatus(data) {
  if (!data || typeof data !== 'object') return null;
  const status = data.status ?? data.state;
  return typeof status === 'string' ? status.toLowerCase() : null;
}

function getCallId(data) {
  if (!data || typeof data !== 'object') return null;
  const value = data.call_id ?? data.callId ?? data.id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getExternalId(data) {
  if (!data || typeof data !== 'object') return null;
  const value = data.external_id ?? data.externalId;
  return value === undefined || value === null || value === '' ? null : String(value);
}

function formatModelOutput(data) {
  if (!data || typeof data !== 'object') return null;
  if (hasOwn(data, 'result')) return formatOutputValue(data.result);
  if (hasOwn(data, 'parsed_output')) return formatOutputValue(data.parsed_output);
  if (hasOwn(data, 'decision_output')) return formatOutputValue(data.decision_output);
  if (hasOwn(data, 'raw_response')) return formatOutputValue(data.raw_response);
  return null;
}

function formatOutputValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function buildAsyncQueryUrl(template, asyncUrl, callId) {
  if (template) return template.replaceAll('{call_id}', encodeURIComponent(callId));
  const url = new URL(asyncUrl);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/calls/${encodeURIComponent(callId)}`;
  return url.toString();
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function trimCr(value) {
  return value.endsWith('\r') ? value.slice(0, -1) : value;
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function formatMs(value) {
  return `${Math.round(value)}ms`;
}

function formatError(error) {
  if (error instanceof HttpError) {
    return `HTTP ${error.status} ${JSON.stringify(error.data)}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

class HttpError extends Error {
  constructor(status, data) {
    super(`HTTP ${status}`);
    this.status = status;
    this.data = data;
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
