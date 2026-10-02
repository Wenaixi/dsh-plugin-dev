# dsh-plugin-dev 项目记忆库 (CLAUDE.md)

## 1. 项目定位与目标
- **定位**：DeepSeek Harness (DSH) 插件开发的标准与权威参考 Skill。
- **当前最新基线**：DSH 0.2.0-rc.2（2026-09-30 升级基线）。
- **核心目标**：提供编写、修改、审查、调试 DSH / Cordis 插件、核心服务、事件系统、配置规范、模型工具、LLM 适配器、双面 UI 插件、三角色拆分和打包发布的完全准确指南。

## 2. DSH 0.2.0-rc.2 官方核心架构真相与权威规范

### A. 核心服务名称矩阵 (The Core Spine，官方 core/seam/bundle 角色)
| 服务名称 | 挂载属性 | 角色 | 所属核心包 | 职责与说明 |
| --- | --- | --- | --- | --- |
| SessionStore | `ctx.sessions` (复数!) | core | `@deepseek-ai/dsh-session` | 仅追加的 SessionEvent 日志与状态唯一真源，严禁误写为 session |
| SystemPrompt | `ctx.systemPrompt` | core | `@deepseek-ai/dsh-system-prompt` | 提示词片段组装与工具 Schema 生成 |
| ToolRuntime | `ctx.tools` | core | `@deepseek-ai/dsh-tools` | 注册能力、PTC 传输、策略前处理→单调守卫→环绕分派→策略后处理→结果观测 |
| AgentRegistry | `ctx.agents` (复数!) | core | `@deepseek-ai/dsh-agent` | Agent 句柄注册表、发起者作用域与 `agent/*` 事件 |
| ConfigEditor | `ctx.configEditor` | core | `@deepseek-ai/dsh-config-editor` | 在应用文件锁与 HMR 队列下持久化 profile 配置补丁、协调 Loader 条目 |
| Settings | `ctx.settings` | core | `@deepseek-ai/dsh-settings` | 从活动 profile 条目投影 volatile Config 成表单，委托 configEditor 落盘 |
| AgentLoop | `ctx.agentLoop` | **bundle** | `@deepseek-ai/dsh-agent-loop` | 唯一的具体循环插件；扩展包依赖 dsh-agent 事件与服务，**绝不依赖此包** |
| LlmRuntime | `ctx.llm` | **seam** | `@deepseek-ai/dsh-llm` | 提供方无关流式协议与适配器注册（实现 llm-deepseek / llm-pi-ai / llm-replay） |
| 其余 seam | subprocess/shell/web/jobs/fs/credentials/sessionPersistence/sessionQuery/storage/skills/ptcRuntime/sandbox/approval/compaction | seam | 各自 Definition 包 | 契约与实现分离，实现以不同名称注册提供方 |
| ScopeLib | 无 (纯函数库) | — | `@deepseek-ai/dsh-scope` | `createScope` / `scopeOf` / `scopeTarget` 零依赖作用域库，**不挂载服务** |

### B. Cordis 五大事件派发模式 (Dispatch Modes，官方权威)
1. **emit**：同步广播，按注册顺序通知，无返回值，不等待异步。
2. **waterfall**：**同步环绕中间件**，监听器收 `(...args, next)`，调 `next()` 执行下游、不调即短路（可整体替换结果），返回最终加工值。**不是传值链**。
3. **parallel**：异步并发（`Promise.all`）等待**全部 settle**，返回 `Promise<void>`，**不是结果数组**。
4. **serial**：依次 `await` 直到第一个 bail 值（非 null / 非 false / 非 undefined），返回该值。
5. **bail**：**同步**按序调用直到第一个同步 bail 值，返回该值。

