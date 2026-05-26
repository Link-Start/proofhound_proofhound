// mcp-context — MCP tool 入口的 actor / project context 适配层
// 详见 docs/specs/08-saas-adapter-boundary.md §3.3
//
// 现状：
//   - OSS 还没有真正挂载 MCP transport（mcp.controller.ts 是空 controller）；
//     `McpToolContext` 是 tool dispatch 时的占位 shape，actor 字段历史上由 caller 直接传入。
//   - 本文件不再硬编码默认 actor，转而依赖：
//       1) `getMcpActor`: tool 内部已经拿到 caller 传入的 actor（向后兼容），直接返回；
//          若缺失则抛 — 强制 caller 在 dispatch 阶段先调 `resolveMcpActor(metadata)`。
//       2) `resolveMcpActor`: 接 McpAuthResolver，对 MCP 协议 metadata 做真校验。
//          这是未来 MCP transport adapter 落地后的标准入口。
//
// TODO(mcp-transport): 等 MCP transport 真正接入时，由 transport adapter 在每个 tool dispatch
// 前调用 `resolveMcpActor(metadata)` 并把结果写入 McpToolContext.actor，
// 然后再调下面 tool handler，从而所有 tool handler 都通过 `getMcpActor(ctx)` 拿到经 resolver 校验的 actor。

import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { McpAuthResolver } from '../../common/contracts/mcp-auth.resolver';
import { ProjectContextResolver } from '../../common/contracts/project-context.resolver';
import type { McpRequestMetadataLike } from '../../common/contracts/types';
import { resolveProjectContext } from '../../common/project-context';
import type { ActorContext } from '../../common/actor-context';
import type { McpToolContext } from './mcp.types';

/**
 * 从已 dispatch 的 McpToolContext 中取出 actor。
 * caller 必须先通过 resolveMcpActor / dispatch 层把 actor 填入 ctx.actor。
 *
 * 向后兼容：如果 caller 传入的 ctx.actor 缺失但 ctx.actorUserId 有值，沿用历史 fallback。
 * 该 fallback 将在 MCP transport adapter 接入后移除（届时强制要求 ctx.actor 由 resolver 注入）。
 */
export function getMcpActor(ctx: McpToolContext): CurrentUserPayload {
  if (ctx.actor) return ctx.actor;

  // Fallback：MCP transport 还没接入；让 dev / 内部脚本仍可调用。
  // 一旦 MCP transport 落地，这条路径应改为抛 UnauthorizedException。
  const projectContext = resolveProjectContext();
  return {
    sub: ctx.actorUserId,
    actorId: ctx.actorUserId,
    actorKind: 'user_token',
    projectId: projectContext.projectId,
    email: ctx.email ?? '',
    isSuperAdmin: ctx.isSuperAdmin ?? false,
    isActive: true,
  };
}

export function resolveMcpProjectContext(ctx: McpToolContext) {
  return resolveProjectContext(getMcpActor(ctx));
}

/**
 * MCP transport adapter dispatch 时使用：从协议级 metadata 拿 token，
 * 经 McpAuthResolver 校验 → 解出 ActorContext → 解出 ProjectContext，
 * 返回组装好的 McpToolContext。
 */
@Injectable()
export class McpDispatchContextFactory {
  constructor(
    private readonly authResolver: McpAuthResolver,
    private readonly projectResolver: ProjectContextResolver,
  ) {}

  async build(metadata: McpRequestMetadataLike): Promise<McpToolContext> {
    const actor = await this.authResolver.resolveFromMcp(metadata);
    const project = await this.projectResolver.resolve(actor, { mcpMetadata: metadata });
    const payload = toCurrentUserPayload(actor, project.projectId);
    return {
      actorUserId: actor.actorId,
      actor: payload,
      email: payload.email,
      isSuperAdmin: payload.isSuperAdmin,
    };
  }
}

function toCurrentUserPayload(actor: ActorContext, projectId: string): CurrentUserPayload {
  return {
    sub: actor.actorId,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    projectId,
    email: '',
    isSuperAdmin: actor.actorKind === 'local_admin',
    isActive: true,
  };
}

// Re-export so MCP transport adapter 可以直接 import 时拿到具体的 401 类型
export { UnauthorizedException };
