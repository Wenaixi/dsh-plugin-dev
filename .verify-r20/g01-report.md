# g01 · SKILL.md

核实基线：DSH 0.2.0-rc.2（asar 真源码 @ E:/newCC/APP/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai/）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：63
- OK：57
- WRONG：2
- STALE：2
- CONFLICT：0
- UNVERIFIED：2

## 说明：本次核实的盘面与任务快照差异

任务消息附带的 SKILL.md 快照为 431 行；实际盘面为 433 行，且 L262（dsh.bundle.id 示例）与 L97/L70（cfg.err）已被并行修正为正确形态。本报告以**当期盘面**为准，已修正项不再列入 WRONG/CONFLICT，仅在摘要中标注。

## 逐条报告

### [WRONG] 文档 L289：slots.register 的 options 缺 name，必抛错

- **现文**：`ctx.slots.register({ id: 'custom-panel', title: '扩展面板' }, CustomWidget)`
- **问题**：SlotsCore.register(options, component) 第一步即 `this.records.get(options.name)`，name 为 undefined → rec 为 undefined → 抛 `slot "undefined" is not declared`。真实注册（dsh-client-ui-sidebar-files:1003-1004）都是 `inject(key, () => register({ name: key, id, ... }, Component))`，name 必须等于被注入的插槽键。
- **应为**：`ctx.slots.register({ name: 'sidebar.right.pane.tab', id: 'custom-panel', title: '扩展面板' }, CustomWidget)`
- **证据**：`dsh-client-ui-slots/lib/index.js:163-165`；对照 `dsh-client-ui-sidebar-files/lib/client.js:1003-1004`。

### [WRONG] 场景矩阵 L168 场景 H：不存在 "agent_team 系列工具"

- **现文**：`Agent Teams 架构：消费 ctx.agentTeams，使用 agent_team 系列工具`
- **问题**：dsh-experimental-tool-agent-team 注册的工具名无 agent_team 前缀：spawn_teammate、send_message、list_agents、wait_agent、interrupt_agent、team_task_create、team_task_list、team_task_get、team_task_update。`grep "agent_team" 全库 0 命中`。
- **应为**：使用 `spawn_teammate / send_message / team_task_*` 系列工具（来自 @deepseek-ai/dsh-experimental-tool-agent-team）。
- **证据**：`dsh-experimental-tool-agent-team/lib/index.js:238-459`（name 字段逐行，无 agent_team 前缀）。

### [STALE] L13 与 L115：指引读者查验 lib/index.d.ts，但该文件不存在

