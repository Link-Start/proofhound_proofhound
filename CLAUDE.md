# ProofHound

ProofHound 开源版面向 self-hosted 场景，提供单工作区的提示词生命周期工具：提示词版本、数据集回归、实验、优化、灰度发布、正式发布、运行结果、标注与回滚。

仓库保留 `project_id`、`ProjectContext`、`ActorContext` 与 `accessControl` 等薄抽象，用于本地单项目数据边界和未来外部控制面接入；产品文档默认按单工作区叙述，不展开控制面功能清单。

本仓库只承载 OSS self-hosted 能力。未来 SaaS / 控制面能力由另一个仓库承载；本仓库的架构可以留下清晰、薄、当前可用的接口口子，但不得为了 SaaS 预埋当前无用的模块、功能、依赖或产品入口。

> 单人项目（ZiqiXiao）。Codex 协助实现，ZiqiXiao 拥有所有决策权。判断不准时先问，不要预演到最后才发现方向错。

> 本文件与 `AGENTS.md` / `CLAUDE.md` 内容同源，任何更新需同步两侧。

## 1. 技术栈

| 层     | 选型                                                                       |
| ------ | -------------------------------------------------------------------------- |
| 前端   | Next.js + TypeScript + Refine + shadcn/ui + Tailwind                       |
| 后端   | NestJS + TypeScript 单体，按 Module 边界拆分                               |
| 数据库 | 原生 PostgreSQL + Drizzle ORM，schema 前缀 `ph_*`                          |
| 鉴权   | Web UI 入口保护由部署环境负责；API Token 与单个全局 MCP Token 由应用层自管 |
| 存储   | 可替换对象存储 `StorageProvider`（数据集 / 导出）                          |
| 实时   | React Query 轮询 + NestJS SSE（业务编排流式）                              |
| 编排   | DBOS + BullMQ + Node.js LLM Worker                                         |
| 限流   | Redis 集中限流（RPM / TPM / 并发）                                         |
| 日志   | Pino stdout JSON                                                           |
| 测试   | Vitest + Playwright                                                        |

## 2. 代码布局

```
proofhound/
├── apps/        server / webhook / worker / web
├── packages/    shared / db / orchestration-shared / api-client / providers / logger / limiter / llm-client / connector-client / ui
├── dev/         本地开发依赖服务 docker-compose
├── docs/specs/  开源版业务 SPEC
├── .agents/skills/
├── AGENTS.md / CLAUDE.md
└── pnpm-workspace.yaml / tsconfig.base.json
```

## 3. 开工前读什么

| 想做什么                                 | 必读 SPEC                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 理解整体闭环 / 导航                      | [00](docs/specs/00-overview.md) + [01](docs/specs/01-navigation.md)                                                                                                            |
| 拿不准代码放哪 / 包依赖                  | [07 代码结构](docs/specs/07-code-structure.md)                                                                                                                                 |
| 改 PostgreSQL / DB schema                | [04](docs/specs/04-postgresql.md) + [06](docs/specs/06-database-schema.md)                                                                                                     |
| 改 DBOS / BullMQ / runner                | [03](docs/specs/03-orchestration.md) + 对应业务 SPEC                                                                                                                           |
| 改日志 / LLM 调用日志                    | [05](docs/specs/05-logging.md) + [21](docs/specs/21-models.md)                                                                                                                 |
| 改模型 / 数据集 / 提示词 / 实验 / 优化 | [21](docs/specs/21-models.md) + [22](docs/specs/22-datasets.md) + [23](docs/specs/23-prompts.md) + [24](docs/specs/24-experiments.md) + [25](docs/specs/25-optimizations.md) |
| 改连接器 / 发布 / 运行结果              | [26](docs/specs/26-connectors.md) + [27](docs/specs/27-releases.md) + [30](docs/specs/30-run-results.md)                                                                       |

## 4. OSS / SaaS 边界

