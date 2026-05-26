// Adapter 扩展点 barrel — abstract class + 默认实现 + 类型
// 详见 docs/specs/08-saas-adapter-boundary.md

export * from './types';
export * from './project-context.resolver';
export * from './actor-context.resolver';
export * from './mcp-auth.resolver';
export * from './local-project-context.resolver';
export * from './local-actor-context.resolver';
export * from './local-mcp-auth.resolver';
export * from './local-user-token.verifier';
