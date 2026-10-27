# 变更日志 (CHANGELOG)

本仓库遵循 [Keep a Changelog](https://keepachangelog.com/) 与 [Semantic Versioning](https://semver.org/) 规范。
面向最终用户的核心文档（`README.md`、`SKILL.md`、`references/`）不硬编码小版本号与单测数字；特定运行时版本与上游验证记录独占于本日志。

## [未发布] (Unreleased)

### 重构 (Refactor)
- **去版本化与通用指引重构**：
  - 重构 `SKILL.md`，删除绑定特定版本的具体事故堆砌与报错字符串，提炼为跨版本通用的开工五步法、不可变工程原则、紧凑场景路由表与高危反模式。
  - 重构 `references/README.md`，将原特定版本核心指南升级为通用核心架构指南，精简索引结构，消除硬编码版本号。
  - 建立自动化版本 Token 门禁，确保主入口文档长期保持版本中立。

## [0.2.1-rc.4] - 2025-02-28
### 验证 (Verification)
- 经真机深度核验系统全局 CLI 环境 `@deepseek-ai/dsh@0.2.1-rc.4` 及其全套 304 个子包，确认 `dsh-app-boot`、`dsh-plugin-manager`、`dsh-cordis-host-runner` 与 `dsh-tools` 架构一致性，通用技能库无缝兼容。

## [0.2.1-rc.2] - 2025-02-28
### 验证 (Verification)
- 经真机深度核验通过上游官方运行基线 `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.2` 与微内核 `@deepseek-ai/cordis@4.0.5`。
