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
    expect(() => accessControl.assertCan(actor, 'user_token_manage')).not.toThrow();
  });

  it('allows user_token to use project + token actions but not platform management', () => {
    const actor: ActorContext = {
      actorId: '22222222-2222-4222-8222-222222222222',
      actorKind: 'user_token',
    };

    expect(() => accessControl.assertCan(actor, 'mcp_tool')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'project_write', { projectId })).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'user_token_manage')).not.toThrow();
    expect(() => accessControl.assertCan(actor, 'platform_manage')).toThrow(ForbiddenException);
  });
});
