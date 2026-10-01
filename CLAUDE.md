# dsh-plugin-dev 项目记忆库 (CLAUDE.md)

## 1. 项目定位与目标
- **定位**：DeepSeek Harness (DSH) 插件开发的标准与权威参考 Skill。
- **当前最新基线**：DSH 0.2.0-rc.2（2026-09-30 升级基线）。
- **核心目标**：提供编写、修改、审查、调试 DSH / Cordis 插件、核心服务、事件系统、配置规范、模型工具、LLM 适配器、双面 UI 插件、三角色拆分和打包发布的完全准确指南。

## 2. DSH 0.2.0-rc.2 官方核心架构真相与权威规范

### A. 核心服务名称矩阵 (The Core Spine)
| 服务名称 | 挂载属性 | 所属核心包 | 职责与说明 |
| --- | --- | --- | --- |
| SessionLog | `ctx.sessions` (复数!) | `@deepseek-ai/dsh-session` | 仅追加的 SessionEvent 日志与状态唯一真源，严禁误写为 session |
| SystemPrompt | `ctx.systemPrompt` | `@deepseek-ai/dsh-system-prompt` | 提示词片段组装与工具 Schema 生成 |
| ToolRuntime | `ctx.tools` | `@deepseek-ai/dsh-tools` | 作用域化工具注册表、保护执行管线与展示投影 |
| AgentRegistry | `ctx.agents` (复数!) | `@deepseek-ai/dsh-agent` | Agent 句柄注册表、发起者作用域与 `agent/*` 事件 |
| AgentLoop | `ctx.agentLoop` | `@deepseek-ai/dsh-agent-loop` | 实现 AgentFactory 的具体默认执行循环驱动器 |
| LlmRuntime | `ctx.llm` | `@deepseek-ai/dsh-llm` | 消息协议、流式分发、重试策略与适配器注册 |
| ScopeLib | 无 (纯函数库) | `@deepseek-ai/dsh-scope` | `createScope` / `scopeOf` / `scopeTarget` 零依赖作用域库 |
| ConfigEditor / Settings | `ctx.settings` | `@deepseek-ai/dsh-settings` | 配置表单与补丁持久化服务 |

### B. Cordis 五大事件派发模式 (Dispatch Modes)
1. **emit**：同步广播，按注册顺序通知，无返回值，不等待异步。
2. **waterfall**：同步瀑布流传递，后一个监听器接收前一个监听器的返回值并加工传递，返回最终值。
3. **parallel**：异步并发广播，使用 `Promise.all` 同时执行，返回结果数组。
4. **serial**：异步串行执行，按注册顺序依次 `await`，返回结果数组。
5. **bail**：异步短路阻断，按序执行遇到第一个非 undefined / 命中条件的值即终止，返回该阻断值。

