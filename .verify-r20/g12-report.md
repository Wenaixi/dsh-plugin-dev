# g12 · references/debugging-and-troubleshooting.md / silent-failure-and-gate-design.md / sandbox-internals-and-proxy.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：47
- OK：38
- WRONG：5
- STALE：0
- CONFLICT：2
- UNVERIFIED：2

## 逐条报告

### [WRONG] debugging L238：bundleManifest 的导出包归属

- **现文**：`bundleManifest(location, name)` | `@deepseek-ai/dsh-app-boot` 与 `@deepseek-ai/dsh-plugin-manager/operations` 均有导出
- **问题**：dsh-app-boot 的导出列表（lib/index.js:4137 export {...}）不含 `bundleManifest`；该函数仅内部定义（lib/index.js:1047）并被 readProfilePlugins 等内部调用，未导出。只有 dsh-plugin-manager 的 `./operations` 子路径导出它（lib/types/operations.js:31，且签名不同：(name, dir, anchor)）。
- **应为**：bundleManifest 仅在 `@deepseek-ai/dsh-plugin-manager/operations` 导出（签名 (name, dir, anchor)），dsh-app-boot 未导出该名。
- **证据**：`dsh-app-boot/lib/index.js:4137`（导出列表无 bundleManifest）、`dsh-app-boot/lib/index.js:1047`（定义未导出）、`dsh-plugin-manager/lib/types/operations.js:31`（`export function bundleManifest(name, dir, anchor)`）。

### [WRONG] debugging L13：settings.yaml.imported 的判定路径

- **现文**：判定动作 `ls $DSH_HOME/settings.yaml.imported`
- **问题**：SettingsForms 的 legacy 文档路径是 `join(profile.home, "settings.yaml")`（profile.home 即 profile 目录，默认 `~/.dsh/profiles/<name>`），并非 `$DSH_HOME` 根。
- **应为**：`ls ~/.dsh/profiles/<name>/settings.yaml.imported`（与本文档 L174 自用的 `~/.dsh/profiles/<profile>` 风格一致）。
- **证据**：`dsh-settings/lib/index.js:348`（`const path = join(profile.home, "settings.yaml")`）、lib/index.js:350-351（`const imported = \`\${path}.imported\`; await rename(path, imported)`）。

### [WRONG] silent-failure L16：locale 子路径的「吞法」归类

- **现文**：`locale` 子路径返回 `{ error: "Plugin metadata for …" }` 诊断
- **问题**：en.json 因 `exports` 未放行而 `ERR_PACKAGE_PATH_NOT_EXPORTED` 时，走 `missingResource` 被吞成 undefined（与 package.json 子路径同一种吞法，零 error）；`{ error }` 只在 locale 文件被读到但内容/文件名非法（LANGUAGE_ID 不匹配、重复 locale、JSON 解析失败）时才返回。
- **应为**：`package.json` 与 `locale/*.json` 子路径未放行时都静默吞成空（缺失资源无 error）；只有已读到的 locale 文件内容/文件名非法或 icon 校验失败时才返回 `{ error: "Plugin metadata for …" }` 诊断（icon 失败保留 text 附 error）。
- **证据**：`dsh-app-boot/lib/index.js:1892-1900`（missingResource 吞 ERR_PACKAGE_PATH_NOT_EXPORTED/ERR_MODULE_NOT_FOUND 等）、lib/index.js:1969-1998（readPluginMeta：optionalResourcePath 两处、catch 才 error）、lib/index.js:1931（LANGUAGE_ID 抛错进 catch）。

### [WRONG] silent-failure L48：offload 占位符示例是编造的

- **现文**：`将历史图片替换为紧凑的文本占位符: [Image: uploaded_diagram.png (offloaded)]`
- **问题**：全库 grep `offloaded)` 与 `[Image: ... (offloaded)]` 0 命中。image-offload 事件只把旧图片块标记 `offloaded: true`（session.append("image/offload", { targets })），真正生成模型可见占位文本的是 LLM 适配器侧的 `offloadedImageText`，形态完全不同。
- **应为**：占位文本实际形态为 `[image omitted to fit request image limits; <attachment 身份描述>; <本地规范化路径或重附指引>]`（可改为「替换为 `[image omitted to fit request image limits; ...]` 形态的占位文本」）。
- **证据**：`dsh-compaction-image-offload/lib/index.js:14-44`（offloadOldestImages、append("image/offload")）、`dsh-llm/lib/index.js:581-585`（offloadedImageText 生成占位文本）、grep "offloaded)" 全库 0 命中。

### [WRONG] sandbox L10：CreateRestrictedToken 标志数量与 attrs=13 自相矛盾

