# g05 · references/services.md / references/events.md / references/cordis-context-internals.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：64
- OK：58
- WRONG：2
- STALE：0
- CONFLICT：2
- UNVERIFIED：2

## 逐条报告

### [WRONG] services.md L33：schedule 配套组合包名

- **现文**：`配套组合包：@deepseek-ai/dsh-experimental-schedule-bundle`
- **问题**：该包在 0.2.0-rc.2 发布物中不存在。
- **应为**：删除配套组合包行（或改为「无配套组合包」）。
- **证据**：`E:/newCC/APP/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai` 目录下不存在 `dsh-experimental-schedule-bundle`（readdir 全量列目录零命中）。文档 L33 的「配套组合包」说法无真源。

### [WRONG] services.md L57：删除工作区实体不删物理日志

- **现文**：`删除工作区实体绝不删除底层物理会话日志文件`
- **问题**：真源措辞是「保留目录与每条会话日志」，方向正确但把「保留」写成了「绝不删除」，语义更强但无源码字面支持。
- **应为**：删除工作区实体**保留**其目录与每条会话日志（`dsh-workspace/lib/index.js:460`）。
- **证据**：`dsh-workspace/lib/index.js:460` `Delete one workspace registration while retaining its directory and every session log.`

### [CONFLICT] services.md L33 与 L80-L81 内部矛盾

- **L33 现文**：`配套组合包：@deepseek-ai/dsh-experimental-schedule-bundle`
- **L80-L81 现文**：终端 Seam 默认实现 `@deepseek-ai/dsh-terminal-bash` / pwsh
- **应为**：L33 删除不存在的组合包；L80-L81 改为 `@deepseek-ai/dsh-terminal-bash`（bash/pwsh 方言同一包，无独立 `dsh-terminal-pwsh`）。
- **证据**：`@deepseek-ai/dsh-experimental-schedule-bundle`、`@deepseek-ai/dsh-terminal-pwsh` 均不在发布物目录；`dsh-terminal-bash/README.zh.md:12`（POSIX 上 bash、Windows 上 pwsh，单一后端）与 `package.json`。

### [CONFLICT] events.md L53 与 events.md L133 内部矛盾

- **L53 现文**：`agent/created | serial`（生命周期广播）
- **L133 现文**：`ctx.on('agent/created', (agent) => … agent.id)`（监听器形参为单个 agent）
- **应为**：L133 形参应为 `({ agent, source, signal? })` 对象（dsh-agent 派发载荷 `{ agent, source, ...signal }`）。
- **证据**：`dsh-agent/lib/index.js:579` `this.ctx.serial(entry.carrier, "agent/created", { agent: entry.agent, source, ...signal === void 0 ? {} : { signal } })`。

### [UNVERIFIED] events.md L51：plan/mode 双重机制

- **现文**：`持久化层为仅记日志的 SessionEvent plan/mode（整值替换，绝不进入模型 transcript）`
- **问题**：源码确认 `plan/mode` 为仅记日志事件（KNOWN 集合 L48、plan-mode append `{ active }` L377）且 plan-mode 投影只推导 `{ active, pending }` 视图（plan-mode lib L97-124）；但「绝不进入模型 transcript」的主语边界需人工复核——plan-mode README.zh:154 说明不带附件的 `/plan` 与 `/plan off` 留在模型历史之外，而带消息后缀的 `/plan <text>` 会经 `agent.steer()` 成为一条用户消息进入历史（README.zh:93-94、154）。L51 无「/plan <text> 会进入历史」的限定，易被误读为所有 plan 相关都不进 transcript。

### [UNVERIFIED] services.md L38：投递保证

- **现文**：`交付承诺必须在会话确认 session/flush 后提交`
- **问题**：源码确认 schedule 投递在 `ctx.sessions.flush()` 返回真值后才 `commit`（`dsh-schedule/lib/index.js:1597-1598`），「冷会话在到期时由宿主自动拉起」由 `sessionController.resolveAgent`（`dsh-api-session-controller/lib/index.js:208-244`）实现；但「session/flush」这一事件名的字面语义（哪些监听器参与确认）未在本次范围逐行核实，属可接受的边界，判 UNVERIFIED。