### C. 配置系统重大修正 (SETTINGS & PATCH SEMANTICS)
1. **废弃警告**：`$DSH_HOME/settings.yaml` 已完全废弃！启动时会被自动重命名为 `settings.yaml.imported` 并不再生效。严禁教导用户修改 settings.yaml！
2. **真实落点**：用户与插件配置的唯一合法落点是 Profile 的补丁文件：
   `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。
3. **全量替换语义**：Patch 中条目的 `config` 字段是**整体替换，不进行深合并 (Replaced wholesale, not deep-merged)**。修改已有插件配置时必须传入完整字段，不能仅传增量字段。
4. **补丁语法**：
   - 新增插件：使用 `- insert: [ { id, name, config, disabled } ]`
   - 覆盖/扩展已有插件：直接使用 `- id: <target-id>, config: { ... }`
   - 条件禁用：支持 `disabled: !!js '!process.env.VAR'`

### D. 工具开发体系 (ToolRuntime)
- **注册方式**：推荐 `defineTool({ name, description, parameters, output, execute })`。
- **作用域与隔离**：
  - `ctx.tools.register()`：全局或在 agent 作用域注册；
  - `ctx.tools.presentAs(mode)`：针对当前作用域切换展示模式（如 PTC 模式 vs 原生模式）；
  - `ctx.tools.guard(guard)`：注册单调执行卫士（返回 string 原因即拒绝）；
  - `ctx.tools.restrict(filter)`：为当前 agent 作用域掩码过滤全局可用工具。

### E. Web 架构与 Client-UI 插件开发规范 (Web & Client-UI Standards)
1. **双面插件模型 (Dual-Face Plugin)**：
   - **Host 半侧**：`lib/index.js` 导出 `apply(ctx)`，供宿主 Cordis Loader 挂载与静态扫描。
   - **Client 半侧**：在 `package.json` 的 `dsh.client` 字段声明，导出 `./client`（指向 `lib/client.js`）。
2. **构建与加载链条**：
   - 构建命令：`tsc -b && tsdown`，输出为惰性 CJS bundle，注册至 `window.__ModuleLoader__`。
   - 启动图注入：Host 侧 `ctx.clientModules` 组合已启用插件，将启动清单注入 HTML `<head>` 的 `window.__DSH_BOOT__`，静态资源经由 Combo 路由 (`/plugins/??...&rev=...`) 提供。
   - 浏览器 Cordis 运行时：浏览器内运行专有 Cordis 实例，仅在模块首次被消费时惰性物化 (materialize)。
   - HMR 热重载：由 `@deepseek-ai/dsh-client-hmr` 驱动，基于 SSE 派发图更新，自动执行 `tearDownEntryFiber` 回收旧 fiber 与样式。
3. **UI 挂载与扩展规范**：
   - **Slot 插槽注册**：严禁直接操作外部 DOM，统一通过 `ctx.slots.inject(slotKey, () => ctx.slots.register(meta, Component))` 挂载组件。
   - **核心 Slot 键位**：`root`（AppFrame 根布局）、`sidebar.*`（工作区、设置入口、角标）、`conversation.*`（输入框底座、上下文选择器）、`settings.general.item`（通用设置项）、`settings.plugins.tab`（内置插件标签页）。
   - **样式注入与回收**：CSS 编译进 bundle，物化时创建带 `data-plugin` 属性的 `<style>` 标签；插件注销或 HMR 时由 `removeOwnedStyles()` 精确清理。
   - **设置持久化**：通过 `ctx.configForms` 读写偏好，服务端直接写入当前 Profile 的 `cordis.patch.yml`。

### F. 三角色架构模型与真实 IPC 通信机制 (Three Roles & IPC Architecture)
1. **角色分工**：
   - **Browser (客户端)**：React 18 + 浏览器端 Cordis 运行时，驱动 SlotRegistry 界面呈现与本地状态。
   - **Host (Node.js 宿主)**：DSH 核心服务总线 (The Core Spine: sessions, tools, agents, llm, settings, clientModules) 与 Web 服务器。
   - **Worker (工作进程 / 沙箱)**：独立子进程，运行 Native Runner（PowerShell、Bash、Python），隔离高风险与重计算任务。
2. **IPC 通信通道**：
   - **Browser <-> Host**：
     - 一元 RPC：HTTP POST `/api/...`，严格结构化 JSON 响应信封，支持 Multipart 二进制分块与 ArrayBuffer 恢复。
     - 流式长连接：WebSocket `/api/remote.mux`，双向多路复用通道，投递 Agent StreamChunk、会话日志、终端 PTY 流与断线重连 generation 对账。
   - **Host <-> Worker**：
     - 专用控制通道：基于专有文件描述符 `SUBPROCESS_CONTROL_FD` (`control: 'pipe'`) 与标准 stdio 管道。
     - Runner 协议：Host 下发 `WindowsStartRequest` / `LinuxLaunchRequest` 与 `WindowsTerminateRequest`；Worker 响应 `WindowsRunnerResult` 与退出码 / 错误。
     - 内存保护：Worker 捕获子进程输出，发生海量输出时自动落盘至 `spillPath` 临时文件，避免主管道阻塞溢出。

## 3. 文档纠错与更新计划表 (已全部圆满完成)
- [x] 1. 重构 `references/services.md`（纠正 ctx.sessions, ctx.agents, ctx.llm, 补充完整核心服务矩阵）
- [x] 2. 重构 `references/config.md`（彻底移除 settings.yaml 废弃内容，详述 cordis.patch.yml 与全量替换语义）
- [x] 3. 重构 `references/events.md`（纠正 5 大派发模式，详细补充核心生命周期与 Agent/Tool 事件）
- [x] 4. 重构 `references/tools.md`（补充 presentAs, guard, restrict, ContentBlock 多模态输出投影）
- [x] 5. 重构 `references/llm-adapter.md`（补充 LlmRuntime.registerAdapter, ReplayEnvelope, 重试策略与 StreamChunk）
- [x] 6. 重构 `references/three-roles.md`（更新现代 Web Client-UI 插件开发标准与 IPC 通信）
- [x] 7. 重构 `references/packaging.md` 与 `references/workspace-package.md`（对齐 0.2.0-rc.2 bundle 与 profile 规范）
- [x] 8. 重构 `references/plugin-anatomy.md`、`references/context-api.md`、`references/seams.md`、`references/plugin-forms.md`
- [x] 9. 更新 `SKILL.md` 主入口（对齐最新术语与权威指引）
- [x] 10. 校验并修复 `examples/` 下的 5 个示例插件配置与代码
- [x] 11. 重写 `references/README.md` 与 `references/README.en.md`
- [x] 12. 重写根目录 `README.md` 与 `README.en.md`