### C. 配置系统重大修正 (SETTINGS & PATCH SEMANTICS)
1. **废弃警告**：`$DSH_HOME/settings.yaml` 已完全废弃！启动时会被自动重命名为 `settings.yaml.imported` 并不再生效。严禁教导用户修改 settings.yaml！
2. **三层落点（+ overlay）**：组合包自带 patch（按 bundles 列表序）→ `$DSH_HOME/profiles/<profile>/cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 每个 `--patch` overlay（按 argv 顺序）。后层按行胜出。
3. **全量替换语义**：Patch 中条目的 `config` 字段是**整体替换，不进行深合并 (Replaced wholesale, not deep-merged)**。修改已有插件配置时必须传入完整字段，不能仅传增量字段。
4. **补丁语法**：
   - 新增插件：使用 `- insert: [ { id, name, config, disabled } ]`
   - 覆盖/扩展已有插件：直接使用 `- id: <target-id>, config: { ... }`
   - 条件禁用：支持 `disabled: !!js '!process.env.VAR'`
   - `ctx.configEditor`（core）在应用文件锁与 HMR 队列下持久化 profile 补丁、再协调 Loader 条目；设置表单层（settings）只投影与校验，落盘永远走 patch。

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
   - **Slot 插槽注册**：严禁直接操作外部 DOM，统一通过 `ctx.slots.inject(slotKey, () => ctx.slots.register(meta, Component))` 挂载组件；组件**绝不收到 ctx**；跨包 UI 一律 inject + register，严禁 import 他包组件运行时。
   - **官方 slot 层级树**：`root` → `sidebar.*`（.brand/.workspaces/.settings）、`main.*`（plugins.*、conversation.session/view/chat.node/composer/input.*）、`rightbar.session→sidebar.right.pane.tab`、`shell.*`（leading/overlay）；已知注入点 `settings.general.item`、`settings.models.provider-card`、`settings.plugins.tab`。
   - **cardinality/scope**：single/list/keyed/chain × root/session-maybe/session；调试用 `cordis_inspect what:"client"`。
   - **样式注入与回收**：CSS 编译进 bundle，物化时创建带 `data-plugin` 属性的 `<style>` 标签；插件注销或 HMR 时由 `removeOwnedStyles()` 精确清理。
   - **client 包**：`dsh.client.platform='web'`、注入 `@deepseek-ai/dsh-client-ui-settings`；浏览器半侧**只挂在裸包名行**；`./client` 为 lazy-CJS factory。

### F. 三角色架构模型与真实 IPC 通信机制 (Three Roles & IPC Architecture)
1. **角色分工**：
   - **Browser (客户端)**：React + 浏览器端 Cordis 运行时，驱动 Slots 插槽系统呈现与本地状态。
   - **Host (Node.js 宿主)**：DSH 核心服务总线 (The Core Spine: sessions, tools, agents, llm, settings, clientModules) 与 Web 服务器。
   - **Worker (工作进程 / 沙箱)**：独立子进程，运行 Native Runner（PowerShell、Bash、Python），隔离高风险与重计算任务。
2. **IPC 通信通道（官方 Typert Remote 架构）**：
   - **Browser <-> Host**：
     - 生成式 Remote：直接调用 `ctx.remote.<namespace>`、作用域调用 `agentCtx.remote.<namespace>`；`@Remote` / `@RemoteScope` 才把方法开放给 Client；HTTP 一元 RPC 落在 `POST /api/<namespace>/<method>`；`ctx.remote.$on()` 转发 allowlist 事件（root）+ scoped waterfall 事件（session）。
     - **不存在** Client Runtime / HostFrame / `events.mux` / `events.host` / 通用 `resync()`；`page()` 仅用于更早历史与 gap repair；普通通知不重放、可靠恢复需 baseline/cursor/显式 query。
   - **Host <-> Worker（`ctx.subprocess`）**：
     - `spawn(spec)` 同步返回活跃 handle；`argv` 绝不 shell 解释；stdio 全显式、seam 零默认；`SubprocessCollect` 溢出保 TAIL + 可选 `spillPath` 落盘（offset reader `readFrom`）。
     - `spawnTerminal`：唯一非管道原语，拥有终端分配/前台组/信号/整体清停；就绪/scrollback/沙箱归 PTY 消费方。
     - `done` 只报 close 词汇（exitCode/signal），不带超时/取消分类。
   - **沙箱（`ctx.sandbox`）**：`SandboxMode = read-only | workspace-write | danger-full-access` **只管文件效果**（不管网络/进程可见性）；danger 不经 ctx.sandbox；策略逐调用携带；无后端 fail-closed（`SandboxUnavailableError`）；denial=沙箱正常拦截、runner failure=命令从未执行、**退出状态永不能证明 runner 失败**。

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
