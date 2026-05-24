<p align="center">
  <img src="docs/assets/proofhound-logo.svg" alt="ProofHound Logo" width="96" height="96" />
</p>

<h1 align="center">ProofHound</h1>

<p align="center">
  A self-hosted Prompt lifecycle platform for prompt versions, dataset regression, experiments, automatic optimization, canary releases, production releases, run results, human annotations, and rollback.
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <img alt="Node.js 24.x" src="https://img.shields.io/badge/Node.js-24.x-339933?logo=nodedotjs&logoColor=white" />
  <img alt="pnpm 10.x" src="https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white" />
  <img alt="TypeScript 6.x" src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white" />
  <img alt="PostgreSQL first" src="https://img.shields.io/badge/PostgreSQL-first-4169E1?logo=postgresql&logoColor=white" />
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-ready-0F766E" />
</p>

ProofHound brings prompt versions, dataset regression, experiments, automatic optimization, canary releases, production releases, run results, human annotations, and rollback into one traceable workflow.

The goal is simple: replace the repeated loop of writing scripts, wiring experiments, inspecting samples, editing prompts, and rebuilding release logic with a platform that is traceable, regression-friendly, canary-ready, and rollback-ready. Once a prompt is connected, new versions can be experimented on, optimized, and released inside ProofHound, reducing custom engineering work and manual inspection.

The open-source edition currently focuses on a single-workspace local admin console for self-hosted deployments. The data layer keeps a `project_id` boundary so the product can later connect to an external control plane without changing core resource semantics.

## Quick Preview

<video src="docs/assets/proofhound-quickstart.mp4" controls muted playsinline width="100%" title="ProofHound quick start demo"></video>

[If your Markdown viewer does not play embedded videos, open the demo file directly.](docs/assets/proofhound-quickstart.mp4)

## What It Solves

### Data-driven prompt iteration

ProofHound treats datasets and run results as the source of truth. You can upload a dataset with expected outputs, create experiments, and get accuracy, precision, recall, F1, per-class metrics, failed samples, and complete invocation details.

On top of that, optimization jobs analyze failed samples, summarize failure patterns, generate new prompt versions, and run regression experiments again. ProofHound compares metrics across rounds, detects regressions, and can fall back to the best historical version when needed, so prompt changes are no longer driven only by manual sample review and intuition.

### Lower barrier, higher throughput

ProofHound productizes the prompt-tuning process so operations, business, risk, financial analysis, and other non-engineering roles can participate in prompt iteration.

Users do not need to hand-write complex JSON structures. The platform provides configuration flows around dataset fields, prompt variables, output fields, and judgment rules, then runs experiments, optimization, and validation against real datasets. After the initial integration, prompt releases can move through the platform instead of requiring new engineering work every time.

### Experiments and online management in one place

Many teams split prompt work between scripts or spreadsheets and online behavior hidden inside application code and logs. ProofHound puts experiments and online releases into the same set of fact tables.

Experiments, optimizations, canary candidates, and production lanes all write to unified run results. From one entry point, you can trace a model invocation's input variables, rendered prompt, raw model output, structured output, judgment result, latency, tokens, and cost.

### Clear prompt version management

Every prompt edit creates a version. Once a version is referenced by an experiment, optimization, canary release, or production release, it is frozen so metrics and online behavior always map back to the exact prompt content used at the time.

Release flows support queue connector canaries, traffic splitting, dual-run observation, 100% promotion, configuration updates, rollback, and forced stop. Webhook ingress can go directly to production. The path from experiment to release stays traceable, canary-ready, and reversible.

### Bring your own model provider

ProofHound does not resell model calls or add a markup on usage. You configure your own model providers, endpoints, API keys, pricing, context windows, image capability, RPM limits, TPM limits, and concurrency limits.

Current model configuration supports provider types such as OpenAI, Azure OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Qwen, and ERNIE, with open strings reserved for additional compatible providers.

## Core Capabilities

