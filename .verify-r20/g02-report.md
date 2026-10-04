# g02 · 入口层与索引（README.md + references/README.md）

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：24
- OK：17
- WRONG：1
- STALE：0
- CONFLICT：3
- UNVERIFIED：3

## 逐条报告

### [WRONG] README L34：`parallel` 也「遇到首个 bail 值短路」

- **现文**：`parallel`/`serial`/`bail` 都在遇到首个 bail 值（非 null/false/undefined）时短路
- **问题**：cordis 源码 `parallel` 是 `Promise.allSettled` 等全部 settle 后汇总 `AggregateError`，完全不读返回值的 bail 判定；`isBailed` 只出现在 `serial`/`bail` 的调度循环
- **应为**：`emit` 同步广播返回 void；`waterfall` 同步环绕中间件（不调 next 即短路）；`serial`/`bail` 遇首个 bail 值（非 null/false/undefined）短路；`parallel` 并发等全部 settle 后返回 `Promise<void>`（失败汇总抛 `AggregateError`）
- **证据**：`cordis/lib/index.js` `parallel(...args)` 实现（allSettled+AggregateError）与 `serial`/`bail` 各自 `isBailed` 循环

### [CONFLICT] README L34 与 references/README.md L32 的 parallel 语义互相矛盾

- **L34 现文**：`parallel`/`serial`/`bail` 都在遇到首个 bail 值时短路（错）
- **L32 现文**：`parallel` 并发与 `AggregateError`、`serial` 串行短路与 bail 判定（对）
- **应为**：统一为「parallel 并发等全部 settle、失败抛 AggregateError；仅 serial/bail 遇 bail 值短路」
- **证据**：同上 cordis/lib/index.js parallel 实现

### [CONFLICT] references/README.md L107 与 community-patterns.md L8-9 的快照口径矛盾

- **L107 现文**：`由 GitHub topic:dsh-plugin 高星仓库（约 100 个，2026-10 快照）逐一分析蒸馏的`
- **L8-9 现文**：`最近一次快照`（占位，不写死）
- **应为**：索引与正文统一为占位口径，删「约 100 个、2026-10」具体数（R20 通用性重构「删第三方点名与本机版本/日期快照」的漏改残留）
- **证据**：community-patterns.md L3-9 与索引 L107 对照；CLAUDE.md 第八节 R20 校准记录

### [CONFLICT] references/README.md L48 的 Worker 术语与三角色避让口径矛盾

- **L48 现文**：`Browser / Host / Worker 三角色物理隔离模型`
- **避让口径**：README L46 与 three-roles.md L3/L46 均为「隔离进程（源码中 Worker 专指 worker_threads）」
- **应为**：L48 改「Browser / Host / 隔离进程」
- **证据**：three-roles.md L3、L46；R19 三轮校准记录（Worker 术语避让）

### [UNVERIFIED] README L9：Node.js 徽章 `>=18` 无源码依据

- **现文**：`Node.js-%3E%3D18`（Node >=18）
- **问题**：285 个官方包仅 3 个声明 engines，全部高于 18（libreoffice-kit 系 `>=22.19.0`、node-addon-system `>=20`）；dsh 元包无 engines。源码未直接否定 18，但无任何书面依据支持徽章值；需人工确认基线（建议改为 `>=20` 或删除徽章）
- **证据**：全量 285 包 package.json engines 统计（3 命中）；`@deepseek-ai/dsh/package.json` 无 engines

### [UNVERIFIED] packaging.md L101/L113：命令示例仍用 `web` 具体 profile 名

- **现文**：`dsh plugin --profile web add dsh-my-feature`、`dsh plugin --profile web add ./hello-plugin-0.1.0.tgz`
- **问题**：README L65-66 已改 `<profile>` 占位；packaging 示例用官方内置 profile 名 `web`（可运行，但与占位口径不一），属低严重性统一问题
- **应为**：改 `<profile>` 或保留 web 并注明示例
- **证据**：README L66 vs packaging.md L101/L113

### [UNVERIFIED] references/README.md L13：上游仓库 URL 与包清单指向

- **现文**：`deepseek-ai/deepseek-harness` 主仓库与 packages/README.md 索引
- **问题**：URL 语义与 git remote 证据一致，但按手册禁止事项未 web 逐页核验存在性，标 UNVERIFIED 供人工确认
- **证据**：本机 git remote origin=https://github.com/Wenaixi/dsh-plugin-dev.git（本库镜像关系）

