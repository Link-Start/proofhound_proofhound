// LocalMcpAuthResolver — MCP channel 默认实现
// 详见 docs/specs/08-saas-adapter-boundary.md §3.3
//
// resolveFromMcp() 当前仍是 "transport TODO" 阶段：
// OSS apps/server/src/channels/mcp/ 下只有 tool 定义聚合，**没有真正挂载 MCP server**
// （mcp.controller.ts 是空 controller，没有 transport adapter；getMcpActor 历史上从 McpToolContext
// 接 actor 字段直接读）。在 MCP transport adapter 落地前，本 resolver 提供：
//   - resolveFromMcp(metadata): 尝试从 metadata.authInfo.token / headers.authorization / meta.token
//     提取 token；若提取到走 verifier，否则抛 401。
//   - resolveFromUserToken(token): 直接 verifier 校验（与 HTTP 路径行为一致，跳过 IP 校验）。
//
// 这一步保证 SaaS adapter 可以照常 override；同时不阻塞 HTTP 主路径。

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { McpAuthResolver } from './mcp-auth.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import type { ActorContext } from '../actor-context';
import type { McpRequestMetadataLike } from './types';

@Injectable()
export class LocalMcpAuthResolver extends McpAuthResolver {
  constructor(private readonly verifier: LocalUserTokenVerifier) {
    super();
  }

  async resolveFromMcp(metadata: McpRequestMetadataLike): Promise<ActorContext> {
    const token = this.extractToken(metadata);
    if (!token) throw new UnauthorizedException('missing_user_token');
    return this.verifier.verify(token);
  }

  async resolveFromUserToken(token: string): Promise<ActorContext> {
    return this.verifier.verify(token);
  }

  private extractToken(metadata: McpRequestMetadataLike): string | null {
    // TODO(mcp-transport): MCP SDK 真正接入后，statement 应改成读 SDK 提供的 authInfo.token；
    // 当前实现是基于 SDK 几种常见做法的合并兜底（authInfo / headers / meta），SDK 落地时收敛。
    if (metadata.authInfo?.token) return metadata.authInfo.token;

    const headers = metadata.headers ?? {};
    const auth = headers['authorization'] ?? headers['Authorization'];
    if (auth) {
      const header = Array.isArray(auth) ? auth[0] : auth;
      if (header) {
        const match = /^Bearer\s+(.+)$/i.exec(header);
        if (match?.[1]) return match[1].trim();
      }
    }

    const metaToken = metadata.meta?.['token'];
    if (typeof metaToken === 'string' && metaToken.length > 0) return metaToken;

    return null;
  }
}