## 核实通过的关键项（摘录，全部 OK）

- services.md L17：`ctx.sessions` 复数（dsh-session L1621 super(ctx,"sessions")）
- services.md L18：`ctx.systemPrompt` + section() 方法（dsh-system-prompt L213/L240；addSection 全库 0 命中）
- services.md L19：`ctx.tools` + README 六段管线（dsh-tools L2704；README.md:105）
- services.md L20：`ctx.agents` 复数（dsh-agent L332）
- services.md L21-22：`ctx.configEditor`/super(ctx,"configEditor")（config-editor L20）；`ctx.settings`（settings L330）
- services.md L23：`ctx.clientModules` Host、Browser `ctx.modules`（client-modules L526、lib/client.js:868 `ctx.reflect.provide("modules", …)`）
- services.md L24：`ctx.agentLoop` bundle（agent-loop L1552；package.json 无 dsh.bundle，属「具体实现包」表述可接受）
- services.md L25：`ctx.llm` seam（llm L1801；README.zh「提供方适配器」）
- services.md L32/36-37/39：`ctx.schedule`、deliveryHistoryDays=30（L2501）、deliveryHistoryRecords=200（L2503）、四工具（L2120/2157/2176/2207）
- services.md L42-45：`ctx.agentTeams`（agent-team L1704）；工具九件套含 team:policy 段落（tool-agent-team L238-459）
- services.md L48-51：`ctx.planMode`（plan-mode L149）、exit_plan_mode、/plan off
- services.md L54-56：`ctx.workspaceRegistry`（workspace L374）
- services.md L60-64：compaction 抽象 + basic/image-offload/tool-result-pruner 三包
- services.md L67-68：dsh-scope 导出 createScope/scopeOf/scopeTarget（scope L357）；无 ctx.scope（全库 0 命中）；peer 含 dsh-invariants 与 cordis（package.json）
- services.md L71-72：@liustack/modsearch 不在发布物（0 命中）
- services.md L80-89：Seam 对照表挂载属性逐一核实（subprocess/terminals/fs/credentials/sessionPersistence/sessionQuery/sandbox/approval/agentPresets/skills；dsh-approval 不存在；agent-preset-registry L481、skill L132）
- services.md L102：Service 构造器 (ctx, name?)（cordis src/service.ts:42 name 可选）
- services.md L106：ctx.effect 注册清理（fiber.ts:418）
- events.md L13-17：五大派发实现（cordis src/events.ts:183-243）
- events.md L22-24：isBailed（src/events.ts:13-15）
- events.md L32-37：EventOptions prepend/global、布尔简写（src/events.ts:112-117、288-291）
- events.md L39-41：Disposer、thisArg 首参重载（src/events.ts:165-175、254-275、288-318）
- events.md L49-50：session-activity waterfall、四大活动族（SessionActivityKindMap turn/job/subagent/schedule）；session-stop parallel + AggregateError 逐条 warn（workspace L621-626）
- events.md L52：skills/change emit 无参（skill L404）
- events.md L53-54：agent/created serial、agent/disposed emit 防御隔离（agent L579、L547-560）
- events.md L60：59 事件实测（known-event-types.js 集合 = 59）
- events.md L63-68：5 类表面事件（surface.js SURFACE_EVENT_TYPES）
- events.md L71-73：surfaceOp append/replace（api-catalog SurfaceOp；surface.js isReplaceOp）
- events.md L76-79：ignorable fail-fast（session-persistence L182-184）
- events.md L81-84：SHA-256 指纹机制（session-query-sqlite L1004-1008）
- cordis-context-internals.md L11-17：ctx.isolate（context.ts:121-125；隔离键存 symbols.isolate）
- cordis-context-internals.md L19-21：ctx.intercept 配置拦截（context.ts:139-145；service.ts:86-102）
- cordis-context-internals.md L23-31：Context.is + Symbol.toPrimitive（context.ts:61-68）

