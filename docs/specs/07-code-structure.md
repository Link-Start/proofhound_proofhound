# 07 · Code Structure

This document explains how the open-source self-hosted repository is organized: what each directory does, how packages depend on one another, and where new code should go. The open-source repository only maintains the single-workspace product, keeping a single local project as the `project_id` data boundary.

## Contents

- [§1 Repository Principles](#1-repository-principles)
- [§2 Top-Level Layout](#2-top-level-layout)
- [§3 packages/core — Core Runtime](#3-packagescore--core-runtime)
- [§4 apps/server — OSS Server Shell](#4-appsserver--oss-server-shell)
- [§5 apps/webhook — OSS Webhook Shell](#5-appswebhook--oss-webhook-shell)
- [§6 apps/worker — OSS Worker Shell](#6-appsworker--oss-worker-shell)
- [§7 apps/web — Next.js Frontend](#7-appsweb--nextjs-frontend)
- [§8 packages — Shared Packages](#8-packages--shared-packages)
- [§9 Dependency Rules](#9-dependency-rules)
- [§10 Where New Code Goes](#10-where-new-code-goes)

## 1. Repository Principles

1. **One open-source product form**: This repository only maintains the self-hosted OSS edition.
2. **Local single-project boundary**: Public routes and the frontend are built around core business resources and provide no project management UI; business tables, DTOs, Services, and Repositories retain the `project_id` / `projectId` boundary. The current project is uniformly resolved through `ProjectContextProvider` / `resolveProjectContext`, and the OSS implementation returns the local project.
3. **Shared DTOs are the source of truth for contracts**: `packages/shared/src/dto/` defines the Zod schemas shared by the backend, the frontend, and the API client.
4. **Thin Controllers, business logic in Services**: REST / MCP / Webhook only handle authentication, validation, and adaptation; business semantics live in the same set of Services.
5. **Application entry points stay thin**: `apps/*` are process shells (env, bootstrap, logging, listen / worker start). Reusable backend runtime lives in `packages/core`, not behind an `apps/*` barrel.
6. **Cross-cutting foundational capabilities go in packages**: Logging, rate limiting, the LLM client, connector drivers, and strategy packages are tested independently and do not depend back on apps.

## 2. Top-Level Layout

```text
proofhound/
├── apps/
│   ├── server/       # NestJS admin API / MCP / DBOS / BullMQ producer / runner service
│   ├── webhook/      # Standalone Webhook ingress
│   ├── worker/       # BullMQ LLM worker
│   └── web/          # Next.js + Refine + shadcn/ui frontend
├── packages/
│   ├── core/         # @proofhound/core backend runtime: server / webhook / worker modules + contracts
│   ├── shared/       # Zod DTO / shared types
│   ├── db/           # Drizzle schema / migrations / seed
│   ├── api-client/   # HTTP client
│   ├── orchestration-shared/
│   ├── providers/
│   ├── logger/
│   ├── limiter/
│   ├── llm-client/
│   ├── connector-client/
│   ├── judgment/
│   ├── metrics/
│   ├── optimization-strategy/
│   └── ui/
├── dev/              # Local dependency services such as Redis / Kafka
├── docs/specs/       # Source of truth for features
├── .agents/skills/   # Codex skills
├── AGENTS.md
└── CLAUDE.md
```

## 3. packages/core — Core Runtime

`packages/core` publishes `@proofhound/core`, the reusable backend runtime consumed by the OSS process shells and by the separate SaaS repository. It owns the Nest modules, Controllers, Services, Repositories, contracts, local default implementations, DBOS workflows, runner services, webhook runtime, and worker handlers that form the ProofHound business loop.

`apps/*` must not be used as library entry points. Do not add app-level barrels to make `apps/server` importable by SaaS; when code needs to be reused, move it into `packages/core` and export it through stable package exports.

Target layout after the extraction:

```text
packages/core/src/
├── server/
│   ├── proofhound-server.module.ts       # ProofHoundServerModule.forRoot({ contracts })
│   ├── channels/
│   │   └── mcp/
│   ├── common/
│   │   ├── contracts/
│   │   ├── decorators/
│   │   ├── filters/
│   │   └── pipes/
│   ├── infrastructure/
│   │   ├── crypto/
│   │   ├── database/
│   │   ├── orchestration/
│   │   ├── redis/
│   │   └── storage/
│   └── modules/
│       ├── token/
│       ├── model/
│       ├── dataset/
│       ├── prompt/
│       ├── connector/
│       ├── experiment/
│       ├── optimization/
│       ├── canary-release/
│       ├── production-release/
│       ├── run-result/
│       └── quick-start/
├── webhook/
│   └── proofhound-webhook.module.ts
├── worker/
│   └── proofhound-worker.module.ts
└── index.ts
```

Stable package exports:

```text
@proofhound/core/server      # ProofHoundServerModule + server-facing contracts
@proofhound/core/webhook     # ProofHoundWebhookModule + webhook entry contracts
@proofhound/core/worker      # ProofHoundWorkerModule + worker handlers
@proofhound/core/contracts   # adapter extension-point abstract classes + local defaults
```

During the migration window, files may still physically live under `apps/server`, `apps/webhook`, or `apps/worker`; this section describes the target boundary. New reusable backend code should be placed in `packages/core` once the extraction PR lands.

Standard layout for a business module:

```text
server/modules/prompt/
├── prompt.module.ts
├── prompt.controller.ts
├── prompt.service.ts
├── prompt.repository.ts
└── __tests__/
```

DTOs do not go into `packages/core/src/server/modules/*`. All request / response schemas live in `packages/shared/src/dto/`.

## 4. apps/server — OSS Server Shell

`apps/server` is the OSS server process entry point. It wires deployment concerns and starts the reusable core server module.

```text
apps/server/src/
└── main.ts
```

Responsibilities:

- load process env
- create the Nest app
- pass `LocalContractsModule` to `ProofHoundServerModule.forRoot({ contracts })`
- mount body parser, HTTP logger, CORS, and global filters
- resolve the listen port and call `listen()`
- handle bootstrap failure

`apps/server` must not export a reusable library surface. SaaS imports `@proofhound/core/server`, never `apps/server/src/*`.

## 5. apps/webhook — OSS Webhook Shell

`apps/webhook` is the OSS webhook process entry point. It only hosts public-facing webhooks:

- `/webhooks/*`
- `/healthz`
- `/readyz`

It wires process-level concerns and mounts the core webhook runtime from `@proofhound/core/webhook`. Per-connector webhook token authentication (see [08](08-saas-adapter-boundary.md) §3.4 `ConnectorContextResolver`), payload validation, and enqueueing live in the core runtime. Do not implement admin APIs in the webhook app, and do not import `apps/server` or any other app shell in reverse.

## 6. apps/worker — OSS Worker Shell

`apps/worker` is the OSS worker process entry point. It starts the core worker runtime from `@proofhound/core/worker`, consumes the `llm` queue, executes LLM calls, and writes run results. It is unaware of the Web UI and does not directly implement business Controllers.

Core constraints:

- LLM calls go through Redis rate limiting first.
- LLM call logs must be written before the run result.
- Handlers must be idempotent; BullMQ retries must not duplicate factual results.
- Once a run result is written to `ph_runs.run_results`, it is immutable.

## 7. apps/web — Next.js Frontend

The frontend is the open-source local admin app, and the root path leads into core resources. The frontend does not show an explicit project selector and provides no project management UI; pages obtain the current project through `ProjectContextProvider` / `resolveProjectContext`. The OSS implementation always returns the local project, but the API client / DTOs may carry the `projectId` returned by the server.

```text
apps/web/src/app/
├── page.tsx                     # Redirects to /dashboard
├── dashboard/
├── monitoring/
├── models/
├── datasets/
├── prompts/
├── experiments/
├── optimizations/
├── comparisons/
├── connectors/
├── releases/
├── annotations/
├── settings/
├── canary-releases/
└── production-releases/
```

The three frontend layers:

| Layer | Location | Responsibility |
| -- | ---- | ---- |
| C1 | `packages/api-client/src/<resource>.ts` | HTTP client |
| C2 | `apps/web/src/hooks/<resource>.ts` | React Query hooks |
| C3 | `apps/web/src/app/<resource>/` | Pages and components |

When adding or renaming pages, update the Playwright smoke tests accordingly. User-facing strings go through `apps/web/src/i18n` and must provide both `zh-CN` / `en-US`.

## 8. packages — Shared Packages

| Package | Responsibility |
| -- | ---- |
| `@proofhound/core` | Reusable backend runtime: server / webhook / worker modules, contracts, local defaults, Services, Repositories |
| `@proofhound/shared` | DTOs, Zod schemas, shared constants |
| `@proofhound/db` | Drizzle schema, migration, seed, reset |
| `@proofhound/api-client` | HTTP client shared by the frontend and scripts |
| `@proofhound/orchestration-shared` | DBOS workflow ids, BullMQ queues, job payload schemas |
| `@proofhound/providers` | Replaceable interfaces such as Storage / Realtime |
| `@proofhound/logger` | Pino factory and redact |
| `@proofhound/limiter` | Redis RPM / TPM / concurrency rate limiting |
| `@proofhound/llm-client` | LLM provider call wrapper |
| `@proofhound/connector-client` | Redis / Kafka / Webhook connector drivers |
| `@proofhound/judgment` | Judgment strategies |
| `@proofhound/metrics` | Offline experiment metric computation strategies |
| `@proofhound/optimization-strategy` | Optimization strategies |
| `@proofhound/ui` | Reusable React UI |

## 9. Dependency Rules

```text
apps/*  -> packages/core + packages/*
packages/core -> packages/shared / db / logger / limiter / llm-client / connector-client / metrics / judgment / optimization-strategy / orchestration-shared / providers
packages/api-client -> packages/shared
packages/db -> packages/shared (share types only when necessary)
packages/llm-client -> packages/logger
packages/connector-client -> packages/logger
packages/metrics / judgment / optimization-strategy -> packages/shared
```

Forbidden:

- `packages/*` importing `apps/*`
- The SaaS repository importing `apps/*` paths or an app-level barrel
- Adding a barrel under `apps/server` / `apps/webhook` / `apps/worker` for reuse instead of moving code into `packages/core`
- The frontend writing business data directly to the database
- The webhook app reusing the server's internal Services
- Expanding the `project_id` / `accessControl` abstractions into control-plane business modules
- Removing the `project_id` boundary on business resources or letting a Repository omit `project_id` filtering

## 10. Where New Code Goes

| Need | Location |
| ---- | ---- |
| New REST resource | `packages/core/src/server/modules/<resource>/` + `packages/shared/src/dto/` |
| New MCP tool | `packages/core/src/server/channels/mcp/<resource>.tools.ts` |
| New webhook runtime behavior | `packages/core/src/webhook/` |
| New worker handler | `packages/core/src/worker/` |
| New frontend page | `apps/web/src/app/<resource>/` |
| New API client | `packages/api-client/src/<resource>.ts` |
| New DB table / column | `packages/db/src/schema/` + migration |
| New BullMQ payload | `packages/orchestration-shared/src/` |
| New LLM provider | `packages/llm-client/src/` |
| New connector driver | `packages/connector-client/src/` |
| New judgment / metric / optimization strategy | `packages/judgment` / `packages/metrics` / `packages/optimization-strategy` |
