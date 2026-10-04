# g11 · 两份文档核实报告

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：38（含 1 条 UNVERIFIED→OK 修正）
- OK：28
- WRONG：4
- STALE：1
- CONFLICT：2
- UNVERIFIED：3

## 逐条报告

### [WRONG] install-resolution-traps.md L158：5.1 关闭冷却期示例注释「默认关闭；显式配置后才启用」与 2.1 节自相矛盾，且与 pnpm 11 内建默认 1440 冲突

- **现文**：```yaml
# 关闭发布冷却期（默认关闭；显式配置后才启用，这里是显式置 0 兜底）。
```
- **问题**：本节（5.1）注释说冷却期「默认关闭；显式配置后才启用」，而本文 2.1 节明确纠正过同一表述（「pnpm 11 起内建默认 1440，并非『默认关闭、显式配置后才启用』」）。这是上一轮修改后的残留矛盾；且 2.1 节把「默认关闭、显式配置后才启用」作为否定句纠正，本节却仍以肯定句保留。
- **应为**：注释改为「pnpm 11 起内建默认 1440（1 天）；这里是显式置 0 关闭，使新发布立即可装」。
- **证据**：捆绑 pnpm 11.7.0 `resources/runtime/pnpm/dist/pnpm.mjs:145910-145911` `"minimum-release-age": 24 * 60`；官方文档 <https://pnpm.io/settings/dependency-resolution> 标注 `Default: 1440 (since v11)`；pnpm.mjs:146176-146177 显式设置 `minimumReleaseAge` 才默认 strict。

### [WRONG] install-resolution-traps.md L195：第七节决策表首行「pnpm 冷却期（显式开启后）才成立」同样是残留矛盾

- **现文**：`| 解析版本明显过旧，且过一段时间后自动前移 | pnpm 冷却期（**显式开启后**才成立）或预发布排序 | ... |`
- **问题**：与 2.1 节「pnpm 11 起内建默认 1440」直接矛盾（CONFLICT 的另一半）；「显式开启后」表述错误。
- **应为**：`pnpm 冷却期（pnpm 11 起内建默认 1440，即 1 天）或预发布排序`。
- **证据**：同 L158 证据。

### [CONFLICT] install-resolution-traps.md L158 与 L33/L195 互相矛盾（冷却期默认状态）

- **L158 现文**：`# 关闭发布冷却期（默认关闭；显式配置后才启用，这里是显式置 0 兜底）。`
- **L33 现文**：`**pnpm 11 起内建默认 1440（1 天），并非「默认关闭、显式配置后才启用」**…`
- **L195 现文**：`pnpm 冷却期（**显式开启后**才成立）`
- **应为**：全文统一为「pnpm 11 起内建默认 1440；显式 `minimumReleaseAge` 时才把 `minimumReleaseAgeStrict` 置 true；写 0 即关闭」。
- **证据**：pnpm.mjs:145910-145911（默认块 24*60）、pnpm.mjs:146176-146177（strict 默认联动）、官方文档站 Default 1440 (since v11)。

### [CONFLICT] desktop-vs-cli-runtime.md L50 与运行时真值互相矛盾（node 版本三处不一致）

- **L50 现文**：`python 版本在 primary-runtime/runtime.json（实测 node 24.18.1 / pnpm 11.7.0 / python 3.12.14）`
- **问题**：`primary-runtime/runtime.json` 实测为 `node: 24.21.0`（`resources/runtime/primary-runtime/runtime.json`），而 `versions.json` 与 `desktop-runtime.json` 记 `node: 24.18.1`；primary-runtime 内 node.exe 实测 v24.21.0。文档把 versions.json 的 node 版本错安在 runtime.json 上。
- **应为**：`python 版本在 primary-runtime/runtime.json（实测 node 24.21.0 / pnpm 11.7.0 / python 3.12.14；versions.json 记 24.18.1 为捆绑 node 基线）`。
- **证据**：`resources/runtime/primary-runtime/runtime.json`（`"node": "24.21.0"`）；`resources/runtime/versions.json`（`"node": "24.18.1"`）；`dsh/desktop-runtime.json`（`nodeVersion: "24.18.1"`）；primary-runtime/dependencies/node/bin/node.exe --version = v24.21.0。

### [WRONG] desktop-vs-cli-runtime.md L109：参数形式示例「与 --dump-config 等 launcher 形态互斥时报 unknown option」文案不实

- **现文**：`dsh --profile web web           # 等价 dsh web web：web 成为 app-args；与 --dump-config 等 launcher 形态互斥时报 unknown option（实测）`
- **问题**：launcher 源码在 dump 模式与 app-args 并存时报的是 `error: config dumps take no app arguments, got "web"`，不是 unknown option。
- **应为**：`…与 --dump-config 等 launcher 形态互斥时报 config dumps take no app arguments（实测）`。
- **证据**：`dsh/lib/bin.js:76`（`program.error(`error: config dumps take no app arguments, got ...`)`）。

### [STALE] desktop-vs-cli-runtime.md L137：桌面版「未挂 client-hmr」表述过时

