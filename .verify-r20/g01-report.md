# g01 · SKILL.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：49
- OK：40
- WRONG：5
- STALE：1
- CONFLICT：1
- UNVERIFIED：2

## 逐条报告

### [WRONG] 文档 L241-245：场景 B 示例 guard 使用 exec.toolName，应为 exec.name

- **现文**：ctx.tools.guard((exec) => { if (exec.toolName === 'dangerous_tool') { return '安全策略阻断...' } })
- **问题**：exec 对象没有 toolName 字段。createExecution 构造的 execution 字段为 token/callId/rootCallId/name/signal/agent/parent/schema/deferContext/concludeTurn/arguments，工具名在 exec.name。
- **应为**：if (exec.name === 'dangerous_tool')
- **证据**：dsh-tools/lib/index.js:3143-3168（createExecution base 字段）；官方 guard 调用点 dsh-subagent-in-process-driver/lib/index.js:85（exec.name）。

### [WRONG] 文档 L41（第 5 条流水线）：presentCall/presentResult 被列为 16 环节之一，但源码没有执行调用点

- **现文**：流水线含 tool/result (持久化) -> presentResult，且整条 16 环节 = 13 调度器 + 3 非调度器
- **问题**：源码里 presentCall/presentResult 只有定义（defineTool wrapper 与各工具包），没有宿主调度器调用它们；notifyResult 只 dispatch tools/result。卡片渲染在 client 端由各 toolview 直接读 event 数据，不走 presentCall 函数。
- **应为**：把 presentCall/presentResult 从「执行流水线环节」中移除（它们是展示意图声明，供 UI/CLI 渲染参考，不参与执行顺序），或将 16 环节改述为不含 presentResult 的 15 环节。
- **证据**：dsh-tools/lib/index.js:3409-3427（notifyResult 只 emit tools/result）；全 asar 递归 grep 只找到定义点，无 .presentCall( 调用点；dsh-tools/lib/types/presentation.js:1-6（注释明言是 render intent 声明）。

### [WRONG] 文档 L97：第四-1 说检查 ~/.dsh/profiles/<profile>/cfg.err，该文件不存在

- **现文**：立即检查 ~/.dsh/profiles/<profile>/cfg.err
- **问题**：全 asar（含 Electron main.js、dsh-web-frontend bundle）与 desktop profile 目录对 cfg.err 零命中。启动失败的诊断链路是：CLI 走 stderr + StartupError；桌面走 IPC fatal + Electron app.getPath('logs') 下 crash-*.log（writeCrashReport）。
- **应为**：改为「检查启动日志（桌面端：app.getPath('logs') 下 crash-*.log；CLI：stderr / .plugin-manager/logs）」，或直接删掉该文件名。
- **证据**：dsh-app-boot/lib/index.js:3864-3867（StartupError.startup 只在内存携带，不写盘）；E:/newCC/APP/dsh/resources/app.asar/lib/main.js:7609-7715（crash-*.log 落盘 app.getPath('logs')）；desktop profile 目录实际文件清单无 cfg.err。

### [WRONG] 文档 L262：双面插件示例 package.json 含 dsh.bundle.id，该字段无任何消费方

- **现文**："dsh": { "bundle": { "id": "custom-ui" }, "client": {...} }
- **问题**：官方 bundle 声明只读 dsh.bundle.patch；dsh.bundle.id 在全 asar 零读取（唯一近似命中是 plugin-manager 的 row.id，是 entry id 不是 bundle id）。示例是双面 UI 插件，本就不该带 bundle 段（bundle 是组合包语义）。
- **应为**：删除 "bundle": { "id": "custom-ui" }，只保留 "client": { "platform": "web", "inject": [...] }。
- **证据**：dsh-app-boot/lib/index.js:496-508（bundlePatchFiles 只读 patch）、:928-933（bundle 声明必须含 patch）；官方 bundle 包 package.json（dsh-base/dsh-web-app/dsh-experimental-agent-team-profile 等）全部只有 dsh.bundle.patch。

### [WRONG] 文档 L168（场景 H）：「使用 agent_team 系列工具」名不存在

- **现文**：Agent Teams 架构：消费 ctx.agentTeams，使用 agent_team 系列工具
- **问题**：官方工具名是 team_task_create / team_task_list / team_task_get / team_task_update / team:policy，全库无 agent_team 前缀工具。
- **应为**：改为「使用 team_task_* 系列工具」。
- **证据**：dsh-experimental-tool-agent-team/lib/index.js:238-459。

### [STALE] 文档 L262：示例 dsh.client.inject 把 primitives 列为 inject 值，字段用法与官方语义不符

- **现文**："client": { "inject": ["@deepseek-ai/dsh-client-ui-primitives"] }
- **问题**：官方 dsh.client.inject 的语义是「运行时依赖需先抵达」（dsh.client.inject 生成模块图边并 arrive 依赖）；官方 UI 包 inject 的是 remotes/locale 等运行时服务，primitives 只是被 require 的 seed/静态模块，从不进 inject。示例照抄会把 primitives 当作需先抵达的动态模块。
- **应为**：从示例 inject 中移除 primitives（客户端代码直接 require 它即可）。
- **证据**：dsh-client-modules/lib/index.js:713-727（inject 进 meta 并生成图边）；dsh-client-modules/lib/client.js:643-660（arriveGraphRow 对 inject 做依赖 arrive，未注册即抛错）；官方 dsh-client-ui-plan package.json dsh.client.inject 无 primitives。

### [CONFLICT] 文档 L27 与 L26：ctx.agentLoop 既被说成「唯一的具体循环包（bundle）」，又与它是挂载 Service 的事实冲突

- **L27 现文**：ctx.agentLoop 是唯一的具体循环包（bundle）
- **问题**：agentLoop 是挂载的 Service（super(ctx,"agentLoop")），不是 bundle 名也不是「包」；「唯一的具体循环包」表述与它作为 ctx 服务的事实冲突（且 dsh-agent 也有 AgentRegistry 服务，循环由 dsh-agent-loop 提供，不是「唯一包」）。
- **应为**：把 L27 改为「ctx.agentLoop 由 dsh-agent-loop 提供（super(ctx,'agentLoop')），扩展插件通过 @deepseek-ai/dsh-agent-loop 的 AgentLoop 服务挂载点接入」，删除「唯一的具体循环包」措辞。
- **证据**：dsh-agent-loop/lib/index.js:1552（super(ctx, "agentLoop")）。

### [UNVERIFIED] 文档 L363：Playwright 段「DSH 自带的 Playwright 不含浏览器二进制」

- 本机 profile 无 playwright 包；该断言指向运行时外部行为，源码零命中，需人工在真实安装中确认。

### [UNVERIFIED] 文档 L371-375：`--dump-config` 退出码 0 只代表 YAML 语法合规、不加载插件代码

- dump-config 实现不 boot、不 evaluate !!js、不 import 插件代码（只 compose 补丁层并 render），断言成立；但「只代表 YAML 语法合规」的措辞与源码「连 YAML 语法都可能没验证、只做条目结构组合」略偏差，已按源码核到 runDumpConfig 只调 prepareProfile + collectConfigDumpLayers + renderConfigDump，且默认不解析 profile 用户层（defaultOnly）。保留为 UNVERIFIED 边界说明。

## 其它重点核实（OK 项摘要）

- 服务单复数：6 复数（sessions/agents/agentTeams/tools/settings/clientModules）+ 6 单数（systemPrompt/configEditor/schedule/planMode/workspaceRegistry/llm）全部与各包 super(ctx,name)/provide 一一对应。
- 五大事件派发：cordis EventsService emit/parallel/serial/bail/waterfall 语义与 L31-33 描述一致（isBailed = 非 null/false/undefined；waterfall 环绕；parallel allSettled 后 throw AggregateError）。
- 配置补丁：applyEntryPatches 对 config 直接 target[key]=value 整块替换（非深合并）；四层顺序 = bundle layers -> profile -> home -> CLI overlays（L1024-1033）；settings.yaml.imported 重命名真实（dsh-settings L348-351）。
- 流水线（除 presentResult 环节外）：approval(serviceAsk) 先于 guard、projectContent 先于 post-execute、finalizeContent 先于 notifyResult、tools/result 同步 emit、tool/result 持久化在 agent-loop appendToolResult、FS Gate 在工具 execute 内部（fs/write-intent waterfall）——均与 L41 顺序一致。
- defineTool 字段：name/description/parameters（属性必填 true 语法）/output（schema+render+presentationMeta）/execute(_args,exec)（官方示例同为两个形参）与 L224-237 一致；exec.signal.aborted 存在（createExecution base.signal）。
- ctx.tools.register/guard 存在（register L2878、guard L2921）。
- __ModuleLoader__.load({id,factory}) 签名与 CJS factory 形态完全一致（client-modules client.js 官方 bundle 即为同形态）。
- 双面插件 exports["./client"] 与 exports["./package.json"]/locale 放行真实（readPluginMeta 走 Node ESM resolver，未放行抛 ERR_PACKAGE_PATH_NOT_EXPORTED，L1892-1895）。
- frontmatter：name/description 必须为非空字符串，SKILL.md 的 frontmatter 合法。
- 第九节 12 条：node --check / npm pack --dry-run --json / readPluginMeta / style[data-plugin-css]（client 端数十处使用）/ aria-disabled（client 端 10 包使用）/ 两帧一致（UI 段）/ repository.url git+https（npm publish 规范化告警，docs 层）——全部有源码或官方文档依据。
- 场景矩阵 26 行推荐形态/服务/文档名全部与包存在性对应（含 mcp__ 前缀、webhookRuntime、team_task_*、schedule_create 等）。