# g08 · references/settings-and-plugin-ui.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：32
- OK：26
- WRONG：6
- STALE：0
- CONFLICT：0
- UNVERIFIED：0

## 逐条报告

### [WRONG] 文档 L21：断言「0.2.0-rc.2 无插件市场 section（dshmarket 包不存在）；全部 settings.section 注册者仅 account/general/models/plugins/agent-presets」

- **现文**：`0.2.0-rc.2 无「插件市场」section（dshmarket 包不存在）；全部 settings.section 注册者仅 account(-10, 条件)/general(0)/models(10)/plugins(15)/agent-presets(20)`
- **问题**：官方 @deepseek-ai 包集内确实无 dshmarket（它属第三方包），但本机 desktop profile 已安装 dshmarket 1.66.8（package.json dependencies 与 dsh.profile.bundles 均含 dshmarket），其客户端注册了 `settings.section` id=`market` order=40 的「插件市场」section。断言「全部注册者仅官方 5 个」与运行态不符，也与本节后文自己列出的三大第三方注册者（L50/70/88：prompt-history/better-sidebar/wallpaper-engine 均注册 settings.section）相互矛盾。
- **应为**：改为「官方 @deepseek-ai 包内无 dshmarket（第三方插件市场包）；已安装的第三方（含本机 dshmarket：`market`, order 40；三大明星插件）仍会以 40/60/100/500 等 order 注册 settings.section，官方内置仅 account(-10, 条件)/general(0)/models(10)/plugins(15)/agent-presets(20)」。
- **证据**：`C:/Users/Administrator/.dsh/profiles/desktop/package.json`（dependencies 含 `dshmarket: ^1.66.8`、bundles 含 `dshmarket`）；`dshmarket/node_modules/dshmarket/client/client.js:14606-14612`（`name: "settings.section", id: "market", order: 40`）。

### [WRONG] 文档 L104：壁纸引擎图标补丁选择器

- **现文**：`在 src/nav-icon.js 中，它监听 DOM 就绪后，精准选中 div[data-slot="settings.section"]:has([data-section="wallpaper-engine"])，将默认齿轮平滑替换为壁纸调色盘 SVG`
- **问题**：官方设置导航按钮（nav 内 button）不带 `data-section` 属性，该选择器不存在匹配目标；实际实现是遍历 `nav button`，按按钮文本 === 当前语言下的 `weT("壁纸引擎")` 精确匹配，再把按钮第一个子元素（齿轮 svg）替换为自绘 SVG span（class 照抄以继承 shell 尺寸约束）。补丁采用 MutationObserver 持续重放而非仅「监听 DOM 就绪后」一次性。
- **应为**：改为「在 src/nav-icon.js 中，它通过 MutationObserver 监听设置对话框（body 传送门）挂载，遍历 `nav button` 按文本匹配当前译文的「壁纸引擎」标签，把第一个子元素（兜底齿轮）替换为同 class 的自绘壁纸调色盘 SVG（语言切换后重放）」；同时删除不存在的 `data-section` 选择器描述。
- **证据**：`dsh-plugin-wallpaper-engine/lib/client.js:3319-3341`（`installWeNavIcon`：querySelectorAll("nav button") + `btn.textContent.trim() !== want` + replaceChild）；官方 nav 渲染 `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js:305-317`（navCell 仅 aria-current/className/data-modal-autofocus，无 data-section 属性）。

### [WRONG] 文档 L161：远程设置写方法清单含 set/unset

- **现文**：`客户端注入 ctx.remote.settings，调用 mutate/set/unset/replace（命名空间=宿主 entry id）`
- **问题**：`ctx.remote.settings`（dsh-api-settings-controller 的 SettingsController）只暴露 `update`/`replace`/`mutate` 三个写方法加 describe/openSettingsDocument；`set`/`unset` 属于同文件 CredentialsController（凭据命名空间 credentials），不是 settings 的接口。
- **应为**：改为「调用 update/replace/mutate（命名空间=宿主 entry id）」，删除 set/unset。
- **证据**：`dsh-api-settings-controller/lib/index.js:408`（update）、:419（replace）、:432（mutate）；`set`/`unset` 为 credentials 接口（同文件 :169/:183，`credentials.set`/`credentials.unset`，装饰器名与 settings 无关）。

### [WRONG] 文档 L164-165：示例 mutate 第二参形状

- **现文**：`await ctx.remote.settings.mutate("my-plugin-id", { config: patchConfig // 全量替换该插件条目的 config })`
- **问题**：`mutate(ns, ops, expectedRevision)` 的第二个实参是有序表单编辑 ops 数组（`{op:"set", path, value}`），不是 `{ config: {...} }` 值对象；传对象会被 `ops.reduce` 当空迭代或按对象键误映射。「全量替换 config」的语义对应 `replace(ns, section, expectedRevision)`（section 为完整表单值对象），与 mutate 不符。
- **应为**：示例改为 `await ctx.remote.settings.replace("my-plugin-id", { config: patchConfig }, revision)`；若要字段级合并用 `update(ns, patch, expectedRevision)` 或 `mutate(ns, ops, expectedRevision)`（ops 数组）。
- **证据**：`dsh-api-settings-controller/lib/index.js:432-433`（`async mutate(ns, ops, expectedRevision)`）；`dsh-settings/lib/index.js:488-500`（mutate 对 `ops.reduce((value, op)=>…)` 逐条应用 `op.op === "set"`、`op.path`）。

