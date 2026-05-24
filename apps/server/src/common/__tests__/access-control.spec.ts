import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { accessControl } from '../access-control';
import type { ActorContext } from '../actor-context';

const projectId = '11111111-1111-4111-8111-111111111111';

describe('SelfHostedAccessControl', () => {
  it('allows local admin to manage platform and project actions', () => {
    const actor: ActorContext = {
      actorId: '00000000-0000-4000-8000-000000000001',
      actorKind: 'local_admin',
    };

    expect(() => accessControl.assertCan(actor, 'platform_manage')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'project_write', { projectId })).not.toThrow();
  });

  it('allows global MCP token to use project tools but not platform management', () => {
    const actor: ActorContext = {
      actorId: '22222222-2222-4222-8222-222222222222',
      actorKind: 'global_mcp_token',
    };

    expect(() => accessControl.assertCan(actor, 'mcp_tool')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'project_write', { projectId })).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'platform_manage')).toThrow(ForbiddenException);
  });

  it('limits project API token to its bound project', () => {
    const actor: ActorContext = {
      actorId: '33333333-3333-4333-8333-333333333333',
      actorKind: 'project_api_token',
      projectId,
    };

    expect(() => accessControl.assertCan(actor, 'project_read', { projectId })).not.toThrow();
    expect(() =>
      accessControl.assertCan(actor, 'project_read', { projectId: '44444444-4444-4444-8444-444444444444' }),
    ).toThrow(ForbiddenException);
    expect(() => accessControl.assertCan(actor, 'platform_manage')).toThrow(ForbiddenException);
  });
});
