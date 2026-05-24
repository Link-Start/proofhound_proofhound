import Redis from 'ioredis';

import {
  buildPayload,
  DATASET_DISPLAY_NAME,
  DEFAULT_DATASET_PATH,
  envNumber,
  parseFlags,
  readDatasetRecords,
  sleep,
} from './mock-streaming.mjs';

const DEFAULT_REDIS_URL = 'redis://localhost:6379/0';
const DEFAULT_QUEUE_KEY = 'datasets:yelp-polarity:random-50';
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_MAX_LEN = 100000;

const { dryRun, once, help } = parseFlags();

if (help) {
  console.log(`
Usage:
  pnpm dev:redis:mock [--once] [--dry-run]

Environment:
  REDIS_URL          Redis connection URL. Default: ${DEFAULT_REDIS_URL}
  REDIS_QUEUE_KEY    Redis List key to push into. Default: ${DEFAULT_QUEUE_KEY}
  REDIS_INTERVAL_MS  Delay between messages in continuous mode. Default: ${DEFAULT_INTERVAL_MS}
  REDIS_MAX_LEN      List max length after trim. Set 0 to disable. Default: ${DEFAULT_MAX_LEN}
  REDIS_PUSH_SIDE    left or right. Default: left
  DATASET_PATH       CSV path, relative to repo root or absolute. Default: ${DEFAULT_DATASET_PATH}
`);
  process.exit(0);
}

function parsePushSide(raw) {
  if (!raw) return 'left';
  if (raw === 'left' || raw === 'right') return raw;
  throw new Error(`REDIS_PUSH_SIDE must be left or right, got: ${raw}`);
}

async function pushMessage(redis, key, value, pushSide, maxLen) {
  const pipeline = redis.pipeline();
  if (pushSide === 'left') {
    pipeline.lpush(key, value);
    if (maxLen > 0) {
      pipeline.ltrim(key, 0, maxLen - 1);
    }
  } else {
    pipeline.rpush(key, value);
    if (maxLen > 0) {
      pipeline.ltrim(key, -maxLen, -1);
    }
  }
  await pipeline.exec();
}

const datasetPath = process.env.DATASET_PATH ?? DEFAULT_DATASET_PATH;
const redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
const queueKey = process.env.REDIS_QUEUE_KEY ?? DEFAULT_QUEUE_KEY;
const intervalMs = envNumber('REDIS_INTERVAL_MS', DEFAULT_INTERVAL_MS);
const maxLen = envNumber('REDIS_MAX_LEN', DEFAULT_MAX_LEN);
const pushSide = parsePushSide(process.env.REDIS_PUSH_SIDE);

const { absoluteDatasetPath, records } = await readDatasetRecords(datasetPath);

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        datasetPath: absoluteDatasetPath,
        redisUrl,
        queueKey,
        pushSide,
        maxLen,
        records: records.length,
        firstPayload: buildPayload(records[0], 1, 1),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

let shouldStop = false;
process.once('SIGINT', () => {
  shouldStop = true;
  console.log('\nStopping after the current Redis push...');
});
process.once('SIGTERM', () => {
  shouldStop = true;
  console.log('\nStopping after the current Redis push...');
});

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});

try {
  await redis.connect();
  console.log(
    `Streaming ${records.length} ${DATASET_DISPLAY_NAME} records to Redis list "${queueKey}" via ${redisUrl}.`,
  );
  console.log(`Push side: ${pushSide}. Max length: ${maxLen > 0 ? maxLen : 'disabled'}.`);
  console.log('Press Ctrl+C to stop.');

  let sequence = 0;
  let cycle = 1;

  while (!shouldStop) {
    for (const record of records) {
      if (shouldStop) break;
      sequence += 1;
      const payload = buildPayload(record, sequence, cycle);

      await pushMessage(redis, queueKey, JSON.stringify(payload), pushSide, maxLen);

      console.log(
        `[${sequence}] cycle=${cycle} sample_id=${record.sample_id ?? ''} label_name=${record.label_name ?? ''}`,
      );

      if (!once && intervalMs > 0) {
        await sleep(intervalMs);
      }
    }

    if (once) {
      break;
    }
    cycle += 1;
  }
} finally {
  redis.disconnect();
}
