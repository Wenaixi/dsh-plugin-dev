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

## 3. 文档纠错与更新计划表（两轮深度校准，全部完成）

第一轮（旧基线 0.2.0-rc.2 重构）：services/config/events/tools/llm-adapter/three-roles/packaging/plugin-anatomy/SKILL.md/README 全部重构，删除冗余 .en.md 与失效链接。

第二轮（官方 44 页逐页核实 + 7 组子代理深度审计后的权威校准，本会话完成）：

- [x] A. 五大派发模式按 cordis-api 原文修正：waterfall=环绕中间件（next() 短路/整体替换）、parallel 返回 `Promise<void>`（非结果数组）、serial 返回首个 bail 值（非结果数组）、bail 同步、bail 值=非 null/false/undefined；`on` 返回 disposer、EventOptions=prepend/global、thisArg 重载（agent-a）
- [x] B. Context API：extend/isolate/intercept 语义、get(strict) 只返回活动提供方、provide 唤醒依赖方、accessor/mixin 随 fiber 移除、Context.is 全局品牌（agent-a）
- [x] C. 工具执行流水线按 tool-execution-pipeline 官方精确顺序：tool/call 先记录 → presentCall → pre-execute → 单调 guard（deny/abstain）→ approval allowed-once → execute → 工具 execute → FS Gate → 工具自有事件 → projectContent → post-execute → 规范化 → finalizeContent → tools/result（同步）→ tool/result（持久化）→ presentResult；denied 仍进 projectContent（agent-e）
- [x] D. tools.md 补官方工具归属表（run_code→tool-run-code、bash/pwsh→tool-bash/pwsh、edit/read→tool-fs、glob/grep→tool-fs-search、skill→tool-skill、subagent 系、job_*、goal 系、session_* 等），目录以 `ctx.tools.schemas()` 运行时结果为准（agent-e）
- [x] E. three-roles.md 补 Typert api-gateway 契约：`@Remote`/`@RemoteScope` 才开放 Client、签名硬约束（禁解构/默认值/rest/可选）、协作取消 signal 最后一参、stream mode 经 /api/remote.mux（唯一合法用途）、错误码、构建流程（agent-e）
- [x] F. events.md 补持久会话事件族（persistence-catalog 约 60 个）：5 类 SurfaceEventType、surfaceOp append/replace、ignorable 缺席=必需、类型指纹 SHA-256（agent-e）
- [x] G. events.md 补宿主事件：workspace/session-activity（waterfall）、workspace/session-stop（parallel）、plan/mode、skills/change（agent-e）
- [x] H. services.md 补宿主可选能力：ctx.planMode（PlanModeController、plan:policy order 50、软性指引）、ctx.workspaceRegistry（成员资格双条件、delete 不动会话日志）、dsh-agent-instructions 非 workspace 消费方；skills 注册表六级 rank 100-600、/**/SKILL.md 不支持、模型目录只用 name+description（agent-e）
- [x] I. config.md 补生成器目录规则：config-catalog/persistence-catalog/tool-catalog 由 gen-*.ts 产出、verify-* 校验、禁止手改；运行时 seam 字段不能经 cordis.yml 设置（agent-e）
- [x] J. CLAUDE.md 自身：A 节矩阵升级官方 core/seam/bundle 角色列、F 节 IPC 对齐 Typert Remote 架构（agent-a/b/f）
- [x] K. 子代理产物清理：.doccheck/、docs-cache/、dsh-docs/、fetch-cache/、dsh-subsystems-doc-audit.md 已从工作树删除；examples/README.en.md、references/README.en.md 等冗余英文文件按 skill-designer-agent-skills 规范删除
- [x] L. 失效链接清扫：grep 全库无 seams.md/context-api.md/plugin-forms.md/workspace-package.md 残留（CLAUDE.md 历史表除外，本表即为其新版本）

- [x] M. 第三轮（0.2.0-rc.2 源码深度审计与四文档全量校准）：
  - three-roles.md：精准区分 HTTP 一元 RPC POST /api/<ns>/<method> 与流式专用 /api/remote.mux；彻底排除 Client Runtime / HostFrame / events.mux / events.host 等伪概念；强调 argv 严格零 shell 解释安全边界。
  - plugin-anatomy.md：补齐“双面插件模型 (Dual-Face Plugin Anatomy) 与 Slots 插槽体系”解剖学；解密 package.json dsh.client、lazy CJS bundle、window.__DSH_BOOT__、Combo 路由；明立“组件绝不能接收 ctx”铁律与官方 Slot 层级树。
  - packaging.md：补全 package.json 中 dsh.client 配置规范；新增 npm install --legacy-peer-deps 根因剖析与 pnpm OOM 8GB 堆内存避坑指南。
  - llm-adapter.md：补齐 LlmAdapter 抽象类契约与 7 种 StreamChunk 完整封闭判别联合 TypeScript 代码定义。
