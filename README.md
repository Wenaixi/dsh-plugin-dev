# DeepSeek Harness (DSH) 插件开发权威指南

<p align="center">
  <a href="https://github.com/Wenaixi/dsh-plugin-dev/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/Wenaixi/dsh-plugin-dev/ci.yml?branch=main&style=flat-square&label=CI%20Build" alt="CI Status" />
  </a>
  <img src="https://img.shields.io/badge/DSH%20Baseline-0.2.0--rc.2-blue?style=flat-square" alt="DSH Version" />
  <img src="https://img.shields.io/badge/Cordis-4.0.4-orange?style=flat-square" alt="Cordis Version" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen?style=flat-square" alt="Node Version" />
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  </a>
  <a href="https://github.com/Wenaixi/dsh-plugin-dev/pulls">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
  </a>
</p>

本项目是开发、审查、调试 **DeepSeek Harness (DSH 0.2.0-rc.2)** 插件与生态扩展的标准与权威参考知识库（Agent Skill）。内容依据 DSH 官方文档站 44 页逐页核对，凡与旧版记忆冲突处一律以官方原文为准。

DSH 是基于 Cordis 微内核构建的高可扩展 Agent Harness。在 DSH 架构中，**一切皆为插件 (Everything is a Plugin)**：会话日志、工具注册表、系统提示词装配、模型适配器、UI 界面以及执行循环驱动器均作为平等、可插拔的插件运行。

---

## 一、核心架构原则

1. **零特权微内核**：不存在固化的特权逻辑。所有业务与平台能力均通过向共享 `Context` 挂载服务或监听事件提供。
2. **核心服务大动脉 (The Core Spine)**（含官方 core/seam/bundle 角色）：
   - `ctx.sessions`（core，`@deepseek-ai/dsh-session`）：仅追加事件日志与唯一真源。
   - `ctx.systemPrompt`（core）：提示词装配与工具 Schema 生成。
   - `ctx.tools`（core）：工具注册表、单调守卫、PTC 模式与多模态渲染。
   - `ctx.agents`（core）：活跃 Agent 注册表与发起者作用域。
   - `ctx.agentLoop`（**bundle**，`@deepseek-ai/dsh-agent-loop`）：唯一的具体循环插件；扩展包依赖 dsh-agent 的事件与服务，**绝不直接依赖此包**。
   - `ctx.llm`（**seam**，`@deepseek-ai/dsh-llm`）：提供方无关消息流式协议与适配器接入。
   - `ctx.settings` + `ctx.configEditor`（core）：配置表单投影与补丁持久化。
3. **五大事件派发模式**：
   - `emit`：同步通知，无返回值；
   - `waterfall`：**同步环绕中间件**（监听器收 `(...args, next)`，调 `next()` 执行下游、不调即短路），返回最终加工值——不是简单传值链；
   - `parallel`：`Promise.all` 并发等待全部 settle，无返回值；
   - `serial`：按序 `await`，返回结果数组；
   - `bail`：按序直到某监听器返回 bail 值，返回该值。
4. **配置落点与全量替换规约**：
   - **废弃警告**：`$DSH_HOME/settings.yaml` 已完全废弃，修改无效。
   - **三层落点（+ overlay）**：组合包 patch → `$DSH_HOME/profiles/<profile>/cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlay（按 argv 顺序）。后层按行胜出。
   - **全量替换 (Wholesale Replacement)**：对条目的 `config` 覆盖是整块替换，不做深合并。
5. **可逆副作用 (Reversible Effects)**：所有经 `ctx.on()`、`ctx.effect()`、`ctx.tools.register()` 注册的资源由所属 Fiber 跟踪，插件停用或热重载时自动逆向注销。

---

## 二、三角色物理架构模型

| 角色 | 运行环境 | 核心职责 | 安全与隔离机制 |
| --- | --- | --- | --- |
| **Browser** | 浏览器 / Desktop Webview | React 界面、浏览器端 Cordis 运行时、Slots 插槽、本地多语言 | 零本地文件系统与系统调用权限，经 Typert Remote（HTTP + Remote 流）交互 |
| **Host** | 常驻 Node.js 进程 | 核心 Cordis 大动脉服务、工具执行管线、会话日志持久化、Web 服务 | 具备宿主系统权限，管理敏感凭据与单调守卫 |
| **Worker** | 独立子进程 (Native Runner) | 执行高风险外部命令、隔离沙箱脚本与重计算任务 | 文件效果沙箱（bwrap/Landlock、Seatbelt、Windows ACL），崩溃不影响 Host |

UI 插件必须遵循**双面插件 (Dual-Face)** 规范：Node 端 `lib/index.js`，Browser 端 `lib/client.js`（经 `dsh.client` 声明、Slots 挂载；浏览器半侧只挂在裸包名行上）。

---

## 三、技术参考文档索引 (References)

| 文档分类 | 章节链接 | 核心内容概述 |
| --- | --- | --- |
| **微内核与服务** | [plugin-anatomy.md](./references/plugin-anatomy.md) | 插件解剖学深模块：三种形态、Context 树、生命周期、派发模式、四角色矩阵、设置表单（含原 context-api/seams/plugin-forms） |
| | [services.md](./references/services.md) | 官方服务矩阵（core/seam/bundle 角色）、`inject` 声明、Service 生命周期与命名规则 |
| **配置与补丁** | [config.md](./references/config.md) | Schemastery 校验、三层补丁落点与生效层顺序、全量替换语义、settings.yaml 废弃 |
| **事件与管线** | [events.md](./references/events.md) | 五大派发模式（waterfall=环绕中间件）与官方事件清单 |
| | [tools.md](./references/tools.md) | 执行流水线、单调守卫、schemas 白名单、PTC 模式与 UI 展示边界 |
| | [llm-adapter.md](./references/llm-adapter.md) | 适配器注册签名、StreamChunk 分片协议、Token 计量与错误契约 |
| **工程与架构** | [packaging.md](./references/packaging.md) | Bundle/Profile 互斥、层顺序、git 安装授权、workspace 联调（含原 workspace-package） |
| | [three-roles.md](./references/three-roles.md) | 三角色隔离、双面 UI 插件、Slots 层级树、IPC 与沙箱 |

---

## 四、实战示例库 (Examples)

技能内置 5 个即装即用的标准示例工程：
- [examples/greet-tool/](./examples/greet-tool/)：基于 `defineTool` 的最小模型工具插件。
- [examples/hello-plugin/](./examples/hello-plugin/)：基于 `ctx.effect` 的最小生命周期扩展插件。
- [examples/service-provider/](./examples/service-provider/)：自定义 Service 基类与跨插件服务注入示例。
- [examples/event-interceptor/](./examples/event-interceptor/)：基于 `ctx.tools.guard` 的单调安全守卫与审计插件。
- [examples/configurable-plugin/](./examples/configurable-plugin/)：基于 Schemastery 的强类型配置与校验插件。

---

## 五、快速开始

```bash
# 1. 向默认 web profile 添加插件组合包
dsh plugin add ./path/to/my-plugin

# 2. 导出并验证合并后的完整配置树
dsh --profile web --dump-config

# 3. 启动 DSH Web 实例
dsh web
```

---

<p align="right"><sub style="color: gray;">本项目基于 <a href="https://github.com/omdsh-dev/dsh-plugin-dev" target="_blank" rel="noreferrer">omdsh-dev/dsh-plugin-dev</a> 进行深度校准与持续演进。</sub></p>
