# g09 · web-ui-slots-and-styling.md + client-ui-placement-and-verification.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：80
- OK：75
- WRONG：1
- STALE：0
- CONFLICT：1
- UNVERIFIED：3

## 逐条报告

### [WRONG] web-ui-slots-and-styling.md L306：否定断言「0.5px solid + border-l2 组合官方未使用」被证伪

- **现文**：`0.5px solid + border-l2 组合官方未使用，不是每行自带 border-bottom，后者会在末行多出一条线。`
- **问题**：该断言是全库级否定句，但 grep `border[: ][^;{}]*.5pxs+solids+var(--dsw-alias-border-l2)` 在官方包命中 9 处（8 个 client.js + 1 个 web-frontend dist css）。官方正式包大量使用此组合做描边；正确的限定是「官方不用它做行分隔」，而非「官方未使用」。
- **应为**：改为「官方在多处使用 0.5px solid + var(--dsw-alias-border-l2) 做描边（如 ui-deliverables / ui-jobs / ui-schedule / ui-settings-account / ui-shortcuts / ui-sidebar-browser / ui-sidebar-documentpreview 等），只是 ui-conversation 的行分隔不用它」。
- **证据**：`dsh-client-ui-deliverables/lib/client.js`、`dsh-client-ui-jobs/lib/client.js`、`dsh-client-ui-schedule/lib/client.js`、`dsh-client-ui-settings-account/lib/client.js`、`dsh-client-ui-shortcuts/lib/client.js`、`dsh-client-ui-sidebar-browser/lib/client.js`、`dsh-client-ui-sidebar-documentpreview/lib/client.js`、`dsh-experimental-client-ui-agent-team/lib/client.js`、`dsh-web-frontend/dist/assets/index-BPHePDI_.css` → 9 处 `border:.5px solid var(--dsw-alias-border-l2)`。对照：ui-conversation 行分隔确为 `.v1kfCW_row+.v1kfCW_row{box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}`（`dsh-client-ui-conversation/lib/client.js`），文档同句前半的 `.row + .row` 断言成立。

### [CONFLICT] web-ui-slots-and-styling.md L248：415 与 417 两个计数口径不一致

- **L248 现文 A**：`全官方包 lib/client.js 提及 --dsw-* 去重 415 个`
- **L248 现文 B**：`按 js+css 全口径为 417 个`；`全库 js+css 口径与 theme 定义数之差仅 14 个`
- **问题**：实际统计（全部 @deepseek-ai 包）：
  - lib/client.js 提及 `--dsw-*` 去重 = 414（剔掉 `--dsw-alias-` 截断残片后）＝415（若把 `dsh-cordis-client-runner/lib/client.js` 里的一处残片 `--dsw-alias-` 计入）；
  - js+css 全口径 = 417（剔伪影；带伪影为 418）；
  - dsh-client-ui-theme 定义 = 403（body 388 + :root 9 + @supports corner-shape 1 + focus-ring-color 1 + elevation 4），差 14 成立。
  即 415 用了「含伪影」口径、417 用了「剔伪影」口径，两数混用；按统一剔伪影口径应为 414 与 417。
- **应为**：统一口径表述为「lib/client.js 提及去重 414（若把 runner 中的 --dsw-alias- 截断残片计入为 415）；js+css 全口径 417；theme 定义 403；差 14」。
- **证据**：统计脚本对 `E:/newCC/APP/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai` 全部 `*.js`/`*.css` 的 `--dsw-[a-z0-9_-]+` 正则取样；伪影 `--dsw-alias-` 命中 `dsh-cordis-client-runner/lib/client.js`；`dsh-client-ui-theme/lib/client.js` 中出现 `--dsw-*` 定义去重 403（含 `:root{}` 块 9 变量、`body{}` 块 388、`@supports (corner-shape…){:root{--dsw-corner-shape}}`、`html[data-input-modality=pointer] body…{--dsw-focus-ring-color:transparent}`、`body,body *{--dsw-elevation-*}`）。

### [UNVERIFIED] web-ui-slots-and-styling.md L114：示例包名 dsh-prompt-history 无法核对

- **现文**：`（如 dsh-prompt-history 注入的历史弹出菜单、语音输入麦克风等）`
- **问题**：官方 @deepseek-ai 全库 grep `dsh-prompt-history` 0 命中；该名字可能是第三方插件包，不属于可核对真源。建议改为泛指「如历史记录弹出菜单」或删除具体包名。
- **证据**：grep `dsh-prompt-history` 于 `E:/newCC/APP/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai` 全库 0 命中。

### [UNVERIFIED] web-ui-slots-and-styling.md L444：省略 label 类型检查失败不可从发布物实证

- **现文**：`省略 label 会类型检查失败，这不是运行时可选项`
- **问题**：`dsh-client-ui-primitives` 发布物无 `lib/types/` 目录（package.json types 指向不存在的 `lib/types/index.d.ts`，lib 下只有 index.js + module.css），类型强制只能依赖不随发布物的 src TS；运行时 `label` 缺省不抛错。该断言方向正确但无法在本基线证实，需人工确认类型来源。
- **证据**：`dsh-client-ui-primitives/lib/` 目录清单无 types/；package.json `types: "lib/types/index.d.ts"`；`lib/index.js` 中 `function Switch({ checked, onChange, label, … })` 无运行时校验。同句 L382「发布物无 lib/types 目录，types 字段指向不存在的 .d.ts」本身准确（OK）。