- Asset management: centralized models, datasets, prompts, and connectors.
- Dataset regression: CSV / TSV / JSONL / JSON array / ZIP upload, field-role mapping, sample browsing, filtering, and export.
- Prompt versions: immutable versions, movable labels, variable lists, output fields, judgment rules, and version diffs.
- Experiments: prompt version x dataset x model batch regression with stop, resume, comparison, and export.
- Automatic optimization: analyze failed samples and target metrics, generate candidate versions, and run experiments round by round.
- Canary and production releases: unified release lanes with split, dual_run, promotion, configuration changes, and rollback.
- Run results: unified immutable records for LLM calls from experiments, optimizations, canaries, and production.
- Annotations: human annotations are written to a separate table without mutating original run results.
- MCP support: built-in MCP channel so agents can access local workspace tools, such as managing prompt versions, starting experiments / optimizations, and querying run results.
- Invocation channels: Web UI, Webhook + API Token, and MCP + global MCP Token.

## How It Compares

### Lower prompt engineering cost

ProofHound is built around one assumption: data facts should be the basis for prompt iteration. The platform connects samples, judgments, metrics, failure patterns, and version evolution so teams spend less time writing scripts, defining ad hoc structures, and comparing results manually.

For teams, this means prompt tuning does not have to be controlled only by a small group of engineers. Non-engineering members can define goals, start optimizations, inspect results, and move releases forward based on dataset facts.

### Better fit for classification and imbalanced datasets

The open-source edition currently prioritizes classification tasks, especially scenarios with obvious class imbalance such as risk control, finance, moderation, and support intent detection.

Optimization goals can target class-level metrics, such as improving recall for a high-risk class or controlling precision for a class with too many false positives. ProofHound keeps per-class metrics in experiments and optimizations so aggregate accuracy does not hide minority-class behavior.

### A complete path from experiment to production

ProofHound is not only a prompt registry and not only an evaluation tool. It places datasets, experiments, optimizations, releases, and run results into one lifecycle.

You can trace why a version went online, which experiments ran before release, how much traffic it received during canary, what happened in production, and why a rollback happened later.

### Self-hosted and low lock-in

The open-source edition is designed for self-hosted deployments. It uses PostgreSQL for storage, Redis for centralized rate limits, and stdout JSON for logs. You configure your own models, credentials, providers, and usage costs.

## Coming Soon

- ProofHound Cloud Service: hosted ProofHound to reduce deployment and operations work.
- Generative task optimization: evaluation, comparison, and optimization strategies beyond the current classification-first workflow.

## Local Development

Local development requires:

- Node.js 24
- pnpm
- Docker and Docker Compose
- PostgreSQL, Redis, and other local dependency services are started automatically by Docker Compose, so you do not need to install them manually

```bash
git clone <your-proofhound-repo-url>
cd proofhound
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts local dependency services, runs database migrations, and launches server, webhook, worker, and web together.

Default local services:

- Web UI: http://localhost:3000
- Server API: http://localhost:4000
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- Kafka: localhost:9092

Optional check command:

```bash
pnpm ci
```

## Repository Structure

```text
proofhound/
├── apps/        server / webhook / worker / web
├── packages/    shared / db / api-client / providers / logger / limiter / llm-client / connector-client / ui
├── dev/         local dependency services through docker-compose
└── datasets/    examples and local datasets
```

## Contributing

ProofHound is still early, and community contributions are very welcome. You can help by:

- Opening issues for bugs, installation problems, model integration problems, or real workflow feedback.
- Opening pull requests for documentation, fixes, tests, or interaction improvements.
- Extending capabilities with new model providers, connectors, dataset parsers, experiment metrics, or optimization strategies.
- Sharing use cases, especially classification, imbalanced datasets, risk control, finance, moderation, and support intent detection.

If you are unsure whether an idea fits the project, please open an issue first to discuss the context and expected behavior.

## Community

Join the Discord community: https://discord.gg/DGC6AzWrnt

Email: z@proofhound.org

You can also use GitHub Issues to discuss use cases, report problems, or propose features.
