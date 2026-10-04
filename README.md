# DeepSeek Harness (DSH) 插件开发权威指南

<p align="center">
  <a href="https://github.com/Wenaixi/dsh-plugin-dev/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/Wenaixi/dsh-plugin-dev/ci.yml?branch=main&style=flat-square&label=CI%20Build" alt="CI Status" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  </a>
  <a href="https://github.com/Wenaixi/dsh-plugin-dev/pulls">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
  </a>
</p>

> **核心定位声明**
> **本项目是一个用于【开发 DeepSeek Harness (DSH) 插件】的辅助 Agent Skill（纯文本权威开发标准与架构知识库）。**  
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！** 它的核心目标是辅助开发者、架构师与 AI 智能体快速、零踩坑、高质量地编写、审查、调试各类 DSH / Cordis 插件。

---

本项目是开发、审查、调试 DeepSeek Harness（DSH）插件与生态扩展的参考知识库（Agent Skill）。具体 API、服务挂载名、配置字段和版本行为必须按目标环境的运行时、实际发布物和源码重新核对；证据优先级为运行时行为 > 发布物实现与 JSDoc > 包内 README > 文档站散文。

DSH 是基于 Cordis 微内核构建的高可扩展 Agent Harness。在 DSH 架构中，**一切皆为插件 (Everything is a Plugin)**：会话日志、工具注册表、系统提示词装配、模型适配器、UI 界面以及执行循环驱动器均作为平等、可插拔的插件运行。

---

## 一、核心架构原则

1. **零特权微内核**：不存在固化的特权逻辑。所有业务与平台能力均通过向共享 `Context` 挂载服务或监听事件提供。
2. **核心服务大动脉 (The Core Spine)**：**单复数是硬约束**——`ctx.sessions`、`ctx.agents`、`ctx.agentTeams`、`ctx.tools` 为复数；`ctx.systemPrompt`、`ctx.configEditor`、`ctx.schedule`、`ctx.planMode`、`ctx.llm` 为单数。`ctx.agentLoop` 是唯一的具体循环包（bundle），扩展插件依赖 `dsh-agent` 的事件与服务即可。完整 core/seam/bundle 角色矩阵见 [services.md](./references/services.md)。
3. **事件派发模式必须分别核对**：`emit`、`waterfall`、`parallel`、`serial`、`bail` 的等待、短路和返回值语义不同，不能按名称推断。源码级调度算法与 `isBailed` 边界见 [events.md](./references/events.md)。
4. **配置落点与全量替换规约**：`$DSH_HOME/settings.yaml` 已废弃；四层补丁（组合包 → profile → 全局 → `--patch`）后层按行胜出；条目 `config` **整体替换，不做深合并**，改一个字段必须写全该层所需字段。详见 [config.md](./references/config.md)。
5. **可逆副作用 (Reversible Effects)**：所有经 `ctx.on()`、`ctx.effect()`、`ctx.tools.register()` 注册的资源由所属 Fiber 跟踪，插件停用或热重载时自动逆向注销。

---

## 二、三角色物理架构模型

| 角色 | 运行环境 | 核心职责 | 安全与隔离机制 |
| --- | --- | --- | --- |
| **Browser** | 浏览器 / Desktop Webview | React 界面、浏览器端 Cordis 运行时、Slots 插槽、本地多语言 | 零本地文件系统与系统调用权限，经 Typert Remote（HTTP + Remote 流）交互 |
| **Host** | 常驻 Node.js 进程 | 核心 Cordis 大动脉服务、工具执行管线、会话日志持久化、Web 服务 | 具备宿主系统权限，管理敏感凭据与单调守卫 |
| **隔离进程**（源码中 Worker 专指 worker_threads） | 独立子进程 (Native Runner) | 执行高风险外部命令、隔离沙箱脚本与重计算任务 | 文件效果沙箱（bwrap/Landlock、Seatbelt、Windows ACL），崩溃不影响 Host |

UI 插件必须遵循**双面插件 (Dual-Face)** 规范：Node 端 `lib/index.js`，Browser 端 `lib/client.js`（经 `dsh.client` 声明、Slots 挂载；loader 行解析到其 package.json 后按该包名判定半侧，子路径行同样适用）。

---

## 三、技术参考文档索引 (References)

完整参考目录见 [references/README.md](./references/README.md)。新插件先读其中的通用专题，再按具体需求进入 DSH API 专题；通用专题覆盖依赖、生命周期、发现缓存、双面 UI、补丁与发布、静默失效和跨模块治理。具体服务、事件、工具、Remote、MCP、存储、沙箱、子智能体等专题也均在索引中维护。

---

## 四、交付前自检

本技能是**纯文本规范集**，不含脚本、脚手架或示例工程。按 [SKILL.md](./SKILL.md) 的路由和交付清单逐项自检：先核对真实服务与版本，再核对插件入口、依赖注入、生命周期、双面插件隔离、构建产物、打包清单和运行时真值。

## 五、快速开始

```bash
# 1. 向目标 profile 添加插件组合包（plugin 子命令必须带 --profile）
dsh plugin --profile <profile> add ./path/to/my-plugin

# 2. 导出并验证合并后的完整配置树
dsh --profile <profile> --dump-config

# 3. 启动 DSH Web 实例
dsh web

# 4. UI 或跨端插件：在真实浏览器中操作后回读接口、磁盘或注册表真值
```

---

