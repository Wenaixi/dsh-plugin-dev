# g15 · references/subagents-fs-policy-and-acp.md、references/community-patterns.md、references/official-upstream-and-docs.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：60
- OK：52
- WRONG：2
- STALE：0
- CONFLICT：1
- UNVERIFIED：5

说明：以下编号中「SUB/COM/OF」分别指三份文档；行号以本机文件为准（subagents-fs-policy-and-acp.md 62 行、community-patterns.md 1063 行、official-upstream-and-docs.md 166 行）。

## 逐条报告

### [WRONG] SUB L15：ACP「不注册为 ctx.subagents 的 provider」成立，但补充句「客户端包 dsh-subagent-acp 未随 0.2.0-rc.2 发布集安装（asar 289 包中不存在）因此注册表中没有 ACP 提供方」归因错误

- **现文**：`客户端包 @deepseek-ai/dsh-subagent-acp 未随 0.2.0-rc.2 发布集安装（asar 289 包中不存在），因此注册表中没有 ACP 提供方`
- **问题**：第一个断言（发布集不存在该包）正确，但「因此注册表中没有 ACP 提供方」因果不成立——存在不代表注册：dsh-acp（lib/index.js，全文件 registerProvider 0 命中；对 subagents 仅 962 行 drainContinuableDescendants 消费）与 dsh-acp-app（仅 acp-app-startup 服务 + stdio 生命周期，lib/index.js:11-40）均**不注册**任何 SubagentProvider。且「没有 dsh-subagent-acp」本身也是陈述事实而非因果前提：即便包在，dsh-acp 的实现里也没有 registerProvider 调用。注册表没有 ACP 提供方的真因是 dsh-acp 未实现 SubagentProvider 接口（无 start/prepareContinuable 方法，grep dsh-acp 的 startContinuable/prepareContinuable 0 命中）。
- **应为**：`ACP（@deepseek-ai/dsh-acp + dsh-acp-app）不注册为 ctx.subagents 的 provider：dsh-acp 未实现 SubagentProvider 接口（无 registerProvider/start/prepareContinuable，仅经 drainContinuableDescendants 消费既有 continuable 子代理）；dsh-subagent-acp 包亦未随 0.2.0-rc.2 发布集安装（asar 289 包清单中不存在）`
- **证据**：`dsh-acp/lib/index.js`（registerProvider 0 命中、startContinuable 0 命中、prepareContinuable 0 命中，subagents 引用仅 962 行）；`dsh-acp-app/lib/index.js:11-40`；asar 289 包清单 grep 无 dsh-subagent-acp（含 acp 的包仅 dsh-acp、dsh-acp-app）

### [WRONG] COM L74（同 142/365 行内嵌）：agent/created 的 source 枚举在类型声明中为 `'startup'|'resume'|'clear'|'compact'`，但「clear」「compact」两个取值无任何驱动方（0.2.0 源码全库 announce 实参仅 "startup" 与 "resume"）

- **现文**：`agent/created（payload 恒带 source: 'startup'|'resume'|'clear'|'compact'，按 source 值判而非 'source' in payload）`
- **问题**：类型枚举正确（dsh-tool-cordis/lib/types/api-catalog.js:6792 `export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`，dsh-agent/lib/index.js:572-583 announce 发射 `{ agent, source, signal? }` 且 agent-loop/lib/index.js:1799/1867 publish("startup")、1970 setupAndPublish(...,"resume",...)），但「恒带 source」的驱动方不完整：0.2.0 全 @deepseek-ai lib 中 announce 实参只有 "startup"/"resume" 两个（grep "`compact`"/"`clear`" 作 announce 实参 0 命中；clear/compact 仅出现在无关语义，如 dsh-goal 的 operation:"clear"、dsh-session KNOWN 目录中无）。断言语义未指明「恒」指类型还是运行时值——若指运行时恒有，则 clear/compact 无驱动来源，属 STALE 边界。
- **应为**：`agent/created（payload 携带 source，类型为 'startup'|'resume'|'clear'|'compact'；0.2.0 运行时实际驱动方仅 startup 与 resume，clear/compact 属预留枚举；按 source 值判而非 'source' in payload）`
- **证据**：`dsh-agent/lib/index.js:572-583`；`dsh-agent-loop/lib/index.js:1799`、`1867`（"startup"）、`1970`（"resume"）；`dsh-tool-cordis/lib/types/api-catalog.js:6792`；全库 grep "`compact`"/"`clear`" 作 announce 实参 0 命中

