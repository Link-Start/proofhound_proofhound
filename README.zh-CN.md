<p align="center">
  <img src="docs/assets/proofhound-logo.svg" alt="ProofHound Logo" width="96" height="96" />
</p>

<h1 align="center">ProofHound</h1>

<p align="center">
  面向 self-hosted 场景的 Prompt 全生命周期平台：提示词版本、数据集回归、实验、自动优化、灰度发布、正式发布、运行结果、人工标注与回滚。
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

ProofHound 覆盖提示词版本、数据集回归、实验、自动优化、灰度发布、正式发布、运行结果、人工标注与回滚。

它的目标很直接：把过去需要工程师反复写脚本、接实验、看样本、改 Prompt、再接上线流程的工作，收敛到一个可追溯、可回归、可灰度、可回滚的平台里。接入完成后，新的 Prompt 版本可以在平台内完成实验、优化和发布，减少反复开发和人工巡检成本。

当前开源版聚焦单工作区本地管理端，适合团队自托管部署；数据层保留 `project_id` 边界，便于未来接入外部控制面。

## 快速预览

<video src="https://github.com/user-attachments/assets/e10a278c-1b86-4eb8-b0c8-1bd5e5d2a72f" controls muted playsinline width="100%" title="ProofHound 快速开始演示"></video>

## 解决了什么问题

### 数据驱动的自动迭代

ProofHound 以数据集和运行结果为事实来源。你可以上传带期望输出的数据集，创建实验，得到 Accuracy、Precision、Recall、F1、分类维度指标、失败样本和完整调用明细。

在此基础上，优化任务会自动分析错误样本、归纳失败模式、生成新的提示词版本，并再次运行回归实验。系统会比较每一轮指标，识别退步样本，必要时回退到历史最佳版本继续优化，让 Prompt 改动不再依赖“肉眼逐条看、凭感觉改”。

### 降低门槛，提高效率

ProofHound 把 Prompt 调优过程产品化，让运营、业务、风控、金融分析等非技术角色也能参与到调优流程中。

用户不需要手写复杂 JSON 来定义数据结构。平台会围绕数据集字段、提示词变量、输出字段和判定规则提供配置化流程，并基于真实数据集完成实验、优化和验证。一次接入后，后续 Prompt 上线可以通过平台完成，而不是每次都重新排开发。

### 实验与线上管理

很多团队的 Prompt 工作流割裂在两个地方：脚本或表格里的实验，线上靠业务代码和日志追效果。ProofHound 把实验和线上发布放到同一套事实表里。

实验、优化、灰度候选和 production lane 产生的调用都会写入统一的运行结果。你可以从同一个入口追溯一次模型调用的输入变量、渲染后的 Prompt、模型原始输出、结构化输出、判定结果、耗时、Token 和成本。

### 清晰的提示词版本管理

提示词每次修改都会形成版本。被实验、优化、灰度或正式发布引用后，版本会被冻结，确保指标和线上表现永远能对应到当时的 Prompt 内容。

发布侧支持队列连接器的灰度切流、双跑观察、100% 晋升、回滚和强制停止；Webhook 入口支持直接进入 production。上线链路清晰可追溯，可灰度、可切流、可回滚。

### 选择你自己的大模型

ProofHound 不做大模型转卖，也不在模型调用上增加使用溢价。你可以配置自己的模型供应商、endpoint、API Key、价格、上下文窗口、图片能力、RPM / TPM / 并发上限。

当前模型配置支持 OpenAI、Azure OpenAI、Anthropic、DeepSeek、Kimi、MiniMax、Qwen、ERNIE 等供应商类型，并保留开放字符串以便扩展更多兼容接口。

## 核心能力

