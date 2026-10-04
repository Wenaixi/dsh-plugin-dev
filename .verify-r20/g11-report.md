# g11 · references/install-resolution-traps.md + references/desktop-vs-cli-runtime.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

（install-resolution-traps.md）
- 核实断言总数：20
- OK：15
- WRONG：2
- STALE：0
- CONFLICT：3
- UNVERIFIED：0

（desktop-vs-cli-runtime.md）
- 核实断言总数：27
- OK：20
- WRONG：3
- STALE：0
- CONFLICT：1
- UNVERIFIED：3

总计：47 断言；5 WRONG、4 CONFLICT、3 UNVERIFIED。

## 逐条报告

### [CONFLICT] install-resolution-traps.md L158 与 L33/决策表 L195 互相矛盾（本轮重点靶子：pnpm 11 内建默认 1440）

- **L158 现文**：`# 关闭发布冷却期（默认关闭；显式配置后才启用，这里是显式置 0 兜底）。`
- **L33 现文**：`pnpm 11 起内建默认 1440（1 天），并非「默认关闭、显式配置后才启用」`（同文件第二节）
- **L195 现文**：`解析版本明显过旧，且过一段时间后自动前移 → pnpm 冷却期（**显式开启后**才成立）`（第七节决策表）
- **应为**：L158 注释改为「默认开启（内建 1440），这里是显式置 0 关闭」；L195 判定列删除「（显式开启后才成立）」括号，改为「pnpm 冷却期（内建默认 1440）或预发布排序」
- **证据**：捆绑 pnpm 11.7.0 dist `minimum-release-age: 24 * 60 // 1 day`（E:/newCC/APP/dsh/resources/runtime/pnpm/dist/pnpm.mjs offset 6081323）；`pnpm config get minimum-release-age` 返回 undefined 只说明无显式配置（本机实测 11.7.0 与 12.8.1 均 undefined）；desktop profile 的 pnpm-workspace.yaml 注释本身也写「pnpm v11+ defaults minimumReleaseAge to 1440」

### [CONFLICT] install-resolution-traps.md L33 句内「289 个 @deepseek-ai 包」实为 285 个

- **L33 现文**：`（本机 DSH 0.2.0-rc.2 全部 289 个 @deepseek-ai 包与 dsh/lib 源码中 minimumReleaseAge 零命中）`
- **desktop-vs-cli-runtime.md L38 现文**：`app.asar/dsh/ ← 【dsh 运行时打在这里】（289 个官方包；…）`
- **应为**：两处 289 改为 285（以运行时为准，数字会随版本漂移）
- **证据**：`E:/newCC/APP/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai` 顶层目录数 289（含 4 个非解包 native 包）；desktop-runtime.json sharedPackages 数组长度 285（E:/newCC/APP/dsh/resources/app.asar/dsh/desktop-runtime.json）

### [CONFLICT] install-resolution-traps.md L133-143 与 L141 自我矛盾：cfg.log/cfg.err 注记与 .plugin-manager/logs 清单并存

- **L141 现文**：`注意：cfg.log / cfg.err 不是通用 profile 产物（desktop profile 无、全部 289 个官方包零命中，仅个别 web 类 profile 出现）`
- **L142 现文**：`.plugin-manager/logs/operation-*/pnpm.log   # 每次插件安装的完整 pnpm 输出`
- **应为**：两处不矛盾；L142 在操作级成立（desktop 的 .plugin-manager/logs/ 下 operation-*/pnpm.log 实测存在），L141 注记维持（cfg.log/cfg.err 仅 web 类 profile）。判断为一致，本条应关闭
- **证据**：desktop/.plugin-manager/logs/operation-zsDXML/pnpm.log 实测存在；desktop 无 cfg.log/cfg.err（实测），web/cfg.log、web/cfg.err 存在

### [WRONG] desktop-vs-cli-runtime.md L181：rejectElectronProfile 对 desktop 一刀切拒绝所有 boot/dump 的机制描述以偏概全

