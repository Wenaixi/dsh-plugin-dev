# 变更日志 (CHANGELOG)

本仓库遵循 [Keep a Changelog](https://keepachangelog.com/) 与 [Semantic Versioning](https://semver.org/) 规范。
面向最终用户的核心文档（`README.md`、`SKILL.md`、`references/`）不硬编码小版本号与单测数字；特定运行时版本与上游验证记录独占于本日志。

## [0.6.0] - 2026-10-27

### 重大重构 (Breaking Architecture & Universalization)
- **跨版本通用指引核重构**：
  - 重构 [SKILL.md](SKILL.md) 为 74 行通用指引核（严格满足 ≤150 行规范），彻底消除写死版本号与具体事故堆砌，确立第一道门读源码、开工五步法、不可变工程原则与场景路由表；
  - 重构 [references/README.md](references/README.md) 为 112 行全量索引（严格满足 ≤200 行规范），将原特定版本核心指南升级为通用核心架构指南，68 篇专题 100% 索引入册；
  - 篇末源码块格式 100% 严格标准化为 `<仓库相对路径>  <-  <包名>@<version>`（398 行源码标注合规率 100%）；
  - 入口文档建立 CI 自动化版本 Token 扫描门禁，杜绝知识漂移。

### 真实源码核验与深度对齐 (@deepseek-ai@0.2.1-rc.4)
- **官方开源仓库多版本真源指引**：明确支持默认面向最新版本，多版本源码检出统一规范至 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)；
- **微内核与服务命名**：修正 [references/services.md](references/services.md)，确立 `dsh-session-checkpoint-policy` 为纯事件网关而非服务，补全核心沙箱裁决服务 `ctx.sandboxPolicy`；
- **工具定义与内容流投影**：重构 [references/tools.md](references/tools.md) 的 `defineTool` 示例为标准 `output: { schema, render }` 格式，补齐 `projectContent`、`finalizeContent`、`timeoutMs`、`isConcurrencySafe` 等完整契约；
- **多智能体架构去虚构化**：推翻 [references/agent-teams-architecture.md](references/agent-teams-architecture.md) 中编造的参数与实体，对齐真实的 `wait_agent({ timeout_ms })`、`target` 通信参数与底层 4 态任务机；
- **计划模式去虚构化**：推翻 [references/plan-mode-and-user-review-gate.md](references/plan-mode-and-user-review-gate.md) 中编造的 Epoch 与多态机，对齐真实源码 `PlanModeController` 的 `{ active, pending, plan }` 会话布尔投影；
- **双端对偶沙箱门面**：在 [references/three-roles.md](references/three-roles.md) 明确辨析操作系统级进程文件沙箱与 Cordis 内存上下文门控（Host `sandboxContext` 与 Browser `dynamicCordisContext`）；
- **配置自愈与官方原子写盘**：在 [references/config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) 确立优先推荐官方标准包 `@deepseek-ai/dsh-atomic-write`（内置 Windows 瞬态占用 8 次指数退避重试），在 [references/config.md](references/config.md) 确立官方 `plainConfig` 递归解包范式。

### 历史验证记录 (Historical Verification)
- 经真机深度核验系统全局 CLI 环境 `@deepseek-ai/dsh@0.2.1-rc.4` 及其全套 304 个子包，确认 `dsh-app-boot`、`dsh-plugin-manager`、`dsh-cordis-host-runner` 与 `dsh-tools` 架构一致性，通用技能库无缝兼容。

## [0.2.1-rc.2] - 2025-02-28
### 验证 (Verification)
- 经真机深度核验通过上游官方运行基线 `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.2` 与微内核 `@deepseek-ai/cordis@4.0.5`。
