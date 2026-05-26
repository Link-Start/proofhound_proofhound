// LocalProjectContextResolver — OSS 默认实现
// 详见 docs/specs/08-saas-adapter-boundary.md §3.1
//
// OSS 单工作区，忽略所有 hint，固定返回 LOCAL_PROJECT_CONTEXT。
// SaaS 形态由独立仓库 RemoteProjectContextResolver override。

import { Injectable } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ActorContext } from '../actor-context';
import { ProjectContextResolver } from './project-context.resolver';
import type { ProjectContextHint } from './types';

@Injectable()
export class LocalProjectContextResolver extends ProjectContextResolver {
  async resolve(_actor: ActorContext, _hint?: ProjectContextHint): Promise<ProjectContext> {
    return LOCAL_PROJECT_CONTEXT;
  }
}