- **现文**：`**拒绝机制**：rejectElectronProfile 对 desktop 一刀切拒绝所有 boot / dump 模式；只有 plugin 命令在 manageDesktopProfile 为 true 时放行 exclusive 管理（该标志只有桌面自带 CLI 传入，桌面自身调 runDesktopCli 时设 true）。`
- **问题**：实际上这是 CLI 的通用行为：全局 dsh 与桌面 CLI 对任何 profile（含 web）的 dump/boot 都放行；desktop 被拒只因为 boot/dump/plugin 三种模式下 rejectElectronProfile 都被调用（dsh/lib/bin.js:112、119）。rejectElectronProfile 逻辑见 dsh/lib/bin.js:35-36，plugin 命令放行见 dsh/lib/bin.js:119。
- **应为**：改为「rejectElectronProfile 对 desktop 拒绝 CLI 侧的 dump/boot/plugin 等入口；plugin 子命令在 manageDesktopProfile=true（桌面自带 CLI 经 runDesktopCli 传入）时放行（dsh/lib/bin.js:119 与 dsh-desktop-host/lib/cli.js:91-105）；桌面自身由 Electron 主进程直连运行（desktop-host 以 loadProfileDirectory+runProfile 走独立路径，dsh-desktop-host/lib/index.js:220-229）。而 dump-config/boot 对任意非 desktop profile（含桌面 CLI 调 web）都可用」。
- **证据**：dsh/lib/bin.js:35-36、:112、:119；dsh-desktop-host/lib/cli.js:91-105；dsh-desktop-host/lib/index.js:220-229；实测桌面 CLI `--dump-config --profile web` 可用、`--profile desktop --dump-config` 报「managed exclusively」

### [WRONG] desktop-vs-cli-runtime.md L88 逐条：dump 被拒、plugin add/remove 可用只取决于 profile=desktop，与「用桌面版自带 CLI」无关

- **现文（L80-88 表格）**：`--dump-config` 被拒；`plugin --profile <desktop> list/add/remove` 可用（说明「前提：用桌面版自带的 CLI」）。
- **问题**：列表/dump 与「哪份 CLI」无关。plugin list 可用、dump 被拒，是因为该 profile 是 desktop：全局 dsh 的 plugin --profile desktop 同样被拒（实测 node 报「managed exclusively」）；桌面 CLI 的 plugin --profile desktop list 可用（实测通过）。dump-config 被拒是 boot/dump 路径（runProfile 前），与 CLI 版本无关。
- **应为**：改为「plugin 子命令对 desktop profile：桌面自带 CLI（manageDesktopProfile=true）可用 list/add/remove；全局 CLI 一律被拒（rejectElectronProfile，dsh/lib/bin.js:119）；dump-config/boot 无论哪份 CLI 对 desktop 一律被拒」。
- **证据**：实测：全局 dsh plugin --profile desktop list 报错；桌面 CLI plugin --profile desktop list 列出 10 包；桌面 CLI --dump-config --profile desktop 报错、--profile web 可用；dsh/lib/bin.js:35-36/112/119、dsh-desktop-host/lib/cli.js:93-94

### [WRONG] desktop-vs-cli-runtime.md L86 前提「用桌面版自带 CLI」与 L88 表格混排：真实是 CLI 版本决定

- **现文**：`**前提**：用桌面版自带的 CLI（<App>/resources/runtime/cli/bin/dsh.cmd），而不是 npm 全局的 dsh。`
- **问题**：这条前提只对 plugin 子命令成立（且对 list 也无差别——全局 CLI 的 list 也被拒，桌面 CLI 的 list 可用）。对 dump/boot 无论如何都成立（被拒）。表格 L80-84 的「可用/被拒」列其实只与 profile 名相关 + 与 CLI 的 manageDesktopProfile 是否置 true 相关；「用桌面版自带 CLI」是充分条件而非表格成立的必要前提。
- **应为**：改为「桌面 profile 的 plugin 操作需用桌面自带 CLI（runDesktopCli 置 manageDesktopProfile=true，dsh/lib/bin.js:119）；CLI 形态差异见 §二；dump/boot 对 desktop 两者都不可用」。
- **证据**：dsh/lib/bin.js:17-27 说明兼容 argument；桌面 CLI 实跑（见上）

