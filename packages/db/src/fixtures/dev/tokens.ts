// per-connector webhook token fixture：仅 dev seed 使用，seed-dev.ts 顶部已禁止 production。
// 业务术语 webhook token，物理表 ph_core.tokens (scope='webhook' AND connector_id=...)。
// seed 时用 node:crypto sha256(plaintext) 算 token_hash；明文打印到控制台一次，前端只能看到 prefix。
// 详见 docs/specs/06-database-schema.md §3.2 / §4.5。

export type DevTokenFixture = {
  id: string;
  scope: 'webhook';
  // 必须指向 DEV_CONNECTORS 中某个 webhook-input 连接器 id
  connectorId: string;
  name: string;
  prefix: string;
  plaintext: string;
};

// 这两条 webhook token 分别挂在 sync / async webhook-input 连接器上,
// 与 packages/db/src/fixtures/dev/connectors.ts 中的两条 webhook-input 一一对应。
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
