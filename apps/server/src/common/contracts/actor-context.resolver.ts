// ActorContextResolver — HTTP 入口 adapter 扩展点
// 详见 docs/specs/08-saas-adapter-boundary.md §3.2
//
// HTTP Controller 通过 LocalActorGuard → resolveFromHttp 完成 user token 校验；
// 同样的 token 资源池由 McpAuthResolver 独立校验，但本 resolver **不**调用 McpAuthResolver
// （SPEC §8 红线：三条入口 resolver 互不调用对方）。
//
// `resolveFromUserToken` 是给 HTTP 路径和单元测试的共享入口；不允许被 MCP 入口直接复用。

import type { ActorContext } from '../actor-context';
import type { HttpRequestLike } from './types';

export abstract class ActorContextResolver {
  abstract resolveFromHttp(req: HttpRequestLike): Promise<ActorContext>;

  abstract resolveFromUserToken(token: string): Promise<ActorContext>;
}