- **L13 现文**：`本地已安装官方包的 lib/index.d.ts / lib/index.js 源码与类型声明`
- **L115 现文**：`本地 lib/index.d.ts 与 lib/index.js`（证据强度表"最强"行）
- **问题**：实测 @deepseek-ai 包 lib 下 `.d.ts` 文件数为 0（前 400 包 474 个 .js、0 个 .d.ts；lib/types 下同样 0 个 .d.ts）。package.json 的 types 字段指向不存在的文件（如 dsh-tools types: lib/types/index.d.ts，实际目录只有 .js）。
- **应为**：改为 `本地 lib/*.js 实现 + JSDoc 注释`（lib/types/*.d.ts 多数不存在）。
- **证据**：`dsh-tools/package.json` types 字段 vs `dsh-tools/lib/types/` 目录（无任何 .d.ts）；目录扫描统计 `.d.ts: 0`。

### [UNVERIFIED] L41 流水线中 presentCall / presentResult / FS Gate 三环节

- **现文**：`... presentCall -> ... 工具 execute(主体) -> FS Gate -> ... tools/result (同步) -> tool/result (持久化) -> presentResult`
- **问题**：dsh-tools 主路径（lib/index.js:3116-3397）内无任何 `presentCall`/`presentResult` 调用：二者仅出现在 defineTool 定义（:838-887、:874-881）与 ToolDefinition 类型契约（api-catalog:7532），@deepseek-ai 全库 50 处出现中 44 处定义、6 处类型/注释，零消费调用。FS Gate 在 dsh-tools 内零命中，实现在沙箱/观测层（dsh-fs-observation-policy、dsh-sandbox-policy）。
- **应为**：保留教学表述但标注来源层：presentCall/presentResult 属 UI 展示契约（ToolCallView/ToolResultView，dsh-tools/lib/types/presentation.js），FS Gate 属沙箱观测层；三者均不在 dsh-tools 调度器主路径。
- **证据**：`dsh-tools/lib/index.js:3116-3397` 全文无 presentCall/presentResult 调用；`grep presentCall 全库 50 处，消费零`；`grep "fs.?gate|fileSystem" dsh-tools 零命中`。

### [UNVERIFIED] L40 与 L66：16 环节 = 13 调度器 + 3 非调度器的环节计数

- **现文**：`讲解拆为 16 个编号环节 = 13 个调度器环节 + 3 个非调度器环节`
- **问题**：dsh-tools 源码可数出的调度器阶段约 12-13 个（pre-execute → approval/serviceAsk → guardReason → tools/execute 环绕 → dispatchToolBody → normalizeDispatchResult → projectContent → tools/post-execute → materializeFinalResult → applyFinalContent → notifyResult(tools/result)），无法唯一对应文档的 13+3 拆分；presentCall、FS Gate、presentResult 三环节不在 dsh-tools 主路径（见上条）。
- **应为**：在 tools.md 中给出逐阶段的源码行号对照表（dsh-tools/lib/index.js:3214-3397），并说明 presentCall/presentResult/FS Gate 归属层；不要写死"13+3"这类无法由源码唯一验证的计数。
- **证据**：`dsh-tools/lib/index.js:3116-3397` 阶段序列实测。

## 已修复项（对应任务快照，当前盘面正确，无需再改）

- 任务快照 L262 `"bundle": { "id": "custom-ui" }`：当前盘面已删除 bundle.id，且 L267 注记"不存在 dsh.bundle.id/dsh.client.module 字段"——与源码一致（dsh-app-boot bundlePatchFiles 只读 bundle.patch，dsh-app-boot/lib/index.js:495-499）。
- 任务快照 L97 `~/.dsh/profiles/<profile>/cfg.err`：当前盘面已改为 `~/.dsh/logs/startup-*.log` 且注明"profile 目录下没有 cfg.err"——与源码一致（dsh/lib/bin.js:151、178-179：`startup-${ISO}-${uuid}.log` 于 DSH_HOME/logs；全库 `grep cfg.err 0 命中`）。
- 任务快照 L70 `检查控制台 window.__DSH_BOOT__ 与 cfg.err`：当前盘面已改为"window.__DSH_BOOT__ 与宿主启动日志（$DSH_HOME/logs/）"——同样与源码一致。

## 其余断言判定摘要（OK，不逐条展开）

- L2-3 frontmatter name/description：dsh-skill-filesystem 解析器要求 name+description 非空且 name 匹配 kebab-case（parseSkillFile；SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/），`dsh-plugin-dev` 与长 description 合法。
- L25-26 核心服务单复数：复数 sessions/agents/agentTeams/tools/settings/clientModules、单数 systemPrompt/configEditor/schedule/planMode/workspaceRegistry/llm 全部与 Service 构造第二参一致（dsh-session:1621 / dsh-agent:332 / dsh-experimental-agent-team:1704 / dsh-tools:2704 / dsh-settings:330 / dsh-client-modules:526 / dsh-system-prompt:213 / dsh-config-editor:20 / dsh-schedule:2614 / dsh-plan-mode:149 / dsh-workspace:374 / dsh-llm:1801）。
- L27 agentLoop 唯一具体循环包：dsh-agent-loop super(ctx,"agentLoop")（:1552）。L28 dsh-scope 纯函数库：只导出 NamedEntries/AnonymousEntries/ScopedLayers/bindScopeParent 等，无 Service。
- L31-33 事件语义：emit 同步 void；waterfall 环绕 + next 短路；parallel 用 Promise.allSettled → Promise<void>（错误聚合 AggregateError）；serial/bail 遇 isBailed（非 null/false/undefined）短路（cordis/src/events.ts）。
- L36-38 配置四层顺序（bundle patch → profile patch → 用户全局 patch → CLI overlays）与 config 整块替换、settings.yaml 废弃重命名（dsh-app-boot/lib/index.js:1023-1033；applyEntryPatches target[key]=value；dsh-settings/lib/index.js:350-351）。
- L42 审批先于守卫：prepareExecution 中 serviceAsk 在 guardReason 之前（dsh-tools/lib/index.js:3226、3241）。
- L62 dsh.bundle.patch 与 dsh.client.platform 校验（dsh-client-modules/lib/client.js:65-68；dsh-app-boot:496-497）。L67 ctx.credentials：dsh-credentials super(ctx,"credentials")（:110）。
- L74 --dump-config 不加载插件代码：boot 注释（:966-967、:984-992）。
- L86 扁平数组零 Shell：validateSubprocessSpec 要求 argv[0] 程序 + argv 数组（dsh-subprocess-local/lib/runner-launch-B2zsQ1Dz.js:764-771）。
- L88 allow-version 命令形态：dsh/lib/plugin-BGnVfe_D.js:8-48 完全一致（含 --dsh-version、usage 提示）。
- L70/L97 宿主日志路径：`startup-*.log` 于 DSH_HOME/logs（bin.js:178-179）——与当前盘面一致。
- L161-193 场景矩阵：34 个 references/*.md 全部存在（缺失 0）；场景 A-Z 的服务名与推荐形态逐一核对（defineTool/Service/tracker、LlmAdapter stream→ctx.llm、ctx.schedule、ctx.agentTeams、settings.section、sidebar.right.pane.tab、conversation.input.*、ctx.remote、mcp__<server>__<name>、sessionProjections（ctx.sessionProjections.register 证实）、present 与 ask_user_question、webhookRuntime、repeat-tool-reminder+time-context、ctx.storageDomain、ctx.terminals、ctx.commands、ctx.subagents.startContinuable、.plugin-manager/logs（dsh-plugin-manager/lib/index.js:441/973）、SkillProvider list/get/registerProvider/rank 小者胜（skill/lib/index.js:520 compareIndexedCandidates 升序）/complete:false/invocation.modelInvocable+userInvocable）。
- L218-246 defineTool 示例：name/description/parameters{type,properties}/output{type,properties}/execute(args,exec)（源码 execute(args, exec)，dsh-tools:866-870）；exec.signal.aborted（ToolExecutionInput.signal: AbortSignal）；ctx.tools.register(definition)（:2878）；ctx.tools.guard(exec)（:2921，返回 string 即拒）。
- L252-267 双面 package.json：type module / main lib/index.js / exports {".","./client"} / dsh.client.platform web / inject，与 dsh-client-locale 等真实双面包一致；bundle.id 已移除（见已修复项）。
- L272-297 CJS factory（window.__ModuleLoader__.load({id, factory})）与 dsh-client-modules/lib/client.js:1-31 逐字一致（var module={exports:{}}、Symbol.toStringTag、return module.exports）；ESM import/顶层 return/JSX 禁限同源注释（:16-23）。
- L300 primitives 组件清单：Button/Switch/SegmentedControl/Pill/Tag/StateDot/Input/Checkbox/Menu/Tooltip/Modal/Toast/DisclosureRow/SettingsForm/MarkdownText/CodeBlock/DiffBlock 全部存在于导出列表（dsh-client-ui-primitives/lib/index.js export）。
- L310-322 七之二 token/Cookie：launchToken 进 URL query + 303 + set-cookie（dsh-client-connection/lib/index.js:374-408）；GET /api/* 需 cookie（isAuthenticated）。
- L326-336 Playwright：playwright 仅 dsh-web-frontend devDependency（^1.49.0），不含浏览器二进制语义成立；domcontentloaded 指引合理。
- L375-384 --dump-config 退出码只表 YAML 合规（boot:30/50）；allow-version 命令与 pnpm 冷却期（外部行为）。
- L392 webServer.register 属性 handler：route.handler(req,res)（dsh-host-webserver/lib/index.js:235）；L393 readPluginMeta：dsh-app-boot:1969。
- L397 style[data-plugin-css]：dsh-client-locale/lib/client.js:1029 等真实查询。
- L427 body[data-ds-dark-theme]：dsh-client-ui-layout/lib/client.js:499 DARK_ATTRIBUTE。
- L429 aria-disabled：client-ui 组件大量使用（如 dsh-client-ui-settings-account/lib/client.js:3602）。
- L420-433 交付清单：node --check / npm pack --dry-run --json / readPluginMeta 非 undefined / icon <=256KiB / 带条件导出 exports 取 default（dsh-client-modules clientExportOf :170-180 接受 string 与含 default 的对象）/ repository.url git+https 规范化 —— 全部成立。