- **现文**：`一次性施加 DISABLE_MAX_PRIVILEGE|SANITIZE_STATE|LUA_TOKEN|WRITE_RESTRICTED 四标志，attrs=13`
- **问题**：Windows SDK 中 DISABLE_MAX_PRIVILEGE=0x1、SANITIZE_STATE=0x2、LUA_TOKEN=0x4、WRITE_RESTRICTED=0x8；13 (0xD) = 1|4|8 = DISABLE_MAX_PRIVILEGE|LUA_TOKEN|WRITE_RESTRICTED，**不含 SANITIZE_STATE**（四标志之和是 15）。「13」与「四标志」并存即自相矛盾。
- **应为**：`CreateRestrictedToken 一次性施加 DISABLE_MAX_PRIVILEGE|LUA_TOKEN|WRITE_RESTRICTED 三标志（attrs=13=0xD；SANITIZE_STATE 未设置），WRITE_RESTRICTED 是组合 flags 的一部分而非单独标志`
- **证据**：`dsh-sandbox-windows-acl/lib/types-Cl_DXjhk.js:893`（`api.createRestrictedToken(currentToken, 13, ...)`）；Win32 文档常量值（0x1/0x2/0x4/0x8）。

### [CONFLICT] debugging L174 与 L200 互相矛盾

- **L174 现文**：解法为「检查 `~/.dsh/profiles/<profile>/cfg.err`，使用 `allow-version` 豁免兼容性或安装缺失插件」
- **L200 现文**：`~/.dsh/profiles/<profile>/cfg.log` / `cfg.err` **没有任何官方写入者**（全库 0 命中）；本机实测 cfg.err 为 0 字节、cfg.log 只是 dump 残留 —— 不要拿它们当诊断入口
- **应为**：L174 删去「检查 cfg.err」步骤，改为「读启动日志（`$DSH_HOME/logs/startup-<ISO>-<uuid>.log` 的 inspect 报告或终端 `dsh: disabling profile plugin <id>: <reason>` 行）定位被兼容性闸门拒绝的插件，再用 `allow-version` 豁免」
- **证据**：grep "cfg.err" 全库 0 命中、grep "cfg.log" 全库 0 命中；`dsh-app-boot/lib/index.js:2060`（`dsh: disabling profile plugin ...` stderr 行）；`dsh/lib/bin.js:158-194`（reportStartupFailure 落盘 startup-*.log）。

### [CONFLICT] debugging L294 与 L296：compatibility.json 默认值描述不一致

- **L294 现文**：`compatibility.json` # 精确版本豁免表，默认 {}
- **L296 现文**：`compatibility.json` # 精确版本豁免表（**首次执行 allow-version 后才生成**，默认不存在；本机 desktop 无此文件）
- **应为**：统一为「默认不存在（本机 desktop 无此文件）；读取语义视为 {}，首次 `dsh plugin allow-version` 才生成」，删除 L294 的「默认 {}」或注明「读取语义」。
- **证据**：`dsh-app-boot/lib/index.js:359-374`（readProfileCompatibility：ENOENT 返回 {exemptions:{}, rewritable:true}，不创建文件）；本机 `C:/Users/Administrator/.dsh/profiles/desktop/compatibility.json` 实测不存在。

### [UNVERIFIED] debugging L176：Typert Remote 方法签名限制

- 标题：远程方法签名「单一名命参数对象、禁止解构、禁止默认值、signal 必须为末位参数」
- 说明：本轮未在 asar 中定位该约束的精确源码（typert 生成器/校验器约束），R19 曾确认；建议后续人工复核 typert 包。

### [UNVERIFIED] debugging L82：失败时「控制台只给一句含糊的 import 错误」

- 标题：Client 半侧三形态错误的控制台表现
- 说明：「Failed to load plugins」确认为 DOM 遮罩标题（见 OK 项）；「console 只给一句含糊 import 错误」未在源码定位——console 层实际为 `[cordis-client-runner]` 前缀 error（dsh-cordis-client-runner/lib/client.js:537/733/947/971 等）与 web boot 的 console.error。建议以 silent-failure L185 表述为准。

---

## OK 要点（38 条核实通过，摘录高价值项）