## OK 项（摘要）

1. references/README.md 索引 33/33 文件名真实存在、链接目标 OK（章节一~十八、九之二/九之三全部条目）；references/ 目录 .md 实 33 篇专题 + 索引 = 34 个 .md
2. README L54「33 篇专题，按 20 个分类导航」准确（索引实际 20 个 H2/H3 标题）；「15 主题」旧说法已清除无残留
3. 徽章 DSH 0.2.0-rc.2 / Cordis 4.0.4 与 asar 实测一致（dsh v0.2.0-rc.2、cordis v4.0.4）；README/索引/SKILL 版本号互不矛盾
4. 快速开始三命令与 bin.js 实测一致：`dsh plugin --profile <profile> add`（plugin 必带 --profile）✓、`dsh --profile <profile> --dump-config` ✓、`dsh web` ✓；与 SKILL.md L70/L74 用法一致
5. 核心大动脉：sessions/agents/agentTeams/tools 复数 ✓（super(ctx,"sessions") 等）；systemPrompt/configEditor/schedule/planMode/llm 单数 ✓；agentLoop 为 bundle（dsh-agent-loop）✓；ctx.terminals 复数 ✓
6. settings.yaml 废弃说法 ✓：dsh-settings 启动 rename 为 `settings.yaml.imported`，路径 `$DSH_HOME/settings.yaml`（profileContext.home=resolveDshHome()）与 README L35/SKILL L38 一致
7. 三角色表 Browser/Host/隔离进程与 three-roles.md 教学名一致 ✓；Native Runner、bwrap/Landlock/Seatbelt/Windows ACL、WRITE_RESTRICTED/DACL 全部源码命中（dsh-subprocess-local、dsh-sandbox-local PLATFORM_CHAINS、dsh-sandbox-windows-acl）
8. 事件断言：isBailed（非 null/false/undefined）✓；`agent/turn-end` 0 命中、`agent/turn-stopping` 存在 ✓；5 类 SurfaceEventType ✓；KNOWN_SESSION_EVENT_TYPES 实测 60 个（口径已按 R19/R20 校准）
9. 全库死链：README 5 个相对链接全 OK；references/README.md 33 个相对链接全 OK；LICENSE/CONTRIBUTING.md/SKILL.md/.github/workflows/ci.yml 均存在
10. 伪字段：`dsh.bundle.id`/`dsh.client.module` 官方包 lib 0 命中 ✓；dsh.client.platform/inject/external/immediately 与 dsh-client-modules 校验一致 ✓；bundleManifest 仅 dsh-plugin-manager 导出 ✓
11. 索引点名关键包/服务全命中：webhookRuntime、subagents、userQuestions、locale(register/subscribe)、commands(register)、slots、skills(notifyChange/invalidate/registerProvider)、storage.domain、terminals、shortcuts、repeat-tool-reminder、time-context、message-feedback、dsh-invariants、dsh-http-proxy、dsh-workflow-ptc 均存在
12. StreamChunk 7 种判别联合与 llm-adapter.md 表格逐字段一致 ✓
13. PTC 配额默认值：maxOldGenerationSizeMb(512)/maxOutputBytes(64MB)/maxPendingCalls(128)/timeoutMs(120s) 在 dsh-ptc-runtime-node Config ✓
14. readPluginMeta 行为、256 KiB 图标上限、exports 子路径放行（./package.json + ./locale/*.json）与 settings-and-plugin-ui 描述一致 ✓
15. `--dump-config` 假阳性与三步真实启动验收（config.md L98-111）与源码一致 ✓
16. pnpm 冷却期：desktop profile pnpm-workspace.yaml 注释实测「pnpm v11+ defaults minimumReleaseAge to 1440」✓
17. dsh.client 契约：lib/index.js 与 lib/client.js 双半侧存在、loader 按包名判定半侧 ✓（README L48 描述正确）

## 取证说明

- read 工具对 asar 路径抛 BigInt 绑定错，全部源码取证用 node:fs 直读 asar + grep 完成；
- 本机 git remote origin=https://github.com/Wenaixi/dsh-plugin-dev.git，与 README 徽章品牌一致；
- 未使用 web_search（按手册禁止事项）。
