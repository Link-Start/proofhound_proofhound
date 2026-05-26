// Thin transport-agnostic shapes consumed by the resolver abstract classes.
// 详见 docs/specs/08-saas-adapter-boundary.md §3.1-3.3
//
// Stays decoupled from express / @modelcontextprotocol SDK 具体类型；OSS / SaaS
// 双侧 resolver 实现都不应直接 import 第三方传输层类型。

/**
 * 抽象 HTTP 请求形状。express.Request 满足这个结构。
 */
export interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * MCP 请求 metadata 抽象。OSS 当前没有真正 wire MCP transport，
 * 这个类型是占位；SaaS 接入时实际 SDK 形状会更细，
 * 由实现侧选择从 headers / meta / authInfo 中提取 token。
 */
export interface McpRequestMetadataLike {
  /**
   * MCP 协议 metadata 字段（兼容 SDK 的 Meta / authInfo 包）。
   * 例如 `{ token: 'ph_tok_xxx' }` 或 `{ headers: { authorization: 'Bearer ...' } }`。
   */
  headers?: Record<string, string | string[] | undefined>;
  meta?: Record<string, unknown>;
  /**
   * 部分 MCP transport 允许直接挂 authInfo（如 streamable HTTP 模式下的中间件提取结果）。
   */
  authInfo?: { token?: string } | undefined;
}

/**
 * ProjectContextResolver.resolve 的 hint。
 * OSS 默认实现忽略所有 hint，固定返回 LOCAL_PROJECT_CONTEXT；
 * SaaS RemoteProjectContextResolver 会读 projectIdHeader / mcpMetadata。
 */
export interface ProjectContextHint {
  /** HTTP `X-Project-Id` header */
  projectIdHeader?: string;
  /** MCP metadata（与 McpAuthResolver 同源） */
  mcpMetadata?: McpRequestMetadataLike;
  /** Webhook 入口由 ConnectorContextResolver 填入 */
  connectorId?: string;
}
