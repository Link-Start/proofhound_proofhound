// 连接器 webhook API Token fixture:仅 dev seed 使用,seed-dev.ts 顶部已禁止 production。
// 业务术语 project_api_token,物理表 ph_core.api_tokens(scope='project')。
// seed 时用 node:crypto sha256(plaintext) 算 token_hash;明文打印到控制台一次,前端只能看到 prefix。

export type DevApiTokenFixture = {
  id: string;
  scope: 'project';
  name: string;
  prefix: string;
  plaintext: string;
};

export const DEV_API_TOKENS: DevApiTokenFixture[] = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
    scope: 'project',
    name: 'sql-risk-webhook-dev',
    prefix: 'ph_dev_w',
    plaintext: 'ph_dev_webhook_sql_risk_token_local_only_xxxxxxxx',
  },
];
