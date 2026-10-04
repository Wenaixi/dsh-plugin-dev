# g10 · references/system-prompt-and-projections.md + references/storage-terminals-and-checkpoints.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：39
- OK：33
- WRONG：5
- STALE：0
- CONFLICT：1
- UNVERIFIED：0

## 逐条报告

### [WRONG] DOC1 L55：会话日志存在"SHA-256 结构校验"

- **现文**：`直接修改会破坏会话序号指纹（SessionSeq）与 SHA-256 结构校验，导致会话无法反序列化崩溃`
- **问题**：@deepseek-ai 下会话侧包（dsh-session / dsh-session-persistence / dsh-session-persistence-jsonl / dsh-session-format / dsh-session-log-deepseek）没有任何会话日志级 SHA-256 校验。日志完整性依赖：(a) seq 连续性校验（`session event seq X is not contiguous`，dsh-session/lib/index.js L453 `planSurfaceEvent`；`assertContiguous`，dsh-session-persistence/lib/index.js）；(b) 首行 header 结构与格式版本校验（`corrupt session log: header line is not valid JSON`，dsh-session-persistence-jsonl L968-990）；(c) 未知事件类型拒绝（`validateStoredEvents`，dsh-session-persistence）。全库仅有的 sha256 命中共 3 类，均与会话日志完整性无关：Windows 写锁名 hash（dsh-session-persistence-jsonl L558）、zstd 帧级 checksum（L1291/1320/1349，压缩帧内部校验）、attachment 内容寻址（dsh-attachment-local）。
- **应为**：删除 "与 SHA-256 结构校验"，改为 "与 seq 连续性、首行 header 结构及格式版本校验（`corrupt session log`）"。
- **证据**：grep "sha256"/"checksum"/"hash" 于 dsh-session*/dsh-session-persistence* 全库：仅上述 3 处无关命中；dsh-session/lib/index.js L453、dsh-session-persistence/lib/index.js `assertContiguous`/L940 区段 `validateStoredEvents`、dsh-session-persistence-jsonl/lib/index.js L968-990。

### [WRONG] DOC1 L108-110：workspace-changes 类型名与源码不符

- **现文**：`WorkspaceChanges：包含新增、修改、删除的文件清单；WorkspaceFileDiff：包含具体文件的修改 Diff 块（Hunks）`
- **问题**：@deepseek-ai 全库不存在名为 `WorkspaceChanges` 的类型。实际类型名（dsh-tool-cordis/lib/types/api-catalog.js 生成声明 + dsh-workspace-changes/lib/index.js `summary`/record 结构）为 `WorkspaceChangesSummary`（turn/cwd/files/total/added/deleted/snapshot，文件项为 `WorkspaceChangedFile`）与 `WorkspaceFileDiff`（{ kind:'text'|'oversized'|'binary'…, path, display, before, after, hunks, coarse }，api-catalog.js L8015-8016 存在）。
- **应为**：`WorkspaceChangesSummary`（含 `WorkspaceChangedFile[]` 清单）与 `WorkspaceFileDiff`（含 hunks）。
- **证据**：grep "WorkspaceChanges" 全库 0 命中独立类型（唯一前缀命中 api-catalog.js L7975-7976 `WorkspaceChangesSummary`、L8015-8016 `WorkspaceFileDiff`）；dsh-workspace-changes/lib/index.js `ctx.provide("workspaceChanges", { summary: (sessionId, seq) => …, diff: (sessionId, seq, index, signal) => … })`。

### [WRONG] DOC1 L113/L117/L119：示例使用不存在的 `agent/turn-end` 事件与错误解构

- **现文**：`ctx.on('agent/turn-end', async ({ sessionId, turnId }) => … ctx.workspaceChanges?.summary(sessionId, seq)…`
- **问题**：`agent/turn-end` 在 @deepseek-ai 全库 0 命中，不存在。真实轮次结束生命周期事件是 `agent/turn-stopping`，payload 为 `{ agent, turn, signal }`（无 sessionId/turnId 字段）：dsh-agent-loop/lib/index.js L999 `await this.dispatch.serial("agent/turn-stopping", { agent, turn, signal })`；dsh-scope/lib/invariant.js L21；dsh-tool-cordis api-catalog.js L3796-3798 签名 `'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal })`。会话侧 `turn/end` 事件数据是 `{ turn, reason: TurnEndReason }`（dsh-agent-preset-registry typert.host.js SessionEventMap；dsh-agent-loop L1027 `this.session.append("turn/end", …)` 载荷含 reason.kind）。`summary(sessionId, seq)` 签名本身正确（第二参为 workspace/changes 事件 seq），但示例整体不可运行。
- **应为**：`ctx.on('agent/turn-stopping', async ({ agent, turn }) => { const changes = ctx.workspaceChanges?.summary(agent.session.id, <workspace/changes 事件 seq>); … })`；或沿用 L29 提示经 `ctx.on('session/event')` 过滤 `turn/end`（载荷 {turn, reason}）。
- **证据**：grep "agent/turn-end" @deepseek-ai 全库 0 命中；dsh-agent-loop/lib/index.js L999；dsh-scope/lib/invariant.js L21；dsh-tool-cordis/lib/types/api-catalog.js L3796-3798；dsh-workspace-changes/lib/index.js `summary(sessionId, seq)`。

### [WRONG] DOC2 L74：`\x03` 代表 Ctrl+C 与实际中断机制不符