- **现文**：`开发期由 dev:web 重建 client bundle，client-hmr（/plugins/events SSE）自动热替换插件条目；桌面版（desktop profile 未挂 client-hmr）只能重启。`
- **问题**：desktop profile 的 bundles 含 `@deepseek-ai/dsh-web-app`，而该包的 `cordis.patch.yml` 自带 `- id: client-hmr` 行（注释「always mounted」）——desktop 组合树同样含 client-hmr 条目；「未挂 client-hmr」与运行时不符。正确差异是：desktop 的 client bundle 由 asar 内打包产物提供、没有 dev:web 重构建目录可热更，故仍须重启应用。
- **应为**：`桌面版（client bundle 在 asar 内，无 dev:web 重建路径）只能重启`。
- **证据**：`dsh-web-app/cordis.patch.yml` 含 `- id: client-hmr`；desktop profile `dsh.profile.bundles` 含 `@deepseek-ai/dsh-web-app`（C:/Users/Administrator/.dsh/profiles/desktop/package.json）；dsh-web-app/package.json `dsh.bundle.patch` 含 ./cordis.patch.yml。

### [OK→UNVERIFIED 修正] install-resolution-traps.md L67：精确版本「自动登记进 minimumReleaseAgeExclude」——实测证实机制成立，但「未显式开启 strict」的措辞有精度问题

- 源码证据：pnpm 在非 strict 模式把违例精确版本写入 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（pnpm.mjs:194297-194299 pickManifestUpdates → 170681-170688 写盘；194312 文案 `Added ... to minimumReleaseAgeExclude in pnpm-workspace.yaml`），机制成立；但「自动登记」发生在安装交互/收集流程后，且写的是 `pnpm-workspace.yaml`（非文档所述的启动即写入）。「实测精确安装 9 小时前版本成功且自动写入 exclude」为行为级实验，源码无法直接给出该精确时序——标注 UNVERIFIED（行为可信、实现细节待人工复验）。

### [UNVERIFIED] install-resolution-traps.md L86：回退链数值（age=180→.8、1200→.5、3000→.2）

- 无源码可独立复算（pnpm 候选挑选在 resolver 内、依赖 registry 实测），属实验记录；未判 WRONG。

### [UNVERIFIED] install-resolution-traps.md L85：pnpm registry 解析把 prerelease 纳入候选

- 源码里未见 `includePrerelease` 等价开关；pnpm 解析器（didPickVersion / pickPackage 路径）行为依赖运行时，未找到可直接引用的实现行；文档以「实测裸装解析到 4.10.0-dsh.5」为依据，标记 UNVERIFIED。

### [UNVERIFIED] desktop-vs-cli-runtime.md L279：九节「修复尝试」表格（pnpm install --force 等均 Already up to date）

- 行为记录，无源码行号可引；与 pnpm 一致性判断基于 lockfile/状态（operations.js/root 逻辑方向一致），但表格本身为实测叙事，标记 UNVERIFIED。

## 备注（OK 项代表性证据，未逐条展开）

- L33 核心断言（pnpm 11 内建默认 1440、strict 联动、289 包零命中）全部实测通过：捆绑 pnpm.mjs 默认块 24*60、L146176-177；`minimumReleaseAge` 在 289 个 @deepseek-ai 包 lib 与 dsh/lib 均 0 命中。
- L16 pnpm v11.7.0 与 L4 pnpm 12.8.1/Node 24.4.1 环境标注实测一致。
- L96-99 两段式检查（preflight nothing was installed / 后检 restored package.json, pnpm-lock.yaml, and node_modules）与 operations.js L318-319/L485-498 一致。
- L120-123 allow-version 命令形态、compatibility.json 缺省 ENOENT→无豁免可写、与冷却期入口两套机制分离：dsh/lib/plugin-BGnVfe_D.js versionCommand + dsh-app-boot readProfileCompatibility（L359-374）一致。
- L139-142 profile 目录结构（cordis.yml 每次启动重写为空 []、cfg.log/cfg.err 289 包零命中、.plugin-manager/logs/operation-*/pnpm.log）：profile-boot L189/L207、desktop patch 无 cfg.log/cfg.err 实测、operations.js L252 一致。
- L181/L213-226 Electron 独占守卫与 allowBuilds 正解、allow-build 不存在：dsh/lib/bin.js L35-37/L119、PnpmError 前缀（ERR_PNPM_IGNORED_BUILDS=IGNORED_BUILDS + 前缀拼接）、dsh-desktop-host/cli.js runDesktopCli manageDesktopProfile:true 一致。
- L232-234/272 reconcile 自动 push bundles 与 plain-dependency 警告：dsh-app-boot L1106 reconcileProfilePlugins、dsh-plugin-manager operations.js L44/L247-256/L59 一致。
- desktop-vs-cli：asar 布局（dsh/ 289 包 + 顶层 19 项共享依赖）、runtime 布局（cli/bin/dsh.cmd、primary-runtime/dependencies/{node,pnpm,python}、versions.json 三键）、Cache-Control immutable（client-modules L159）、artifactRevision mtime/ctime/size（L193-198）、/plugins/??&rev=（L203-205）、凭据分层（credentials-local resolve L473-490：进程环境→文件→项目 .env→用户 .env）、asar 头解析（readUInt32LE(12)+offset 16 实测成功、进程内 fs 读命中 asar 钩子、original-fs 可读）、select a profile only once（bin.js L31-33）、launcher 不读 DSH_PROFILE（bin.js 零命中、DSH_PROFILE 仅 dsh-shell-env 写出）——全部与源码一致。
