// ProjectContextResolver — adapter 扩展点
// 详见 docs/specs/08-saas-adapter-boundary.md §3.1
//
// OSS 默认实现 `LocalProjectContextResolver` 忽略所有 hint，固定返回 LOCAL_PROJECT_CONTEXT；
// SaaS 形态下由 `RemoteProjectContextResolver` 在独立仓库 override，从 actor.claims / hint 中
// 解出真实 projectId 并校验访问权。

import type { ProjectContext } from '@proofhound/shared';
import type { ActorContext } from '../actor-context';
import type { ProjectContextHint } from './types';

export abstract class ProjectContextResolver {
  abstract resolve(actor: ActorContext, hint?: ProjectContextHint): Promise<ProjectContext>;
}