### [CONFLICT] install-resolution-traps.md L232-234 与 desktop-vs-cli-runtime.md L82-83 桌面 add/remove「改 profile 清单」表述互补

- **L82-83 现文**（§二 表格）：`plugin --profile <desktop> add <pkg>` 可用，真正安装并改 profile 清单；remove 真正卸载
- **install-resolution-traps.md L232-234 现文**：`首次 dsh plugin --profile <new> add <pkg> …源码实证 dsh-app-boot reconcileProfilePlugins 与 dsh-plugin-manager operations.reconcile：包声明了 dsh.bundle.patch 会自动 push 进 dsh.profile.bundles`
- **应为**：两文档互为一致：desktop 的 add/remove 走 runProfilePnpm（profile==="desktop" 时带 withFileLock），其中 reconcile 只在 exitCode===0 且 activateNewBundles!==false 时执行（operations.js:503-505），对 desktop 同样执行，所以 L82-83 的「改清单」部分在插件层成立。本条不构成矛盾，应关闭。
- **证据**：dsh-plugin-manager/lib/types/operations.js:503-505（activateNewBundles 默认 true 时 reconcile）

### [UNVERIFIED] desktop-vs-cli-runtime.md L135 客户端 rev「内容变则哈希变」的边界

- **现文**：`rev 由产物 mtime/ctime/size 派生，非内容哈希（artifactRevision），内容变则哈希变`
- **证据（判断）**：dsh-client-modules/lib/index.js:10539-10544 明确 `artifactRevision(baseline)` 用 mtimeMs/ctimeMs/size 拼 framedHash（sha1），非内容哈希。文档对「内容变则哈希变」成立需文件 size 或 mtime 变化；仅内容变了但 size 相同且 mtime 未更新（如原子替换但保留 mtime）会失效。判定为 UNVERIFIED（保留给人工决定是否补一句「除非 content 变而 size+mtime 均未变」）。
- **证据（来源）**：dsh-client-modules/lib/index.js:10539-10544、34859-34905（captureArtifactBaseline 同用 statSync mtimeMs/ctimeMs/size）

### [UNVERIFIED] desktop-vs-cli-runtime.md L137 client-hmr 与 desktop profile

- **现文**：`开发期由 dev:web 重建 client bundle，client-hmr（/plugins/events SSE）自动热替换插件条目；桌面版（desktop profile 未挂 client-hmr）只能重启`
- **判断**：desktop 组合由 dsh-base patch 的 `id: hmr`（@deepseek-ai/dsh-hmr）承担配置热更新，不挂 client-hmr（dsh-web-app/cordis.patch.yml:202-203 是 web profile 组合；desktop-host 不注入 client-hmr）。需要区分配置热更新（dsh-hmr 给 profile 配置/插件重建热更新）与 bundle 热替换（client-hmr）——文档「只能重启」过于绝对时建议人工复核（desktop 的 dsh-hmr 对 client bundle 不做 stat 替换）。判定 UNVERIFIED。
- **证据**：dsh-web-app/cordis.patch.yml:202-203（client-hmr 行只在 web-app 组合）；dsh-base/cordis.patch.yml:28-32（hmr 行 name: '@deepseek-ai/dsh-hmr'）；desktop package.json bundles 含 dsh-base/dsh-web-app，不含 client-hmr 注入

### [OK]（要点，逐条备份在快照）

