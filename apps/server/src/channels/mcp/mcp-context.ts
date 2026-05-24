import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { resolveProjectContext } from '../../common/project-context';
import type { McpToolContext } from './mcp.types';

export function getMcpActor(ctx: McpToolContext): CurrentUserPayload {
  const projectContext = resolveProjectContext(ctx.actor);

  return (
    ctx.actor ?? {
      sub: ctx.actorUserId,
      actorId: ctx.actorUserId,
      actorKind: 'global_mcp_token',
      projectId: projectContext.projectId,
      email: ctx.email ?? '',
      isSuperAdmin: ctx.isSuperAdmin ?? false,
      isActive: true,
    }
  );
}

export function resolveMcpProjectContext(ctx: McpToolContext) {
  return resolveProjectContext(getMcpActor(ctx));
}
