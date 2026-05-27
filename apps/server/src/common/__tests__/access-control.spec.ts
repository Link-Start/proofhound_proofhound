import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { accessControl } from '../access-control';
import type { ActorContext } from '../actor-context';

const projectId = '11111111-1111-4111-8111-111111111111';

describe('SelfHostedAccessControl', () => {
  it('local_user (UI session) 允许全部 action，包括 platform_manage', () => {
    const actor: ActorContext = {
      actorId: '00000000-0000-4000-8000-000000000001',
      actorKind: 'local_user',
    };

    expect(() => accessControl.assertCan(actor, 'platform_manage')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'project_write', { projectId })).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'user_token_manage')).not.toThrow();
  });

  it('script (API token) 允许 project + token action，但禁 platform_manage', () => {
    const actor: ActorContext = {
      actorId: '22222222-2222-4222-8222-222222222222',
      actorKind: 'script',
    };

    expect(() => accessControl.assertCan(actor, 'mcp_tool')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'project_write', { projectId })).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'user_token_manage')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'platform_manage')).toThrow(ForbiddenException);
  });

  it('system_mcp / system_webhook 系统 actor 在 OSS 下全部 action 通过', () => {
    const mcp: ActorContext = { actorId: 'mcp-1', actorKind: 'system_mcp' };
    const webhook: ActorContext = { actorId: 'conn-1', actorKind: 'system_webhook' };

    expect(() => accessControl.assertCan(mcp, 'platform_manage')).not.toThrow();
    expect(() => accessControl.assertCan(webhook, 'project_write', { projectId })).not.toThrow();
  });
});