- debugging L11：registerTab / addSettingsTab 全库 grep 0 命中；ctx.settings 只投影 volatile 表单并委托 ctx.configEditor（dsh-settings/lib/index.js:324,413-420）；settings.section 插槽真实存在。
- debugging L12：ctx.tools.registerTool / ctx.toolRegistry 全库 0 命中；真实 API 为 ctx.tools.register（dsh-tools/lib/index.js:2886）；ctx.tools.schemas() 存在（:3023）。
- debugging L13 主断言：settings.yaml 已废弃、Loader 就绪后导入一次并改名 .imported、零错误信号（dsh-settings/lib/index.js:339-363）。
- debugging L14 + L199：真实文案 `${binName}: startup failed: N required plugins did not activate`（dsh-app-boot/lib/index.js:3968）；reportStartupFailure 写 `$DSH_HOME/logs/startup-<ISO>-<uuid>.log` 并打印 `Full diagnostics: <path>`（dsh/lib/bin.js:158-194）。
- debugging L17：mcp__ 命名契约（mcp__<serverName>__<rawName>，64 字符/字符集规范化 + 12 位 sha256 后缀，dsh-mcp-client/lib/index.js:58-102）。
- debugging L18：slots.inject 在 spec 不存在时 callback 不执行且零报错（dsh-client-ui-renderer/lib/client.js:1368 `if (spec === void 0) return`）；slots.register 对未声明插槽会 throw（dsh-client-ui-slots/lib/index.js:165）。
- debugging L20：未声明 dsh.bundle 的依赖警告 `installed as a plain dependency, not a profile layer`（dsh-plugin-manager/lib/index.js:251）。
- debugging L59/回看 silent L59：web startup 只声明 --host/--no-open/--port/--trusted-host 四选项、无位置参数（dsh-web-app/lib/startup.js:22-27）；headless 有 `[task...]` 位置参数、多词空格 join、- 读 stdin（dsh-headless/lib/startup.js:35,77）。
- debugging L66-68：__DSH_BOOT__ wire 结构 rev/entries[{id,url,rev,inject,external}]/batches 与解析器完全一致（dsh-client-modules/lib/client.js:108-173）；clientModules 是 Node 半侧服务名（dsh-client-modules README）。
- debugging L71-78：__ModuleLoader__ queue facade 只有 load(registration)/create(options)（dsh-client-modules/lib/index.js:454-475）；combo URL 形如 /plugins/??<id>/client.js&rev=...（dsh-client-modules/lib/client.js:480-485 校验切片）。
- silent L185 + debugging L82 半句：Failed to load plugins 是 web 前端 boot 遮罩标题（dsh-web-frontend/dist/assets/index-5SrrfWpU.js boot fail 渲染 `yn(xn.failedTitle,"Failed to load plugins")`，非 console）；console 层为 [cordis-client-runner] 前缀 error（已确认多处）。
- silent L45/L106：iconOf 只收 svg/png/jpg/jpeg/webp、MAX_ICON_BYTES=256*1024、拒绝绝对路径/协议头/逃出 manifest 目录（dsh-app-boot/lib/index.js:1850-1875）。
- silent L185 遮罩 + L190：icon 以 data:image/ 前缀返回（iconOf return L1875）。
- silent L191：body[data-ds-dark-theme] 为官方主题切换属性（dsh-client-ui-theme/lib/index.js:55 toggleAttribute）。
- sandbox L8-13 主体：PLATFORM_CHAINS={linux:["bwrap","landlock"], darwin:["seatbelt"], win32:["windows-acl"]}（dsh-sandbox-local/lib/index.js:173-177）；bwrap 优先、landlock 经 node-addon-system/landlock-run 探测、旧 ABI partial、全链不可用 fail-closed 抛 SandboxUnavailableError（:231-243,496-512）；DACL 一次写 = 能力 SID Allow + world FILE_DELETE_CHILD Deny + Low no-write-up 标签（dsh-sandbox-windows-acl/lib/types-Cl_DXjhk.js:592-612）；workspace ACE 常驻不撤销、temp ACE 可回收（:916-922）。
- sandbox L26-28：三状态判别成立——Policy Denial 文案（dsh-tool-pwsh README）、SandboxUnavailableError（dsh-sandbox/lib/index.js:270-273）、退出码非 0 不等于 runner 失败。
- sandbox L34-47/49-52 主体：IMAGE_OFFLOAD_REQUIRED_CODE 常量（dsh-llm/lib/index.js:236）；compaction-image-offload 捕获 agent/request-error 与 compaction/summary-error、选最早 retained 图片、追加 image/offload 事件、返回 {kind:"retry"}（dsh-compaction-image-offload/lib/index.js:139-152）。
- sandbox L60-68：installProxyFromEnvironment（dsh/lib/profile-boot-BZ2ZjNWi.js:225 调用）读 http_proxy/HTTP_PROXY/https_proxy/HTTPS_PROXY/all_proxy/ALL_PROXY/no_proxy/NO_PROXY（dsh-http-proxy/lib/index.js:29-43,245），setGlobalDispatcher 安装（:442-446），Node 原生 fetch 解析 global dispatcher（:400-410 注释）。
- debugging L224：`profile "desktop" is managed exclusively by the Electron application` 逐字一致（dsh/lib/bin.js:36）。
- debugging L205-209：日志目录 `<profile>/.plugin-manager/logs/operation-*/pnpm.log` 逐字一致（dsh-plugin-manager/lib/index.js:441-446）。
- debugging L244-250 + silent L206-209：pathToFileURL 跨平台调用、readPluginMeta 返回 {title, description, icon}（title 可为 {en,...} 对象）、icon data:image/ 前缀均与源码一致。

## 附加发现（低严重度，不改变上述判定）

1. debugging L173 表格行尾有残留字符 ` |fund`。 |`（3 列表格出现 4 个分隔符，第四格内容为残缺 `fund`。`），疑为历轮编辑残留，建议清理。
2. sandbox L26 表格中 Policy Denial 文案写作 `[sandbox: file access denied]`，完整官方文案为 `[sandbox: file access denied under <mode> mode]`（dsh-tool-pwsh README 与 dsh 系统提示），建议补全为完整形式以免读者照抄缺失后缀。

## 禁止事项遵守情况

- 未修改任何被核实文档；未创建报告以外的文件；未使用 web_search。