- 当前仓库优先服务开源版 self-hosted 的完整可用闭环；新增架构必须能解释它如何改善当前 OSS 功能、可维护性或本地数据边界。
- 可以保留 `project_id`、`ProjectContext`、`ActorContext`、`accessControl`、Provider 接口、API / MCP 边界等薄接口，作为未来外部 SaaS 控制面接入点；这些接口必须有开源版默认实现，并被当前代码路径真实使用。
- SaaS 专属的组织 / 成员 / 角色权限、租户计费、套餐额度、Hosted 登录、审批、审计、平台监控、告警、多项目控制面等能力不在本仓库实现，也不通过隐藏菜单、edition flag、空迁移、空 Service、空 UI 或未使用依赖预埋。
- 未来 SaaS 与 OSS 的集成假设是通过稳定 API / MCP / Provider / 部署配置对接，而不是在本仓库维护 hosted-only 分支、商业版开关或同仓库双形态产品。
- 如果一个抽象只服务未来 SaaS、当前 OSS 没有真实调用方或默认行为，先不加；拿不准时先问 ZiqiXiao。

## 5. 开源版硬约束

1. 业务语义变化先改 SPEC 再改代码；SPEC 是事实来源。
2. 开源版只有一个本地项目作为数据边界。保留所有项目内业务资源的 `project_id`、Service 入参里的 `projectId` / `ProjectContext`、Repository 的 `project_id` 过滤；不要把这些抽象扩展成控制面功能。
3. 用户面字符串统一中文术语：提示词版本 / 运行结果 / 灰度发布 / 正式发布 / 本地管理端 / API Token / 全局 MCP Token。
4. 删除默认物理删除，不再新增软删流程；删除提示词或提示词版本前必须列明受影响的实验 / 优化 / 灰度候选 / production 发布事件。
5. 提示词版本被引用即冻结，DB 触发器兜底，不要绕开。
6. 正式发布提交即进入 `running`。
7. 运行结果写入后不可变；标注写 `ph_runs.annotations`。
8. Controller 只做参数校验、鉴权适配、调 Service / workflow / queue；业务逻辑在 Service。
9. DTO 用 Zod `z.infer`，前后端共享。
10. 应用日志只写 stdout JSON；LLM 调用必须在写运行结果前记录完整入参与响应。
11. 限流走 Redis 集中计数，不在进程本地维护配额。
12. PostgreSQL-first，不依赖托管平台专有 SQL 扩展。
13. 前端新增 / 修改用户面字符串走 `apps/web/src/i18n`，同步 `zh-CN` / `en-US`。
14. 前端日期时间统一 `YYYY/MM/DD HH:mm:ss`。
15. 前端主题色用语义 token；不要硬编码单主题颜色。
16. 所有可被前端调用的 Service 方法在 `apps/server/src/channels/mcp/` 暴露对应 MCP tool；UI 内部状态可豁免。
17. 不要自行启动本地开发服务（web / server / worker / 数据库 / Redis 等）；需要联调或验证时先检查已有相关服务，若已在运行则直接使用，若未运行则请用户启动后再继续。

## 6. Definition of Done

- 业务代码完成，本地主路径可跑。
- 单元测试覆盖 Service / DBOS step / BullMQ handler / 策略纯函数。
- 前端改动有必要时补 Playwright smoke。
- 前端文案同步中英文 i18n。
- DB schema 变更走 Drizzle migration，不用 `psql` 手改库。
- 业务语义同步 SPEC。
- `pnpm ci` 绿，或在交付说明中明确未跑项与原因。

## 7. 技能路由

| 任务                   | SKILL                           |
| ---------------------- | ------------------------------- |
| 不确定从哪开始         | `proofhound-overview`           |
| NestJS Module          | `proofhound-backend-module`     |
| DBOS / BullMQ / runner | `proofhound-dbos-workflow`      |
| LLM 调用               | `proofhound-llm-invocation`     |
| DB schema / migration  | `proofhound-database-migration` |
| Refine / 前端资源      | `proofhound-frontend-resource`  |

## 8. 不该做的事

- 不要把未来控制面接入口子做成同仓库分支或开源版业务模块。
- 不要为未来 SaaS 预埋未被当前 OSS 使用的 edition flag、套餐判断、租户 UI、控制面路由、空表、空 Service 或未使用依赖。
- 不要移除 `project_id` 数据边界。
- 不要在前端直连数据库写数据，所有写经 server。
- 不要把 API Token / 全局 MCP Token 复用外部 JWT；Token 由应用层自管。
- 不要在 LLM 调用日志里截断 messages / response.content，除非超过硬上限。
