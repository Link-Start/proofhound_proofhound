# 05 · Logging Specification

ProofHound uses Pino for application logging. Application logs target developers, operations, and the deployment environment's log platform only.

## 1. Three Kinds of Records

| Name | Location | Audience | Notes |
| ---- | ---- | ---- | ---- |
| Application logs | stdout JSON | Developers / operations | This spec |
| Run results | `ph_runs.run_results` | Product UI / debugging | Business facts of each LLM call |
| DBOS history | DBOS system tables | Developers | Workflow recovery and troubleshooting |

Application logs are not written to Postgres and provide no in-product query page.

## 2. Basic Rules

- Only create loggers via `packages/logger`.
- Write to stdout only, one JSON record per line.
- Do not write local log files.
- Do not connect directly to any log backend.
- Default to `info` in production and `debug` locally; override via `LOG_LEVEL`.
- Never use bare `console.log` / `console.error` in business code.

## 3. Log Levels

| Level | When to Use |
| ----- | -------- |
| `fatal` | Errors that require a process restart to recover |
| `error` | A single business request failed and it is not user input error |
| `warn` | Degradation, retries, approaching quota, recoverable malformed input |
| `info` | Key milestones such as request completion, workflow start/stop, and state changes |
| `debug` | Local or temporary troubleshooting detail |

Downstream notification policy is configured by the deployment environment's log platform.

## 4. Common Fields

Injected by the logger factory:

- `time`
- `level`
- `service`
- `version`
- `env`
- `host`

Business context bound per entry point:

- `requestId`
- `actorId`
- `source`: `web` / `api` / `mcp` / `webhook`
- `dbosWorkflowId`
- `stepName`
- `bullmqQueue`
- `bullmqJobId`
- `jobName`
- `promptId`
- `promptVersionId`
- `modelId`
- `runResultId`
- `durationMs`
- `outcome`
- `errorCode`
- `errorClass`

Logs involving project-scoped business resources should include `projectId`. The open-source edition has only the default local project, but the field is retained as a `ProjectContext` boundary.

Message names use a fixed snake_case form:

```ts
logger.info({ promptId, promptVersionId }, 'prompt_version_created');
```

Do not concatenate variables into `msg`.

## 5. Responsibilities by Layer

### 5.1 HTTP / MCP / Webhook Entry Points

- Record method, path, status code, latency, request ID, and source.
- Do not record request bodies by default.
- 5xx errors are logged with the error object and stack trace by the global exception filter.

### 5.2 Service

- Record key state changes and external call results.
- On failure, pass `{ err }` so Pino serializes the error.

### 5.3 BullMQ Handler

- One `info` on entry and one on exit.
- One `error` for non-retryable errors.
- Leave retryable errors to the BullMQ retry policy.

### 5.4 DBOS Workflow / Step

- Log `info` for workflow start, step enter/exit, control-state transitions, and terminal states.
- Do not emit high-frequency logs on loop hot paths.

## 6. LLM Call Logging Contract

Every request sent to an LLM must write one complete application log in its terminal state, before the run result is persisted.

Message names:

- `llm_call_completed`
- `llm_call_failed`

Required fields:

| Category | Fields |
| ---- | ---- |
| Model | `model.id` / `model.providerModelId` / `model.endpoint` |
| Inference parameters | `temperature` / `max_tokens` / `top_p` and other effective parameters |
| Input | `messages` or `prompt`, recorded in full |
| Multimodal | `image_refs`; use a digest hash for base64 to avoid writing the full content repeatedly |
| Output | `response.content` / `finish_reason` / usage |
| Parsing | `parsed` |
| Context | `requestId` / `dbosWorkflowId` / `bullmqJobId` / `runResultId` |
| Resources | `promptId` / `promptVersionId` / `modelId` |
| Source | `experiment` / `optimization_analysis` / `optimization_generate` / `canary` / `online` |
| Performance | `durationMs` / `attempt` |
| Failure | `errorClass` / `errorMessage` / `httpStatus` / `providerErrorBody` |

Oversized payload fallback: when the total field size exceeds 256KB, record a SHA256 + head/tail digest + a `payload_overflow` marker; the run result still retains the full content.

## 7. Redaction

Default redact paths:

```text
*.password
*.apiKey
*.api_key
*.token
*.secret
*.authorization
headers.cookie
headers.authorization
**.openai_api_key
**.anthropic_api_key
```

Redacted values are uniformly `[REDACTED]`. The business side must not proactively place plaintext secrets / tokens / api_keys into any log field.

## 8. Querying

The query tooling is determined by the deployment environment. Locally you can query stdout directly with `rg` or JSON tools:

```bash
rg '"requestId":"abc-123"'
rg '"dbosWorkflowId":"wf-xyz"' | rg '"msg":"llm_call_completed"'
rg '"runResultId":"rr-789"'
```

Business users do not view application logs directly; business questions go through the run results page.

## 9. Performance

- Minimize logging on hot paths: the inner rate limiter, the inner runner tick, and inner streaming chunks.
- LLM call logs are the exception and must be recorded in full.
- Sampling can be configured by the logger factory, but LLM call logs are not sampled.

## 10. Mapping to Other Specs

| SPEC | Logging Focus |
| ---- | ---------- |
| [03 Orchestration](03-orchestration.md) | DBOS / BullMQ context fields |
| [04 PostgreSQL](04-postgresql.md) | Database and Storage errors |
| [21 Models](21-models.md) | LLM calls and connectivity probes |
| [24 Experiments](24-experiments.md) | Experiment workflow nodes |
| [25 Optimizations](25-optimizations.md) | Analysis / generation LLM calls |
| [26 Connectors](26-connectors.md) | Connector probe and push errors |
| [27 Releases](27-releases.md) | Release events, runner tick, and LLM calls |
| [30 Run Results](30-run-results.md) | Cross-linking with application logs |
