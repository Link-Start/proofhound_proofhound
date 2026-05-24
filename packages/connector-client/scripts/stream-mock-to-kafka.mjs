import { Kafka } from 'kafkajs';

import {
  buildPayload,
  DATASET_DISPLAY_NAME,
  DATASET_NAME,
  DATASET_SUBSET,
  DEFAULT_DATASET_PATH,
  envNumber,
  parseFlags,
  readDatasetRecords,
  sleep,
} from './mock-streaming.mjs';

const DEFAULT_TOPIC = 'datasets.yelp-polarity.random-50';
const DEFAULT_BROKERS = 'localhost:9092';
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_PARTITIONS = 3;

const { dryRun, once, help } = parseFlags();

if (help) {
  console.log(`
Usage:
  pnpm dev:kafka:mock [--once] [--dry-run]

Environment:
  KAFKA_BROKERS       Comma-separated broker list. Default: ${DEFAULT_BROKERS}
  KAFKA_TOPIC         Topic to publish into. Default: ${DEFAULT_TOPIC}
  KAFKA_INTERVAL_MS   Delay between messages in continuous mode. Default: ${DEFAULT_INTERVAL_MS}
  KAFKA_PARTITIONS    Topic partitions when auto-creating. Default: ${DEFAULT_PARTITIONS}
  DATASET_PATH        CSV path, relative to repo root or absolute. Default: ${DEFAULT_DATASET_PATH}
`);
  process.exit(0);
}

const datasetPath = process.env.DATASET_PATH ?? DEFAULT_DATASET_PATH;
const brokers = (process.env.KAFKA_BROKERS ?? DEFAULT_BROKERS)
  .split(',')
  .map((broker) => broker.trim())
  .filter(Boolean);
const topic = process.env.KAFKA_TOPIC ?? DEFAULT_TOPIC;
const intervalMs = envNumber('KAFKA_INTERVAL_MS', DEFAULT_INTERVAL_MS);
const partitions = envNumber('KAFKA_PARTITIONS', DEFAULT_PARTITIONS);

if (brokers.length === 0) {
  throw new Error('KAFKA_BROKERS must contain at least one broker');
}

const { absoluteDatasetPath, records } = await readDatasetRecords(datasetPath);

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        datasetPath: absoluteDatasetPath,
        brokers,
        topic,
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
  console.log('\nStopping after the current Kafka send...');
});
process.once('SIGTERM', () => {
  shouldStop = true;
  console.log('\nStopping after the current Kafka send...');
});

const kafka = new Kafka({
  clientId: 'proofhound-dev-mock-producer',
  brokers,
});
const admin = kafka.admin();
const producer = kafka.producer({ allowAutoTopicCreation: true });

try {
  await admin.connect();
  const topics = await admin.listTopics();
  if (!topics.includes(topic)) {
    await admin.createTopics({
      topics: [{ topic, numPartitions: partitions, replicationFactor: 1 }],
      waitForLeaders: true,
    });
  }
  await admin.disconnect();

  await producer.connect();
  console.log(
    `Streaming ${records.length} ${DATASET_DISPLAY_NAME} records to Kafka topic "${topic}" via ${brokers.join(', ')}.`,
  );
  console.log('Press Ctrl+C to stop.');

  let sequence = 0;
  let cycle = 1;

  while (!shouldStop) {
    for (const record of records) {
      if (shouldStop) break;
      sequence += 1;
      const payload = buildPayload(record, sequence, cycle);

      await producer.send({
        topic,
        messages: [
          {
            key: String(record.sample_id ?? sequence),
            value: JSON.stringify(payload),
            headers: {
              dataset: DATASET_NAME,
              subset: DATASET_SUBSET,
            },
          },
        ],
      });

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
  await Promise.allSettled([producer.disconnect(), admin.disconnect()]);
}