### [CONFLICT] COM L74 与 COM L365：同一句「agent/session/created 是旧版事件名，0.2.0 全包 0 命中」在 L74（§2.1）与 L365（§11.19）重复且方向表述不自洽

- **L74 现文**：`（...SessionStartSource = 'startup'|'resume'|'clear'|'compact'）——agent/session/created 是旧版事件名，0.2.0 全包 0 命中`
- **L365 现文**：`（...payload 恒带 source: ...）——agent/session/created 是旧版事件名，0.2.0 全包 0 命中`
- **应为**：该句只在 2.1 出现一次（作为旧版事件名对照），§11.19 保留（payload 恒带 source...）并删除重复的「agent/session/created 是旧版事件名」尾巴；「0.2.0 全包 0 命中」本身成立（grep 全库 0 命中）不冲突，冲突点是同一句子在两条目重复且第二处无新增信息。
- **证据**：grep "agent/session/created" 全 @deepseek-ai lib 0 命中；COM L74 与 L365 原文对照

### [UNVERIFIED] COM L34：`62/86 份深度笔记提及`（patch 坑区出现率统计）

- 统计数为社区笔记汇总，源码无法验证；快照日期 2026-10-03，笔记底账不在本次可查范围，留 Lead 人工确认。

### [UNVERIFIED] COM L3：`topic:dsh-plugin 高星仓库（约 100 个）逐一分析`

- 高星数（约 100 个）与 L15 的「17306 个」自洽性无法从源码核验；GitHub 当前 topic 计数（2026-10-04 实测 GitHub API）为 17481，与 L15 的 17306 相差 175，时间差内增长属合理但非本次可验证的精确数。

### [UNVERIFIED] COM L15：`17306 个仓库里真正是 DSH 插件的不到两成`

- 实测 2026-10-04 GitHub topic:dsh-plugin total_count=17481，与 17306 有偏差（日期差），两成比例无法从源码核验。

### [UNVERIFIED] COM L74/142/365 括号尾部（三处相同句）：`agent/session/created 是旧版事件名`

- 旧版事件名引述正确（0.2.0 全包 0 命中已证），但「旧版」是否存在过属历史断言，无法从当前源码核验，留人工。

### [UNVERIFIED] COM L11.50/11.94（538 行与 734 行）：`Volatile<T> = { get(): T }` 与 `Symbol.for('cosmokit.volatile.write') 写口` 表述为「类型/实现」级断言

- 实现侧已证（cosmokit/lib/index.js:102-110 createVolatile 返回 Object.freeze({ get: () => current, [Symbol.for("cosmokit.volatile.write")]: ... })；isVolatile 83/116-118），但文档句子把「类型级无 .value 无 .ref」混入——tsc 产物无 .d.ts（全 289 包 .d.ts 0 命中），类型形状只能从 JSDoc 佐证，标记 UNVERIFIED 以防类型级误述。

## OK 项要点（52 条，不逐条展开）

