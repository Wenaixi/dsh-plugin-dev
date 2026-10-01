# DeepSeek Harness (DSH) 插件开发权威指南

<p align="center">
  <samp>
    <strong>中文</strong> ·
    <a href="./README.en.md">English</a>
  </samp>
</p>

本项目是开发、审查、调试 **DeepSeek Harness (DSH 0.2.0-rc.2)** 插件与生态扩展的标准与权威参考知识库（Agent Skill）。

DSH 是基于 Cordis 微内核构建的高可扩展 Agent Harness。在 DSH 架构中，**一切皆为插件 (Everything is a Plugin)**：会话日志、工具注册表、系统提示词装配、模型适配器、UI 界面以及执行循环驱动器均作为平等、可插拔的插件运行。

---

## 一、核心架构原则

1. **零特权微内核**：系统不存在需要特殊侵入的固化内核。所有业务与平台能力均通过向共享 `Context` 注入服务或监听事件提供。
2. **核心服务大动脉 (The Core Spine)**：
   - `ctx.sessions` (`@deepseek-ai/dsh-session`)：仅追加事件日志与唯一真源。
   - `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`)：提示词装配与工具 Schema 生成。
   - `ctx.tools` (`@deepseek-ai/dsh-tools`)：工具注册表、单调安全守卫、PTC 模式与多模态渲染。
   - `ctx.agents` (`@deepseek-ai/dsh-agent`)：活跃 Agent 句柄注册表与发起者作用域。
   - `ctx.agentLoop` (`@deepseek-ai/dsh-agent-loop`)：实现 `AgentFactory` 的默认执行驱动器。
   - `ctx.llm` (`@deepseek-ai/dsh-llm`)：提供方无关消息流式协议与适配器注册。
   - `ctx.settings` (`@deepseek-ai/dsh-settings`)：配置表单描述符与补丁持久化服务。
3. **五大事件派发模式 (Dispatch Modes)**：
   - `emit`：同步广播通知，无返回值；
   - `waterfall`：同步串行链式加工，返回最终加工数据；
   - `parallel`：`Promise.all` 异步并发等待，返回结果数组；
   - `serial`：按序 `await` 异步串行等待，返回结果数组；
   - `bail`：异步短路阻断，首个非 `undefined` 返回值立即终止流程。
4. **配置落点与全量替换规约**：
   - **废弃警告**：`$DSH_HOME/settings.yaml` 已完全废弃，修改无效。
   - **唯一落点**：用户与插件配置落点为 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。
   - **全量替换 (Wholesale Replacement)**：Patch 中的 `config` 覆盖为整体替换，不做深合并。修改已有条目必须提供完整的配置字段。
5. **可逆副作用 (Reversible Effects)**：所有通过 `ctx.on()`、`ctx.effect()`、`ctx.tools.register()` 注册的资源均由所属 Fiber 跟踪，在插件停用或热重载时自动逆向注销。

---

## 二、三角色物理架构模型

DSH 实现了严格的物理进程与职责隔离：

| 角色 | 运行环境 | 核心职责 | 安全与隔离机制 |
| --- | --- | --- | --- |
| **Browser** | 浏览器 / Desktop Webview | React 18 界面、浏览器端 Cordis 运行时、SlotRegistry 插槽、本地多语言 | 零本地文件系统与系统调用权限，通过 HTTP RPC 与 WebSocket 交互 |
| **Host** | 常驻 Node.js 进程 | 运行核心 Cordis 大动脉服务、工具执行管线、会话日志持久化、Web 静态服务 | 具备宿主系统权限，管理敏感凭据与单调安全守卫 |
| **Worker** | 独立子进程 (Native Runner) | 执行高风险外部命令（PowerShell、Bash）、隔离沙箱脚本与重计算任务 | Windows Job Object 隔离 Token 或 Linux cgroup 限制，崩溃不影响 Host |

对于涉及 Web UI 的插件，必须遵循**双面插件 (Dual-Face)** 规范：Node 端提供 `lib/index.js`（供 Loader 条目树识别），Browser 端提供 `lib/client.js`（通过 `dsh.client` 声明并由 SlotRegistry 挂载）。

---

## 三、技术参考文档索引 (References)

| 文档分类 | 章节链接 | 核心内容概述 |
| --- | --- | --- |
| **微内核与服务** | [plugin-anatomy.md](./references/plugin-anatomy.md) | 函数插件与 Service 类插件解剖、`name`、`inject` 与生命周期 |
| | [services.md](./references/services.md) | 核心大动脉服务矩阵、依赖拓扑解析与 TypeScript 类型合并声明 |
| | [context-api.md](./references/context-api.md) | Cordis 上下文树、`ctx.plugin`、`ctx.effect` 与作用域库 |
| | [seams.md](./references/seams.md) | 八大能力切面全表映射、依赖倒置法则与可替换设计 |
| **配置与表单** | [config.md](./references/config.md) | Schemastery 校验、`cordis.patch.yml` 补丁语法与全量替换语义 |
| | [plugin-forms.md](./references/plugin-forms.md) | 设置表单投影、条目 ID 寻址、乐观版本控制与原子持久化 |
| **事件与管线** | [events.md](./references/events.md) | 五大事件派发模式对比矩阵与 DSH 核心生命周期事件清单 |
| | [tools.md](./references/tools.md) | `ToolRuntime` 管理、`defineTool` DSL、单调守卫与 PTC 投影 |
| | [llm-adapter.md](./references/llm-adapter.md) | LLM 适配器接入、`StreamChunk` 协议与互斥 Token 计量准则 |
| **工程与架构** | [packaging.md](./references/packaging.md) | Bundle 与 Profile 规范、`package.json` 清单与安装流 |
| | [workspace-package.md](./references/workspace-package.md) | Monorepo 多包工作区联调、本地相对路径安装与实时 HMR |
| | [three-roles.md](./references/three-roles.md) | Browser/Host/Worker 三角色隔离、双面 UI 插件与 IPC 网络 |

---

## 四、实战示例库 (Examples)

技能内置了 5 个即装即用的标准示例工程：
- [examples/greet-tool/](./examples/greet-tool/)：基于 `defineTool` 的最小模型工具插件。
- [examples/hello-plugin/](./examples/hello-plugin/)：基于 `ctx.effect` 的最小生命周期扩展插件。
- [examples/service-provider/](./examples/service-provider/)：自定义 Service 基类与跨插件服务注入示例。
- [examples/event-interceptor/](./examples/event-interceptor/)：基于 `ctx.tools.guard` 的单调安全守卫与审计插件。
- [examples/configurable-plugin/](./examples/configurable-plugin/)：基于 Schemastery 的强类型配置与校验插件。

---

## 五、快速开始

安装并激活插件至 DSH 运行环境中：

```bash
# 1. 向默认 web profile 添加插件组合包
dsh plugin add ./path/to/my-plugin

# 2. 导出并验证合并后的完整配置树
dsh --profile web --dump-config

# 3. 启动 DSH Web 实例
dsh web
```