- **现文**：`向正在运行的终端写入 stdin（\x03 代表 Ctrl+C）`
- **问题**：dsh-terminal-bash 实现与官方 README 明确：中断/取消**绝不通过写入 `\x03` 模拟**，而是对前台进程组发送真实 `SIGINT`（`signalForeground("SIGINT")`，dsh-terminal-bash/lib/index.js L867；README.zh.md L105；startSend 的输入由 `text + (submit ? "\r" : "")` 拼成，L561-562，不含 \x03）。全库 grep "\x03" 仅 README 一处否定句。
- **应为**：删除 "（\x03 代表 Ctrl+C）"，改为 "中断/取消经 `signal(…, 'SIGINT')` 或发送取消路径对前台进程组投递真实 SIGINT（后端不通过写入 \x03 模拟）"。
- **证据**：dsh-terminal-bash/lib/index.js L867 `await this.terminal.signalForeground("SIGINT")`、beginSend L561-562；README.zh.md L105 `它绝不会通过写入 \x03 模拟中断`。

### [WRONG] DOC2 L101："任务写入在会话刷新边界才落盘" 与实现不符

- **现文**：`任务写入与送达回执在会话刷新边界才落盘`
- **问题**：任务创建/编辑的写入是即时持久化：`ScheduleService.create` 直接 `await domain.table("tasks").put(id, …)`（dsh-schedule/lib/index.js `async create`，写经 schedule domain → dsh-storage-domain 写链 → dsh-storage-json 原子写，不依赖 session/flush）。只有**投递（followup）**依赖 `session/flush`：`resolved.agent.followup(message); if (!await this.ctx.sessions.flush(resolved.agent.session)) throw`，flush 成功后才 commit 送达回执（commit deliveredAt/messageId）。“不保证恰好一次（崩溃在刷新前会重投或丢失）”方向正确。
- **应为**：`投递依赖 session/flush 确认：任务创建/编辑即时落盘于 schedule domain；投递（送达回执）在 flush 确认后才提交，因此不保证恰好一次（崩溃在刷新前会重投或丢失）`
- **证据**：dsh-schedule/lib/index.js `async create`（domain.table("tasks").put 后 `this.runtime?.requestDrive()`）、ScheduleRuntime.drive（followup → sessions.flush → commit）、`sessionPersistence is a load-order requirement … a delivery commits only when ctx.sessions.flush() reports …` JSDoc。

### [CONFLICT] DOC1 L29 内部自相矛盾 + 与 L113-119 示例互相矛盾

- **L29 现文**：`轮次结束没有 agent/turn-stopping（…）事件——用 ctx.on('session/event') 过滤 turn/end…，或监听 agent/turn-stopping`
- **问题**：同一句先断言"轮次结束没有 agent/turn-stopping 事件"，紧接着又提供"或监听 agent/turn-stopping"；且与 L113-119 示例使用的 `agent/turn-end`（不存在）共同构成事件名三重混乱。`agent/turn-stopping` 真实存在（见上 WRONG 项证据）。
- **应为**：`轮次结束的 agent 生命周期事件是 agent/turn-stopping（payload { agent, turn, signal }）；turn/end 是会话事件（载荷 {turn, reason}），可经 ctx.on('session/event') 过滤`
- **证据**：dsh-agent-loop/lib/index.js L999；dsh-scope/lib/invariant.js L21；dsh-tool-cordis/lib/types/api-catalog.js L3796-3798。

## 主体其余断言（33 条 OK，摘要）

- **DOC1**：ctx.systemPrompt 所属包/order 升序拼装（dsh-system-prompt SECTION_ORDERS -1000..10200、comparePromptSections a.order-b.order）；section() 的 name/order/text 字符串或函数；system-prompt/assemble 为 ctx.on 注册、瀑布签名 (assembly, context, next)、ctx.waterfall 是派发方法（dsh-system-prompt L355；cordis L317 waterfall / L371 on）；assembly { sections, contexts, tools, variables } 无 systemText；大写变量抛 malformed prompt variable reference（dsh-system-prompt L166）；JSONL 仅追加、事件永不改写；surfaceOp append 或 { op:'replace', startSeq, endSeq } 且裸字符串 'replace' 抛 invalid surfaceOp（dsh-session L290-306）；sessionProjections.register 六个字段（key/stateSchema/stateVersion 非负整数/init(header,inheritedEventCount)/apply/wire{viewSchema,view}）、watermark 缓存与变更通知（dsh-session-projection）。
- **DOC2**：ctx.storage.domain 为 hub form 访问器、业务走 ctx.storageDomain（dsh-storage L135、dsh-storage-domain apply provide("storageDomain")）；写路径无 zod 校验、open loadAll 才 parse、invalid-record/backup-and-skip、missing-key/closed；defineDomain({name,version,tables:domainTable(schema),global?})；spawn/read（offset 非负、count 默认 500、同步不阻塞，dsh-terminal-bash L585-588）/startSend/SEND_ACTIVE/signal/kill/list；rows 40/cols 160 属后端 Config；三检查点（llm/stream 前 flush、tools/execute 顶层前 flush（callSeq 由 append 的 event.seq 承担）、agent/pre-step flush，dsh-session-checkpoint-policy L61/66/72）；tornTruncateTo 截断 + recoveredTail 首次追加重放（dsh-session-persistence-jsonl L227-233、L2807/2993）；头损坏拒绝打开（L968-990）；schedule 四工具、storage domain "schedule" 表 tasks、MIN_EVERY_INTERVAL_SECONDS=60；JobRegistry 抽象直接构造抛错、注册名 jobs、dsh-tool-jobs 三工具（job_output 参数含 job_id/wait/timeout_ms，dsh-tool-jobs/lib/index.js）。
