import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');

export const DEFAULT_DATASET_PATH = 'datasets/yelp_polarity/subsets/random-50/yelp-polarity-random-50.csv';
export const DATASET_NAME = 'yelp-polarity';
export const DATASET_DISPLAY_NAME = 'Yelp Polarity';
export const DATASET_SUBSET = 'random-50';
const NUMERIC_FIELDS = new Set(['label', 'original_class_index']);

export function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got: ${raw}`);
  }
  return value;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
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
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.length > 0));
}

export function readRecords(csv) {
  const rows = parseCsv(csv);
  const headers = rows.shift();
  if (!headers?.length) {
    throw new Error('CSV is missing a header row');
  }

  return rows.map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => {
        const value = cells[index] ?? '';
        return [header, NUMERIC_FIELDS.has(header) && value !== '' ? Number(value) : value];
      }),
    ),
  );
}

function normalizeDatasetPath(datasetPath) {
  if (datasetPath.startsWith('@datasets/')) {
    return `datasets/${datasetPath.slice('@datasets/'.length)}`;
  }
  return datasetPath;
}

export async function readDatasetRecords(datasetPath = process.env.DATASET_PATH ?? DEFAULT_DATASET_PATH) {
  const absoluteDatasetPath = resolve(repoRoot, normalizeDatasetPath(datasetPath));
  const csv = await readFile(absoluteDatasetPath, 'utf8');
  const records = readRecords(csv);

  if (records.length === 0) {
    throw new Error(`No records found in ${absoluteDatasetPath}`);
  }

  return { absoluteDatasetPath, records };
}

export function buildPayload(record, sequence, cycle) {
  return {
    ...record,
    _meta: {
      dataset: DATASET_NAME,
      subset: DATASET_SUBSET,
      sequence,
      cycle,
      sentAt: new Date().toISOString(),
    },
  };
}

export function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export function parseFlags() {
  const args = new Set(process.argv.slice(2).filter((arg) => arg !== '--'));
  return {
    dryRun: args.has('--dry-run'),
    once: args.has('--once'),
    help: args.has('--help') || args.has('-h'),
  };
}
