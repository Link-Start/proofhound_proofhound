// ContractsModule — 注册 OSS adapter 扩展点的默认实现
// 详见 docs/specs/08-saas-adapter-boundary.md §3 + §7 PR1
//
// SaaS 仓库通过 `overrideProvider(ActorContextResolver).useClass(RemoteActorContextResolver)` 等
// DI 覆盖完成形态切换；OSS 主干不感知形态差异。
//
// @Global() 保证所有 Module 都能直接注入这些 resolver，不必逐 module import。

import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { ActorContextResolver } from './actor-context.resolver';
import { LocalActorContextResolver } from './local-actor-context.resolver';
import { LocalMcpAuthResolver } from './local-mcp-auth.resolver';
import { LocalProjectContextResolver } from './local-project-context.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import { McpAuthResolver } from './mcp-auth.resolver';
import { ProjectContextResolver } from './project-context.resolver';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    LocalUserTokenVerifier,
    { provide: ProjectContextResolver, useClass: LocalProjectContextResolver },
    { provide: ActorContextResolver, useClass: LocalActorContextResolver },
    { provide: McpAuthResolver, useClass: LocalMcpAuthResolver },
  ],
  exports: [ProjectContextResolver, ActorContextResolver, McpAuthResolver, LocalUserTokenVerifier],
})
export class ContractsModule {}
