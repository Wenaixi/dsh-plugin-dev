# g04 · references/tools.md 与 references/mcp-and-tools-bridge.md

核实基线：DSH 0.2.0-rc.2（asar 真源码 @deepseek-ai/* lib/*.js + desktop-runtime.json）+ 本机 desktop profile 运行时配置（cordis.patch.yml / package.json / node_modules）
核实时间：2026-10-04

## 结论概览

- 核实断言总数：44
- OK：33
- WRONG：5
- STALE：0
- CONFLICT：3
- UNVERIFIED：3

## 逐条报告

### [WRONG] tools.md L5：presentCall/presentResult 被描述为「阶段 2/16 的半边」，且把 run_code 的 presentCall 也算作阶段

- **现文**：`阶段 2（presentCall）与阶段 16 的 presentResult 半边并非调度器环节`（同段落还称「下文 16 环节」）
- **问题**：`presentCall`/`presentResult` 是工具定义上的**可选声明**（`defineTool` 打包为 `tool.presentCall/presentResult`，dsh-tools/lib/index.js:874/878），dsh-tools 的调度器**从不调用它们**（grep 全库零命中：dsh-tools 中 presentCall/presentResult 只出现在 844/845/874/878 的定义与 1445 的 run_code 声明）。它们既不是「调度器环节」，也不是「非调度器环节」——调度器根本不知道它们的存在；它们是 Host-local 消费者（文档站称 client 侧）的可选读取面。把 run_code 自带的 presentCall（1445）当作阶段的一半尤其牵强。
- **应为**：删去「阶段 2（presentCall）与阶段 16 的 presentResult 半边」的表述，改为一句独立说明：`presentCall/presentResult 是工具定义可选的纯渲染描述符（dsh-tools/lib/index.js:874/878 打包、1445 为 run_code 自带声明）；dsh-tools 调度器从不调用它们，属于 Host-local 消费者读取面（官方内置 Web Client 不消费，见 dsh-tools/README.md 第 91 行）`。若保留 16 环节编号，只标注阶段 8（FS Gate）为非调度器环节即可，并说明「16」是文档自定的讲解编号（已有）。
- **证据**：`dsh-tools/lib/index.js:844-845, 874-878, 1445`（只有定义与 run_code 声明）；`grep presentCall 全库 lib 目录：仅工具包自身的声明，无任何调度器调用`；`dsh-tools/README.md:91`（内置 Web Client 不消费这些值，经 tool.call.toolview 选渲染器）。

### [WRONG] tools.md L103：skill 工具「支持六级 rank 100-600 注入」

- **现文**：`| skill | @deepseek-ai/dsh-tool-skill | 载入技能指令规范（支持六级 rank 100-600 注入）|`
- **问题**：rank 档位源码是 100/200/250/300/400/500/600（`dsh-skill/lib/index.js:21 RUNTIME_RANK=250`、`dsh-skill-filesystem/lib/index.js:21-25 PROJECT_DSH=100/PROJECT_AGENTS=200/CUSTOM=300/USER_DSH=400/USER_AGENTS=500`、`dsh-skill/lib/index.js:23 BUNDLED_SKILL_RANK=600`），共 **7 档**而非六级。且 `dsh-tool-skill` 的 `skill` 工具本身不实现 rank 注入：rank 属于 `dsh-skill`（注册）与 `dsh-skill-filesystem`（目录档位）的领域，skill 工具只做按名加载与渲染（`dsh-tool-skill/lib/index.js:59-167`，无任何 rank 逻辑）。
- **应为**：删去括号内 rank 表述或改为 `（技能 rank 体系属 dsh-skill/dsh-skill-filesystem，档位 100/200/250/300/400/500/600，rank 小者胜，与本工具无关）`。
- **证据**：`dsh-skill-filesystem/lib/index.js:21-25`；`dsh-skill/lib/index.js:21-23`；`dsh-tool-skill/lib/index.js:59-167`（工具定义无 rank 引用）；rank 比较器 `dsh-skill/lib/index.js:520 left.candidate.rank - right.candidate.rank`（rank 小者胜，R19 已确认）。

### [WRONG] tools.md L104：subagent/subagent_fork 归属行「官方包源里没有独立工具，subagent_fork 是装配出的 toolName」

- **现文**：`…官方包源里没有独立工具，subagent_fork 是装配出的 toolName`
- **问题**：官方包源**有**默认工具——`dsh-tool-subagent` 的 Config 规定 `toolName: z.string().default(「subagent」)`（lib/index.js:254），`apply` 中 `mount()` 用 `name: toolName` 注册（lib/index.js:398-399）；`subagent_fork` 不是「没有独立工具」而是第二个装配实例（toolName 覆盖）。「官方包源里没有独立工具」表述自相矛盾（既然默认就是 subagent，包源就有该工具；只是名字可被装配覆盖）。
- **应为**：改为 `同一插件按 config.toolName 实例化多个工具（默认 toolName=subagent；本机注册 subagent=provider spawn 与 subagent_fork=provider fork，另有两个 disabled 实例）`。
- **证据**：`dsh-tool-subagent/lib/index.js:253-254`（toolName 默认 subagent）、`:398-399`（mount 以 toolName 注册）；desktop `cordis.patch.yml:148-176`（subagent/subagent_fork 实例 + subagent_codex/subagent_claude_code disabled）。

### [WRONG] tools.md L122-159：defineTool 示例的 parameters 与 output 形状不可运行

- **现文**：示例 `parameters: { type: 'object', properties: {…}, required: […] }`（L134-140），`output: { type: 'object', properties: {…} }`（L142-147）
- **问题**：DSH 的 `defineTool` 参数 DSL 是**简化属性映射**（`parameters: { text: {…} }`），官方 README 示例即 `path: { type: 'string', required: true }`（dsh-tools/README.md:44-47）。文档示例的 JSON Schema 形状编译即抛错：`compilePropertyMap` 把 `parameters` 的每个键当作 value schema，`'type'` 键的值是字符串 object，`isJsonSchemaRecord` 为假 → `authorError(parameters.type must be a value schema object)`（lib/index.js:601-603 + 618-648）。此外 `output` 缺 `render` 函数，即使编译通过也会在 `register` 被拒（`register` 要求 `output.render` 为函数，lib/index.js:2881）。
- **应为**：按官方 DSL 重写：`parameters: { text: { type: 'string', required: true, description: '…' } }`；`output: { schema: { type: 'object', properties: { hash: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.hash }] }`。
- **证据**：`dsh-tools/lib/index.js:848-849, 601-603, 618-648, 2881`；官方可运行示例 `dsh-tools/README.md:41-57`。

### [WRONG] tools.md L168-172：Object.freeze(exec) 被描述为「执行流水线第 14 阶段派发 tools/result 前…对当前调用的执行对象执行硬性冻结」

- **现文**：`在执行流水线第 14 阶段派发 tools/result 事件前，调度器会对当前调用的执行对象执行硬性冻结`
- **问题**：`Object.freeze(exec)` 是 `notifyResult` 的第一行（dsh-tools/lib/index.js:3410），而 `notifyResult` 在 `finishScheduledExecution` 中于 `applyFinalContent`（finalizeContent）**之后**才被调用（3382-3396）。所以冻结发生在「post-execute 与 finalizeContent 都已跑完」之后，而不是「第 14 阶段之前」；且按文档自编号，第 13 阶段 finalizeContent 之后才轮到第 14 阶段 tools/result——冻结发生时 finalizeContent 已执行，若读者理解为「在派发前、finalizeContent 前」就会与源码时序矛盾（finalizeContent 读取 exec 仍未被冻结；freeze 只影响 tools/result 观察者）。
- **应为**：改为 `在 finalizeContent 之后、派发 tools/result 前（notifyResult 入口第一行），调度器对 exec 执行 Object.freeze`，并说明冻结只约束观察者，不影响已完成的 finalizeContent/post-execute。
- **证据**：`dsh-tools/lib/index.js:3382-3396`（finishScheduledExecution：applyFinalContent 在 notifyResult 前）、`:3409-3410`（notifyResult 入口 `Object.freeze(exec)`）。

### [CONFLICT] tools.md L104 与 L116 自相矛盾

- **L104 现文**：`subagent, subagent_fork | …官方包源里没有独立工具，subagent_fork 是装配出的 toolName`
- **L116 现文**：`list_subagent_models | @deepseek-ai/dsh-tool-subagent | 列出可用的子代理 provider/model 路由（本机 tool-subagent 配置 modelSelectionSettings: true 时注册）`
- **应为**：L104 改为承认官方包源有默认工具（见上条 WRONG）；L116 表述成立（modelSelectionSettings 时注册，dsh-tool-subagent/lib/index.js:389、587），二者不再冲突。
- **证据**：`dsh-tool-subagent/lib/index.js:253-254, 398-399`（默认工具）；`:389`（modelSelectionPolicy 非空时 registerListSubagentModels）。

### [CONFLICT] tools.md L104 与 L105：list_agents 归属两行并存

- **L104 现文**：`spawn_teammate, send_message, list_agents, wait_agent, interrupt_agent, team_task_* | @deepseek-ai/dsh-experimental-tool-agent-team`
- **L105 现文**：`list_agents, send_message, interrupt_agent | @deepseek-ai/dsh-tool-subagent-control`
- **应为**：两行都是真实注册（agent-team 的 9 工具 + subagent-control 的 3 工具 + list-agents 子模块），但文档读者会误以为同名工具由两包各自注册。补充一行说明：`同名工具（send_message/list_agents/interrupt_agent）在 Agent Teams 装配下由 dsh-experimental-tool-agent-team 注册（作用域不同），普通委派场景由 dsh-tool-subagent-control（list_agents 经其 /list-agents 子模块）注册，二者互斥装配`。
- **证据**：`dsh-experimental-tool-agent-team/lib/index.js:243-459`（9 工具注册）；`dsh-tool-subagent-control/lib/types/list-agents.js:44`（list_agents）；desktop `cordis.patch.yml:146-147, 294-295, 435-436`（三处都挂 `tool-subagent-control/list-agents`）。

### [CONFLICT] tools.md L5 与 L21 环节计数自相矛盾

- **L5 现文**：`下文「16 环节」是本文档为讲解方便展开的编号`（并称阶段 2 与阶段 16 的非调度器半边 + 阶段 8 FS Gate = 3 个非调度器环节）
- **L21 现文**：`工具调用在宿主运行时的时序如下（13 个调度器/循环环节 + 3 个非调度器环节）`
- **应为**：统一口径。按源码，调度器真实环节是 pre-execute → serviceAsk(ask 时) → guard → tools/execute → body → post-execute → finalizeContent → tools/result（dsh-tools/README.md:105 官方管线即此 8 步），presentCall/presentResult 不属于调度器；建议 L21 改为 `（8 个调度器环节 + FS Gate 等工具内部行为；presentCall/presentResult 为 Host-local 可选声明，不计入时序）`，或保留自定编号但把「3 个非调度器环节」改为「2 个（阶段 2、16 若保留）+ 阶段 8 工具内部」。
- **证据**：`dsh-tools/README.md:105`（官方 8 步管线）；`dsh-tools/lib/index.js:3225-3273（pre-execute/ask/guard 顺序）、3331（tools/execute）、3504（post-execute）、3382-3396（finalizeContent→notifyResult）`。

### [UNVERIFIED] tools.md L113：web_search/web_fetch 归属与引擎

- **现文**：`web_search, web_fetch | @deepseek-ai/dsh-tool-web（执行经 ctx.web seam，官方引擎包 dsh-web-search-deepseek / dsh-web-fetch-http）`
- **证据**：工具归属与 seam 表述 OK（tool-web/lib/index.js:262/737；web seam 调用 ctx.web.search）。但「官方引擎包」的措辞：desktop profile 实际搜索提供者是 `@liustack/modsearch`（modsearch/cordis.patch.yml 把 searchProvider 指到 modsearch，dsh 侧 `web_search` 仍注册于 tool-web）。desktop profile 的 node_modules 不含 `dsh-web-search-deepseek`/`dsh-web-fetch-http` 物理目录（在 asar 内）；`fetch` 侧官方本地引擎 id 是 http（dsh-web-fetch-http/lib/index.js:422 LOCAL_FETCH_PROVIDER_ID=http）。「官方引擎包」作为 asar 发布物成立，但本机实际引擎是 modsearch —— 需人工确认该行是否应注明本机覆盖。

### [UNVERIFIED] tools.md L117：read_page 与 modsearch

- **证据**：read_page/x_search 由 `@liustack/modsearch`（非官方包）的 dsh/index.js:236/164 注册；该包经 desktop profile 的 `package.json dsh.profile.bundles` 装配（非 cordis.patch.yml insert），官方发布物（asar）中确实无此包。表述成立。「官方发布物无此包」属外部包事实，已用 desktop node_modules 实证。

### [UNVERIFIED] tools.md L114：spawn_teammate 本机已注册

- **证据**：agent-team 9 工具源码存在（dsh-experimental-tool-agent-team/lib/index.js:243-459），组合包 `dsh-experimental-agent-team-profile` 在 asar 与 desktop package.json bundles 均存在（package.json:8）。但「本机已注册」无法从 cordis.patch.yml 直接证实（patch 未显式列出 agent-team 行，装配由 bundle 层完成），运行时是否生效需 Host 日志确认。

## 附：OK 项关键证据（不逐条展开）

- 16 环节中的真实调度环节顺序全部 OK：pre-execute(allow/ask/deny/cancel 决策，waterfall 默认 allow，`dsh-tools/lib/index.js:3225`）→ serviceAsk（`3240-3262`，ask 转 approval；deny 时 guard 跳过，`3241`）→ guard 仅对 allow 执行（`3241`）→ tools/execute（`3331`，timeout policy 注册于 `dsh-tool-call-timeout-policy/lib/index.js:116-141`，TOOL_TIMEOUT 码 `:80`）→ body（`3310`）→ projectContent 在 post-execute 前（`finalizeScheduledExecution` 3361-3367；deny 也进入，`3243-3257` 的 post-result 路径 → `3125` finalizeScheduledExecution）→ post-execute（`3503-3532`，accept 替换 content/value、block 转 isError）→ materialize（`3591`）→ finalizeContent 恰好一次（`3382-3393`，仅返回 content）→ tools/result 同步广播（`3415-3426`，观察者故障隔离：同步抛错与异步 reject 都走 `ctx.logger.warn`，`3412-3414`，不中断交付）。
- serviceAsk 三条件降级 OK：无 approval 服务 → deny（reason requires approval (not yet supported)，`3439-3447`）；Agent-less → deny（`3448-3454`）；allowed-once 放行、rejected/cancelled/unavailable 三种 deny（`3463-3490`）。
- 归属表其余行 OK：run_code 属 dsh-tools（lib/index.js:898 RUN_CODE_NAME、1119-1451 createRunCodeTool）；bash/pwsh/fs/fs-search/todo/skill/goal/jobs/present/ask-user/ralph/cordis/schedule 四件套注册名全部按文档命中（逐包 grep 见取证记录）；`list_subagent_models` 注册条件 OK（dsh-tool-subagent/lib/index.js:389）；`exit_plan_mode` 属 dsh-plan-mode（lib/index.js:35）。
- defineTool 契约其余部分 OK：execute(args, exec) 形状（866-870）、exec.signal（createExecution 3131-3158、dispatchToolBody 3294-3319）、register 校验（2878-2887）。
- 观察者故障隔离代码块逐字一致（3415-3426 与文档 178-186 完全对应）。
- mcp-and-tools-bridge 全篇核心断言 OK：`mcp__<serverName>__<rawToolName>` 命名（dsh-mcp-client/lib/index.js:96-102）；双传输 streamable-http/stdio 且无 sse（:38-48 判别联合，:780-800 双 schema）；toolCallTimeoutMs 默认 60000（:765）；failOnStartupError 默认 false 且 true 时 apply 抛错（:489-492, :832）；reconnect 默认 enabled:true/initialDelayMs:500/maxDelayMs:30000/maxAttempts:10（:434-439）；serverName 正则（:767）；同一注册作用域内唯一（:811-821，owner=scopeOf(ctx)或 ctx.root）；超长/非法名追加 12 位 SHA-256（对 serverName+rawName 取摘要，:100-101）；工具经 ctx.tools.register 注册（:153）与 guard 协同（tools.md 第三节，dsh-tools/lib/index.js:2921）。
