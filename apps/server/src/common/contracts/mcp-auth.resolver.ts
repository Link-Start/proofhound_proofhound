// McpAuthResolver — MCP channel adapter 扩展点
// 详见 docs/specs/08-saas-adapter-boundary.md §3.3
//
// MCP 入口与 HTTP 入口在 OSS 下共用 `ph_core.tokens where scope='user'` 资源池，
// 但两条 resolver 独立 override。**不**调用 ActorContextResolver。

import type { ActorContext } from '../actor-context';
import type { McpRequestMetadataLike } from './types';

export abstract class McpAuthResolver {
  abstract resolveFromMcp(metadata: McpRequestMetadataLike): Promise<ActorContext>;

  abstract resolveFromUserToken(token: string): Promise<ActorContext>;
}