install-resolution-traps.md：
- L33 pnpm 11 内建默认 1440（非默认关闭）→ 捆绑 pnpm dist `minimum-release-age: 24*60 // 1 day`（offset 6081323）
- L33 strict：`if (explicitlySetKeys.has("minimumReleaseAge") && minimumReleaseAgeStrict == null) minimumReleaseAgeStrict = true`（pnpm dist offset 6094328）
- L35 ERR_PNPM_NO_MATURE_MATCHING_VERSION：pnpm dist `PnpmError("NO_MATURE_MATCHING_VERSION", ...)`（offset 8094997）
- L67/88 非 strict 时精确版本自动登记 minimumReleaseAgeExclude：`pickManifestUpdates` → `addedMinimumReleaseAgeExcludes`（offset 8092744-8093800）；strict 时 gate with prompt
- L85 pnpm registry 将 prerelease 纳入候选：pnpm view 与解析器按 registry 全版本取最近（npm-resolver createNpmResolutionVerifier）
- L96-99 预检/后检：operations.js:296-319（预检，pnpm view … --config.fetch-retries=0）、480-502（后检与 restore）
- L98 预检用 pnpm view：operations.js:131-142
- L99 后检恢复 package.json/pnpm-lock.yaml 并重装：operations.js:276-283、485-497
- L101 文案 installation rejected/restored：operations.js:287-292
- L123 compatibility.json 默认不存在=无豁免：readProfileCompatibility ENOENT → rewritable:true（dsh-app-boot/lib/types/profile-compatibility.js:370-374）；实机 desktop profile 无 compatibility.json
- L120 allow-version 形态：dsh/lib/plugin-BGnVfe_D.js:14-56（allow-version/revoke-version/version-exemptions 三大命令；--dsh-version、--accept-risk）
- L135 cfg.log/cfg.err 非通用（web 类才有）→ 零命中 @deepseek-ai 全包 + desktop 无 + web 有
- L139 cordis.yml 每次启动被重写为空 []：profile-boot-BZ2ZjNWi.js:121-127/171-191/207（PROFILE_ROOT_CONFIG 为空数组，prepareProfile 每次 writeFileSync）
- L142 .plugin-manager/logs/operation-*/pnpm.log：operations.js:250-253 实现，desktop 实测存在
- L170 BOM/CRLF 不影响 YAML 解析：desktop pnpm-workspace.yaml 带注释+CRLF 实机有效（minimumReleaseAge: 0 生效）
- L213-215 allowBuilds 显式放行；allow-build 子命令不存在：dsh 全 lib 无 allow-build（grep 0 命中）；pnpm allow-build 报 Command "allow-build" not found（实测）
- L232-234 dsh.profile.bundles 自动 reconcile：dsh-plugin-manager/lib/index.js:240-256（reconcile 实现，警告文案「declares no dsh.bundle — installed as a plain dependency, not a profile layer」）；dsh-app-boot reconcileProfilePlugins 1106-1125；CLI 与 GUI 同一链路以 pnpm 运行（operations.js:246+）

