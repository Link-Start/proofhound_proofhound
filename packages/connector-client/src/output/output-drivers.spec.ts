import { describe, expect, it } from 'vitest';

import { buildKafkaOutputProducerOptions, resolveKafkaOutputKey } from './kafka.driver';
import { buildRedisStreamFieldPairs } from './redis-list.driver';

describe('output driver helpers', () => {
  it('keeps external_id available in redis stream fields', () => {
    const fields = buildRedisStreamFieldPairs({
      external_id: 'sample-1',
      run_result_id: '77777777-7777-4777-8777-777777777777',
      status: 'success',
      result: { label: 'positive' },
    });

    expect(fields).toContain('payload');
    expect(fields).toContain('external_id');
    expect(fields).toContain('sample-1');
    expect(fields).toContain('run_result_id');
    expect(fields).toContain('status');
  });

  it('resolves kafka partition key from configured path before falling back to external_id', () => {
    expect(
      resolveKafkaOutputKey(
        {
          external_id: 'sample-1',
          result: { customer_id: 'customer-42' },
        },
        'result.customer_id',
      ),
    ).toBe('customer-42');
    expect(resolveKafkaOutputKey({ external_id: 'sample-1' })).toBe('sample-1');
  });

  it('allows Kafka output topics to be auto-created by default', () => {
    expect(buildKafkaOutputProducerOptions()).toEqual({ allowAutoTopicCreation: true });
  });
});