### [UNVERIFIED] client-ui-placement-and-verification.md L310：asar 提取示例路径 /app/ 前缀与本机布局不符

- **现文**：`console.log(extract('/app/node_modules/@<scope>/<pkg>/lib/client.js')?.length)`
- **问题**：本机 desktop 的 resources/app.asar 内顶层为 `dsh/`（含 desktop-runtime.json、package.json、node_modules），不存在 `/app/` 前缀，按此模板 `extract` 恒返回 null。asar 头解析（readUInt32LE(12) 为目录 JSON 长度、slice(16,16+len)）本身数值正确（u32@12=3392048 恰为 JSON 长度，16+u32@12=8+u32@4 同指文件区起点）。路径应为 `/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js` 或从 walk 结果取实际前缀。
- **证据**：original-fs 读 `E:/newCC/APP/dsh/resources/app.asar`（121348951 字节）；目录 JSON 顶层 keys = desktop-runtime.json / package.json / node_modules（无 app）；u32@0=4、u32@4=3392056、u32@8=3392052、u32@12=3392048；16+u32@12 = 3392064 = 8+u32@4；用 16+u32@4 + offset 成功提取 `dsh-client-modules/package.json`（1658 字节）。

## 全绿要点（数量级对照组，均为 OK）

- 插槽目录（dsh-cordis-client-runner/lib/client.js 内 90 个条目）：sidebar.right.pane.tab = keyed/session（declaredBy rightbar.session）、conversation.session.header.utilities = list/session、conversation.input.right = list/session、conversation.chat.node = keyed/session（keyed 非 chain；chain 为 conversation.composer 与 shell.quota-notice，select 缺省抛错）、settings.section = list/root（官方 order -10/0/10/15/20 实测一致）、plugins.bundle.config = keyed/root（key=包名；renderSlot {view:"page"} {entryKey:pkg.name} 精确命中）、sidebar.right.pane.tab.title = keyed/session、sidebar.footer.action = list/root、sidebar.settings = single/root。
- 错误消息逐字命中（dsh-client-ui-slots/lib/index.js）：`keyed slot "X" requires options.key` / `list slot "X" requires options.id` / `chain slot "X" requires options.select`；注册保留字段 11 项与文档完全一致。
- slots.inject 静默语义（dsh-client-ui-renderer/lib/client.js）：reconcile 内 `spec === void 0 return`；callback 抛错经 queueMicrotask 重抛。
- IMMUTABLE_CACHE = `public, max-age=31536000, immutable`；artifactRevision = framedHash("plugin-artifact",[mtimeMs,ctimeMs,size])，combo = framedHash("combo",[id,rev…])，12 位 hex（dsh-client-modules/lib/index.js）。
- HMR：client-hmr 宿主侧 stat-poll + /plugins/events SSE（lib/index.js EVENTS_ENDPOINT），浏览器侧 EventSource(EVENTS_ROUTE)；desktop cordis.patch.yml grep client-hmr 0 命中，web-app/cordis.patch.yml 有 client-hmr 行。
- 端口：dsh-web-app/cordis.patch.yml `port: !!js ctx.webStartup.port ?? 3080` 精确命中。
- CSS 计数：theme 定义 403、差集 14（含 --dsw-hovercard-bg 举例，命中 primitives HoverCard.module.css）；四组误写全库 0 命中且 theme 未定义；--dsw-space-* 全库 0 命中；font-m-18 = `500 16px/28px var(--dsw-font-family)`（-font-size:16px/-line-height:28px/-font-weight:500）精确命中。
- 颜色变量在 body 而非 :root（:root 仅 radius 6+font-family 2+focus-ring-width 1+corner-shape+shiki）；切换属性 body[data-ds-dark-theme]；static 76 个中 75 个浅深同值。
- primitives 导出全部命中：Button/Switch/SegmentedControl/Pill/Tag/StateDot/Input/Checkbox/Menu/MenuItemButton/MenuSurface/Tooltip/HoverCard/Modal/Toast/DisclosureRow/RiskConfirmation/MarkdownText/CodeBlock/DiffBlock/TerminalBlock/JsonTree/PathLabel/PluginArtworkDefault+4 家族；Switch.label 必填（aria-label）、SegmentedControl id=<id>-<value>、StateDot aria-hidden 配对、Tag 8 tone、Modal Esc/Tab 焦点归还（useModalLayer）、Switch 120ms 未降级、DisclosureRow 24px 基准。
- primitives 引用统计精确：71 个含 dub client 包中 50 个引用 primitives、其中 5 个在 dsh.client.inject 列出。
- locale：register 返回 disposer、bind 存在、translate 查词链 `lookup(ns) ?? lookup(common) ?? key` 精确命中；renderer 对声明 locale 而无 face 抛 SlotAssemblyError。
- plugins 页：分组 official/bundles（官方/已安装）与 renderSlot view summary/page 精确命中；inventory tab id "all"（order 10）。
- ChatNodeSeat 用 useChatNode/useChatNodeProcess；chat.node fallback = JsonBlock（message.unknownSurface）精确命中。