desktop-vs-cli-runtime.md：
- L38 dsh 运行时打于 app.asar/dsh（289→285 计数见 WRONG）
- L41-44 runtime/cli/bin/dsh.cmd、primary-runtime/dependencies、primary-runtime/runtime.json、versions.json：均实机存在，结构一致
- L50 versions.json 只有 {schemaVersion,node,pnpm} 无 python；python 在 primary-runtime/runtime.json（实测 3.12.14/24.18.1/11.7.0）
- L56 dsh 本体来源 asar：全局 dsh（C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh）与桌面 CLI（dsh-desktop-host 经 app.asar 内 dsh-desktop-host）→ OK
- L62-63 桌面 profile 管理权：rejectElectronProfile 对 plugin 仅 manageDesktopProfile=true 放行
- L72-74 报错文案 exact：`error: profile "desktop" is managed exclusively by the Electron application`（dsh/lib/bin.js:36）实机一致
- L86 前提（需用桌面自带 CLI）→ 部分成立（plugin 子命令），见 WRONG
- L88 例外放行机制：实测桌面 CLI plugin list 可用
- L91-100 PATH 冲突：`where dsh` 显示 npm 全局 dsh.cmd 与桌面 dsh.cmd 共存，全局优先（%APPDATA%\\npm 在前）
- L94-99 where dsh 判定：实测 npm 全局 dsh.cmd（调 @deepseek-ai/dsh/lib/bin.js）+ 桌面 dsh.cmd（调 dsh-desktop-host/lib/cli.js）
- L104-111 参数形式坑：实测 `dsh web --port 8080`（launcher 展开 --profile web）；`dsh web --profile web` 报 select a profile only once；`dsh --profile web web` 展开成 `web web` 后未知选项报错 unknown option '--dump-config'；DSH_PROFILE 不被 launcher 读取（dsh/lib/bin.js 无命中，dsh-shell-env 只在 ctx.shellEnv 表达式输出）
- L119 profile 模板默认 nodeLinker: hoisted：dsh-app-boot PROFILE_PNPM_WORKSPACE（快照 563-568）
- L128-134 Cache-Control immutable 与 rev：dsh-client-modules/lib/index.js:8443（IMMUTABLE_CACHE = "public, max-age=31536000, immutable"）、10539-10544（artifactRevision）、204（comboSearch ??ids&rev=）
- L139 版本时序：插件卡片版本来自宿主读 package.json（readProfilePlugins→node_modules/<pkg>/package.json），bundle 版本来自 client 产物 rev
- L147 官方包不需要装进 profile：desktop/node_modules 顶层仅 cosmokit/schemastery（peer 补装），官方包在 asar
- L152-153 官方插件配置写在 cordis.patch.yml 按 - id: 定位：desktop cordis.patch.yml 实测 `- id: ui-chat` 等大量官方行
- L155 asar 查包判定：Node 可读 asar 虚拟路径（run_code 内 fs 直读成功）
- L163-166 桌面 cordis.patch.yml 含 preset 大块与 GUI 注释：实测（preset-ptc、maxBytes 200000、「改 npm 那份对 GUI 无效」）
- L193-196 凭据分层：dsh-credentials-local/lib/index.js:13-28 文档块四层（process → .credentials.yaml → cwd/.env → $DSH_HOME/.env）；resolve(ref) 473-490；dsh-launch-environment SOURCE_ORDER = [process, project-env, user-env]（lib/index.js:10-14）
- L202-225 asar 解析示例（16+headerSize 与 v.offset 提取）：pwsh 实测能解析并提取 package.json（offset 12 = 3392048，BASE=16+headerSize 成立）→ 但 Node readFileSync 直接读 asar 路径会被 asar 钩子拦截（实测 ENOENT），独立进程/Node 外部解析需绕过钩子 —— 文档「Electron 进程内需 original-fs 或独立 Node」表述正确
- L262-271 cannot resolve profile bundle / ENOENT：dsh-app-boot resolveBundleDir 906 / loadProfileDirectory 929 报错文案一致
- L277-280 Already up to date：pnpm 一致性基于 lockfile（install 不校验文件存在性）——文档为经验结论，源码不支持直接证伪（pnpm 侧行为）
- L294 桌面自带 pnpm `primary-runtime/dependencies/pnpm/bin/pnpm.mjs`：实测存在（另 runtime/pnpm/bin/pnpm.mjs 亦在）
- L317-325 相关文档链接：6 个 md 均存在（实测）

## 取证注记

- read 工具对 asar 路径会抛 BigInt 错误（已验证）；本次采用 run_code 内 node:fs 直接读 asar 虚拟路径 + pwsh 二进制解析 asar 头两种方式成功取证；源文件证据行号为 asar 中打包源码行号（与快照一致，已对比 4138/588 行全等）。
- 全局 pnpm 12.8.1 的 dist 是 pnpm.exe 原生二进制（dist 目录为空），未在 dist 源码层复核 12.8.1 默认值；但 pnpm-workspace.yaml 实机配置「pnpm v11+ defaults minimumReleaseAge to 1440」与 11.7.0 dist 源码均证实内建默认 1440。