- 资产管理：模型、数据集、提示词、连接器集中管理。
- 数据集回归：支持 CSV / TSV / JSONL / JSON 数组 / ZIP 上传，字段角色映射，样本浏览、过滤和导出。
- 提示词版本：不可变版本、可移动 label、变量清单、输出字段、判定规则、版本 diff。
- 实验：Prompt 版本 × 数据集 × 模型的批量回归测试，支持停止、恢复、对比和结果导出。
- 自动优化：基于错误样本分析和目标指标，自动生成候选版本并逐轮实验。
- 灰度与正式发布：统一发布线路，支持 split、dual_run、晋升、配置变更、回滚。
- 运行结果：统一记录实验、优化、灰度和 production 的 LLM 调用事实，写入后不可变。
- 标注：人工标注写入独立表，不修改原始运行结果。
- MCP 支持：内置 MCP 调用通道，Agent 可以通过 tool 形式访问本地工作区能力，例如管理提示词版本、启动实验 / 优化、查询运行结果。
- 调用通道：Web UI、Webhook + API Token、MCP + 全局 MCP Token。

## 和同类工具相比

### 更低的 Prompt 工程使用成本

ProofHound 的核心假设是：数据事实应该是 Prompt 迭代的唯一依据。平台把样本、判定、指标、失败模式和版本演化串起来，尽量减少手写脚本、手写复杂结构定义、手工比对结果的工作。

对于团队来说，这意味着 Prompt 调优不必只由少数工程师掌握。非技术成员也可以基于数据集事实提出目标、启动优化、查看结果和推进发布。

### 更适合分类任务和样本不均衡场景

开源版当前优先服务分类任务，尤其适合风控、金融、审核、客服意图识别等类别不均衡明显的业务。

优化目标可以设置到具体类别维度，例如针对某个高风险类别提升 Recall，或针对某个误报严重类别控制 Precision。平台会在实验和优化中保留 per-class 指标，避免整体准确率掩盖少数类别的真实问题。

### 从实验到生产是一条完整链路

ProofHound 不是只做 Prompt 版本库，也不是只做评测。它把数据集、实验、优化、发布和运行结果放在同一条生命周期里。

一个版本为什么上线、上线前跑过哪些实验、灰度时接了多少流量、线上产出了哪些结果、后来为什么回滚，都可以从平台内追溯。

### 自托管，少绑定

开源版面向 self-hosted 场景，数据库使用 PostgreSQL，限流使用 Redis，日志输出 stdout JSON。模型由你自己配置，调用成本、凭证和供应商选择都掌握在自己手里。

## 即将上线

- ProofHound Cloud Service：托管版服务即将上线，降低部署和运维成本。
- 生成式问题优化：在当前分类任务优化之外，扩展面向生成式任务的评估、比较和优化策略。

## 本地开发

本地开发需要：

- Node.js 24
- pnpm
- Docker 和 Docker Compose
- PostgreSQL、Redis 等本地依赖服务由 Docker Compose 自动启动，无需手动安装

```bash
git clone <your-proofhound-repo-url>
cd proofhound
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` 会一键启动本地依赖服务、执行数据库迁移，并同时启动 server、webhook、worker 和 web。

默认本地服务：

- Web UI：http://localhost:3000
- Server API：http://localhost:4000
- PostgreSQL：localhost:5432
- Redis：localhost:6379
- Kafka：localhost:9092

可选检查命令：

```bash
pnpm ci
```

## 代码结构

```text
proofhound/
├── apps/        server / webhook / worker / web
├── packages/    shared / db / api-client / providers / logger / limiter / llm-client / connector-client / ui
├── dev/         本地开发依赖服务 docker-compose
└── datasets/    示例与本地数据集
```

## 欢迎贡献

ProofHound 正在早期建设中，非常欢迎社区一起参与。你可以通过以下方式贡献：

- 提交 Issue：反馈 Bug、安装问题、模型接入问题或真实业务场景。
- 提交 Pull Request：改进文档、修复问题、补充测试、优化交互体验。
- 扩展能力：新增模型供应商适配、连接器、数据集解析能力、实验指标或优化策略。
- 分享场景：尤其欢迎分类任务、样本不均衡、风控、金融、审核、客服意图识别等场景的使用反馈。

如果你不确定某个想法是否适合合并，建议先开 Issue 讨论背景和预期效果。

## 社区

欢迎加入 Discord 社区：https://discord.gg/DGC6AzWrnt

联系邮箱：z@proofhound.org

你也可以通过 Issue 讨论使用场景、反馈问题或提出功能建议。
