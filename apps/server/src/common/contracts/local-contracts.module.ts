// ContractsModule — registers default implementations for OSS adapter extension points
// See docs/specs/08-saas-adapter-boundary.md §3 + §7 PR1
//
// The SaaS repo switches forms via DI overrides such as
// `overrideProvider(ActorContextResolver).useClass(RemoteActorContextResolver)`; OSS mainline is unaware of the form difference.
//
// @Global() ensures every module can inject these resolvers directly without per-module import.

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
  exports: [
    ProjectContextResolver,
    ActorContextResolver,
    McpAuthResolver,
    LocalUserTokenVerifier,
  ],
})
export class ContractsModule {}