### [WRONG] 文档 L180：插件管理中心渲染包归属

- **现文**：`插件管理中心由 @deepseek-ai/dsh-client-ui-settings-plugins 与 @deepseek-ai/dsh-client-ui-settings-plugin-inventory 联合渲染，分为两大区域`
- **问题**：主侧栏「插件」面板（拼图图标，PANEL_ID=`plugins`）由 `@deepseek-ai/dsh-client-ui-plugin-manager` 渲染并注册进 `sidebar.panellist`；settings-plugins（`settings.section` id=plugins）与 settings-plugin-inventory（`settings.plugins.tab` id=all）渲染的是「设置 → 内置插件」只读清单页（预设/全局两组），是两个不同的界面。「官方扩展+已安装」分组正是 plugin-manager 页面的两个 group，不是 settings-plugins/plugin-inventory 的产物。
- **应为**：改为「插件管理中心由 `@deepseek-ai/dsh-client-ui-plugin-manager` 渲染（注册 sidebar.panellist id=plugins），分为官方扩展与已安装两大区域；settings-plugins + settings-plugin-inventory 是设置窗口里的『内置插件』只读清单（会话插件/全局插件两组）」。后续 L182-187 的机制描述（OPTIONAL_BUNDLES 4+4、listBundles 排除 6 builtin、pluginInventory.list 投影）本身正确，仅归属句需修正。
- **证据**：`dsh-client-ui-plugin-manager/lib/client.js:1-2`（包 id）、:3656（PANEL_ID="plugins"）、:3769-3775（`sidebar.panellist` 注册）、:3342-3344（official/mine 分组）；`dsh-client-ui-settings-plugin-inventory/lib/client.js:792-799`（注册于 settings.plugins.tab）；`dsh-client-ui-settings-plugins/lib/client.js:201-213`（settings.section plugins 壳）。

### [WRONG] 文档 L198：locale 子路径未放行的吞法

- **现文**：`locale 子路径返回 { error: "Plugin metadata for …" } 诊断（插件管理 UI 显示 metadata error）`
- **问题**：`readPluginMeta` 里 `locale/en.json` 走 `optionalResourcePath`（对 ERR_PACKAGE_PATH_NOT_EXPORTED 等直接返回 undefined），en.json 未放行时是**静默回退**（dictionaries 空 → title 取 manifest.name / UI 兜底包名），不会产生 error；真正抛 `{ error }` 的是 en 放行后其它语言文件（dictionariesOf 内 resolvePluginResource 非 optional）解析失败、或 icon 校验失败、或包解析异常。同段「package.json 子路径吞成空（title 回退到完整包说明符）」也不完整：仅当存在 locale 翻译条目时 title 的 en fallback 才是完整 module specifier；package.json 与 locale 全缺时 `readPluginMeta` 整体返回 `undefined`（与 L277 一致）。
- **应为**：改为「package.json 与 locale/en.json 是可选资源：任一不在 exports 白名单时静默跳过（title 回退 manifest.name、UI 兜底包名；无 icon 无 error）；en 在但其它语言文件不在 exports 时抛 ERR_PACKAGE_PATH_NOT_EXPORTED 并被吞成 `{ error: "Plugin metadata for …" }` 诊断；icon 失败保留 title/description 并附 error」。
- **证据**：`dsh-app-boot/lib/index.js:1892-1895`（missingResource 含 ERR_PACKAGE_PATH_NOT_EXPORTED）、:1896-1902（optionalResourcePath 吞之返回 undefined）、:1972-1976（englishPath undefined → dictionaries 空 → title=fallbackText(manifest?.name)）、:1991-1995（title/description/icon 全缺返回 undefined）、:1997（外层 error 仅解析 throw 时）、:1985-1990（icon 失败保留 text + error）。

## 已核实通过的关键项（要点）

- 内置 order：general 0 / models 10 / plugins 15 / agent-presets 20 / account -10（条件注册），升序排序（settings-general lib/client.js:1023-1028 sort(a.order-b.order)）。
- 三大明星插件注册源码逐字段真实验证（order 60/100/500，label、locale、inject 形状全对上；agent-loop 注册 plugins.item）。
- 图标契约：MAX_ICON_BYTES=256*1024、相对路径/后缀/普通文件校验、data:image/ 返回（dsh-app-boot lib/index.js:1852-1875）；渲染 36/30px + object-fit:contain（plugin-manager lib/client.js:1906-1908, CSS）。
- plugins.bundle.config 为 keyed 插槽，容器按 `entryKey: pkg.name` 匹配（plugin-manager lib/client.js:2522, 3526）。
- remote.settings 冲突：SettingsConflictError code=SETTINGS_CONFLICT → 网关映射 settings/conflict（dsh-settings lib/index.js:163-180, 511；dsh-api-settings-controller lib/index.js:487-507）。
- configEditor 落盘 profile 补丁、HMR reconcile、启用/禁用写 {id, disabled}（dsh-plugin-manager lib/index.js:881-911, 2031-2033）。