- SUB 全部：L8 ctx.subagents 由 @deepseek-ai/dsh-subagent 提供（dsh-subagent/lib/index.js:2834 super(ctx,"subagents")）；L12 spawn 语义（dsh-subagent-spawn-in-process/lib/index.js:10-14、15-42，inheritsParentContext=false，start=startInProcessRun(request,{})）；L13 fork 语义（dsh-subagent-fork-in-process/lib/index.js:14-22、33，inheritsParentContext=true，seed=completedTurnPrefix）；L14 providerName 默认 spawn/fork（两包 Config z.object({providerName: z.string().default("spawn"/"fork")})）；L15 ACP JSON-RPC stdio（dsh-acp-app/lib/index.js:21 acpCommand name "dsh --profile acp" + PROFILE_TEMPLATES.acp=["@deepseek-ai/dsh-base","@deepseek-ai/dsh-acp-app"]）；L19 start 返回 { id, result, dispose }（dsh-subagent-in-process-driver/lib/index.js:218-228；dsh-subagent/lib/index.js:2651-2665 subprocessRunHandle）且工具层结果收集后 dispose（dsh-tool-subagent/lib/index.js:239、314-331 settleForegroundRun）；L20 startContinuable（dsh-subagent/lib/index.js:1671/2879）；L22 send_message/interrupt_agent 注册于 dsh-tool-subagent-control（lib/index.js:15、22-60、62-96），list_agents 独立入口 tool-subagent-list-agents（types/list-agents.js:11、43-133，exports ./list-agents），team 工具在 dsh-experimental-tool-agent-team（lib/index.js:243/296/323/332/367/446）；L28 三稳定错误码（FS_NOT_OBSERVED 于 dsh-fs-observation-policy/lib/index.js:60/67、dsh-fs-local 492/494/510/871；FS_STALE_VERSION 于 dsh-fs-local 869/870/886/888；FS_SANDBOX_DENIED 于 dsh-fs-sandbox 91/149/157/164；"stale observation" 全库 0 命中）；L30-43 弱引用表（dsh-fs-observation-policy 34-45 observed WeakMap + owner(actor)=actor?.agent?.session）、read-before-write（writeIntent/editIntent 55-70）、版本指纹复合值（dsh-fs-local/lib/index.js:146 `dev:ino:size:mtimeNs:ctimeNs`）、withLock 进程内 FIFO（dsh-fs-local 759-779）、createIfAbsent/replaceIfVersion（dsh-fs-observation-policy 44-49）、缺失 edit 报 FS_NOT_FOUND（64-66）——除 WRONG 项外全部成立。
- COM（自指官方性质句 + 统计数之外的社区经验默认不逐条判）：L8 快照日期（2026-10-03）；L15 「17306」见 UNVERIFIED；L34/71/92/115/136 「N/86 提及」统计数留人工（见 UNVERIFIED 之外默认不判）；L74/142/365 「agent/session/created 0 命中」成立；L75 「session.events 已移除」「Settings 无 register」「无 WEB_SERVER_KEYS」全成立（grep 0 命中；dsh-session 1363 eventAt deprecated、1389 ownEvents deprecated；dsh-settings register 0 命中；dsh-host-webserver 158 super(ctx,"webServer")）；L64-65 五段式 patchFrom/tombstones 全无（dsh-web-app 仅 cordis.patch.yml+presets/*.patch.yml，patchFrom/tombstones/aggregate 关键词 0 命中）；L103/104/527-529 信任围栏 isTrustedApiRequest 单级 + exact 表优先（dsh-client-connection/index.js:205-216、587；dsh-host-webserver 322-330；dsh-web-app/startup.js:40 "would expose remote code execution"）；L104 isTrustedRequest 0 命中（自纠对）；L110 wire 协议与 /capabilities；L121-122 __ModuleLoader__（dsh-client-modules/index.js:456-475）；L125-126 settings.section 槽（dsh-client-ui-settings-general 1000-1040 ctx.slots）；L139 KNOWN_SESSION_EVENT_TYPES + ignorable（dsh-session/lib/index.js:74-77 "event-name registration was rejected"、known-event-types.js:21-81）；L143 serial 不抛错/waterfall await next；L144 turnTail 槽；L148-153 sessionProjections 单元（dsh-session-projection/lib/index.js:68-81 register {key,stateSchema,init(header,inheritedEventCount),apply,wire?,stateVersion}）；L163 timeoutMs（dsh-tools 2883-2884）；L170-171 tool/ptc-dispatch 与 tool/code-dispatch（dsh-session known-event-types.js:73-74；tool/code-dispatch 0.1.2 及以前——现版本 v0-to-v1 迁移文件仍引用）；L173 ctx.tools.guard（dsh-tools 2646-2651 单调、3225 pre-execute 默认 allow、3241-3257 allow 后仍 guardReason）；L176 presentationMeta（dsh-tools 843-860、2881）；L189 ctx.get(name,false)；L193 mcp__ 命名空间（dsh-mcp-client 58-97）；L225 resolveDshHome（dsh-home-paths/index.js:73-76）；L380-387 registerProvider/list/get（dsh-skill-filesystem 115-133 get 形状、590-611 list 形状、source:"bundled" 183；dsh-skill 350 provider.list(options) + options.signal）；L389-394 !!js 引号（dsh-base/cordis.patch.yml:22/30/99/103 disabled: !!js "!ctx.get('profileContext')"）；L448 group 行 disabled 短路（cordis-plugin-loader Entry.get disabled 334-340 "if (this.options.group) return false"）；L536-539 Volatile（见 UNVERIFIED 说明，实现侧已证）；L559 OUTCOMES（dsh-user-approval/lib/index.js:30-35）；L560 tools/pre-execute 默认 allow（dsh-tools 3225）；L617-618 profileContext（dsh/profile-boot-BZ2ZjNWi.js:259-273 provide，installAnchor 为绝对路径 INSTALL_ANCHOR，无 version 字段）；L664-666 两动词 + store[id] ??=（cordis-plugin-loader EntryGroup.create 58-64；"duplicate loader entry" 0 命中）；L726-727 settings ns（dsh-settings 466/475/484 注释 "Profile entry id"、describe ns: entry.options.id 432/443）；L831-832 ctx.tools.execute 单对象签名（dsh-tool-cordis api-catalog execute(exec: ToolExecutionInput)）；L926-927 profileContext.installAnchor（同上）；L1061 approval.request fail-closed deny（dsh-tools serviceAsk 3439-3491 无 approval → deny、unavailable → deny；allowed-once 唯一 grant）；L1060 guard 单调（同上）；L1062 defineTool DSL spec → JSON Schema（dsh-tools 2878-2886 + assertSupportedJsonSchema；ParameterSchemaSpec/ValueSchemaSpec 0 命中但语义成立）；L1008-1010 rank 低者胜（dsh-skill compareIndexedCandidates 519-521 left.rank - right.rank 升序 + BUNDLED_SKILL_RANK=600 22-23）；L150 keyed slots 同 key 同 priority throw + 低 priority 胜出（dsh-client-ui-slots/lib/index.js:163-190 冲突即抛、221 升序排序、168 "lowest renders"）。
- OF 全部：L11 主仓库 URL（web_fetch 200）；L12 packages/README.md（200）；L13 module-graph.md（200）；L14 cordis-tutorial/index.md（200）；L15 subsystems/（200）；L17 类型声明（289 包 .d.ts 0 命中、全部 lib/types/*.js；dsh-credentials/lib/index.js:4-12 头部 "Service Definition for the credential-reference capability seam"）；L27/31/32/40-74 文档站全部 URL（逐一 web_fetch 200；中文版去 /en/ 也 200）；L84/89 全局安装本体路径（本机 C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai 存在，含 cordis、dsh-tools、dsh-session 等）；L85 Profile 本地路径（desktop/node_modules 存在且含 dsh-better-sidebar、dsh-plugin-wallpaper-engine）；L94-101 单包结构（lib/index.js + lib/types/*.js + README + package.json）；L105-115 身份判定注释 + declare module 形态（发布物内无 declare module——0 命中，但注释头部存在；inject 声明为导出 const 而非 package.json 字段：全库 package.json 含 inject 字段的包 0）；L127-135 三级证据 + 运行时最高（dsh-app-boot 3165-3176 generateConfigSchema "without mounting plugins"、2922-2923 "Expression results, service dependencies, plugin startup checks ... require runtime validation"）；L139 ctx.tools.schemas()；L141 ctx.get('服务名')；L149 dsh --version + compatibility.json（dsh-app-boot 328 PROFILE_COMPATIBILITY_FILENAME="compatibility.json"）；L151 读 lib/index.js + lib/types/*.js；L152 ctx.tools.schemas()/ctx.get；L153 回写本库；L161 前端章节（slots/settings/cookbook 页面均 200）；L162 settings.yaml → settings.yaml.imported（dsh-settings/lib/index.js:346-362 importLegacyDocument 350-351 rename(path, imported)）；L163 src/ 非发布产物（发布物仅 lib/）；L164 --dump-config 不加载插件（app-boot 3165-3176）；L165 ctx.agentLoop（dsh-agent-loop/lib/index.js:1552 super(ctx,"agentLoop")）。

## 备注

- 全部结论基于 asar 真源码（289 包）逐包 read/grep；外部链接仅用 web_fetch 核存在性（官方仓库/文档站/GitHub topic API）。
- 未修改任何被核实文档。
