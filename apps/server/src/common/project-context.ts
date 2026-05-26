// project-context — Controller / Service 层快捷入口
// 详见 docs/specs/08-saas-adapter-boundary.md §3.1
//
// `resolveProjectContext` 是历史同步 helper。OSS 默认实现固定返回 LOCAL_PROJECT_CONTEXT，
// 保留同步签名避免重写所有 Controller。
// SaaS 形态下需要走 `ProjectContextProvider.resolveAsync(actor, hint)`（异步版本）—
// 等 PR §7 PR11 落地 X-Project-Id transport 时再切。本 PR 不强制迁移。
//
// `ProjectContextProvider` 现在内部委托 `ProjectContextResolver`（DI 注册在 ContractsModule）。
// 直接同步调用仍走常量；异步路径走 resolver，便于 SaaS override。

import { Injectable, Optional } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ActorContext } from './actor-context';
import { ProjectContextResolver } from './contracts/project-context.resolver';
import type { ProjectContextHint } from './contracts/types';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type ProjectContextInput = ActorContext | CurrentUserPayload | undefined;

/**
 * 同步快捷入口；OSS 永远返回 LOCAL_PROJECT_CONTEXT。
 * 不要在新代码扩展该函数的行为 — 真正的 hint / actor 解析路径走 ProjectContextProvider.resolveAsync。
 */
export function resolveProjectContext(_input?: ProjectContextInput): ProjectContext {
  return LOCAL_PROJECT_CONTEXT;
}

@Injectable()
export class ProjectContextProvider {
  constructor(
    // Optional 避免单元测试在不需要 resolver 时手工 wire；OSS prod 路径始终有注入。
    @Optional() private readonly resolver?: ProjectContextResolver,
  ) {}

  resolveProjectContext(input?: ProjectContextInput): ProjectContext {
    return resolveProjectContext(input);
  }

  /**
   * 走 DI 的异步路径；SaaS RemoteProjectContextResolver 在这里读 hint / actor.claims。
   * OSS 默认实现忽略 hint 固定返回 LOCAL_PROJECT_CONTEXT。
   */
  async resolveAsync(actor: ActorContext, hint?: ProjectContextHint): Promise<ProjectContext> {
    if (this.resolver) return this.resolver.resolve(actor, hint);
    return LOCAL_PROJECT_CONTEXT;
  }
}
