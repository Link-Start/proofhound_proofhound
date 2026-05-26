// per-connector webhook token fixture: used only by dev seed; the top of seed-dev.ts already forbids production.
// Business term: webhook token; physical table: ph_core.tokens (scope='webhook' AND connector_id=...).
// At seed time, use node:crypto sha256(plaintext) to compute token_hash; print plaintext to the console once; the frontend only sees the prefix.
// See docs/specs/06-database-schema.md §3.2 / §4.5.

export type DevTokenFixture = {
  id: string;
  scope: 'webhook';
  // Must point to a webhook-input connector id in DEV_CONNECTORS
  connectorId: string;
  name: string;
  prefix: string;
  plaintext: string;
};

// These two webhook tokens are attached to the sync / async webhook-input connectors respectively,
// matching the two webhook-input rows in packages/db/src/fixtures/dev/connectors.ts one-to-one.
export const DEV_TOKENS: DevTokenFixture[] = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
    scope: 'webhook',
    connectorId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
    name: 'sync-webhook-dev',
    prefix: 'ph_dev_w',
    plaintext: 'ph_dev_webhook_sync_token_local_only_xxxxxxxx',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',
    scope: 'webhook',
    connectorId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
    name: 'async-webhook-dev',
    prefix: 'ph_dev_w',
    plaintext: 'ph_dev_webhook_async_token_local_only_xxxxxxxx',
  },
];
