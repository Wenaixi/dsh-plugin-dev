# g13 · 四份文档核实报告

核实基线：DSH 0.2.0-rc.2（asar 真源码，289 包全量扫描）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：94
- OK：87
- WRONG：3
- STALE：1
- CONFLICT：0
- UNVERIFIED：3

## packaging.md（230 行）

### [WRONG] L57：官方包 files 精确列表/不发布 src 与映射/带 bin 紧跟 lib/bin.js

- **现文**：`- files 精确列表（lib/index.js + lib/types/**/*.d.ts；不发布 src/声明映射/JS map）；带 bin 的包在 files 中紧跟 lib/bin.js。`
- **问题**：该断言对 cordis 内核包与 dsh 主包均不成立。@deepseek-ai/cordis 的 files 为 `["lib/index.js","lib/types/**/*.d.ts","lib/types/**/*.d.ts.map","bin.js","src"]`（发布 src、声明映射、根 bin.js）；@deepseek-ai/dsh 的 files 为 `["lib/*.js","lib/types/*.d.ts"]`（通配，非"紧跟 lib/bin.js"）；libreoffice-kit 的 bin 是 ./lib/cli.js。dsh-* 生态小包确实无 src，但"官方包"作为全体陈述过强。
- **应为**：限定范围并修正 bin 形态——"dsh-* 生态包 files 不含 src/映射（cordis 内核是例外，files 含 src 与 .d.ts.map）；带 bin 的包由 files 覆盖其 bin 输出（dsh 主包用 lib/*.js 通配含 lib/bin.js，cordis 显式列根 bin.js）"。
- **证据**：`@deepseek-ai/cordis/package.json` files 字段；`@deepseek-ai/dsh/package.json` files=["lib/*.js","lib/types/*.d.ts"] 与 bin={dsh:"lib/bin.js"}；`@deepseek-ai/libreoffice-kit/package.json` bin。

### [WRONG] L126：安装时 add/update 都在 pnpm 运行之前预检

- **现文**：`安装时（dsh plugin 转发的 add/update）在 pnpm 运行**之前**预检清单，不兼容直接拒绝安装、一个都不装`
- **问题**：pnpm 前预检（namedSpecs→namedSpecManifest→evaluatePluginCompatibility→rejected "nothing was installed"）只对 INSTALL_COMMANDS = {add, install, i} 生效，update 不在其中。update 走的是 pnpm 装完后的兼容复查路径（不兼容则 restore package.json/pnpm-lock.yaml 并 repair），不是"pnpm 运行之前预检"。
- **应为**：`add/install/i 在 pnpm 运行前预检并整体拒绝；update 是安装后兼容复查、不合格则恢复文件回滚`。
- **证据**：`@deepseek-ai/dsh-plugin-manager/lib/index.js:291-296` INSTALL_COMMANDS 常量；同文件 500-514（preflight 拒绝）与 615-669（exitCode 0 后装后复查 + restore/repair）。

### [WRONG] L56：每个 dsh peer 在 dev 镜像

- **现文**：`每个 dsh peer 在 dev 镜像`（句内不变式）
- **问题**：289 包中 276 包满足 cordis peer+dev 镜像，但 dsh-terminal-bash 的 peerDependencies 含 `@deepseek-ai/dsh-session-projection@0.2.0-rc.2` 而 devDependencies 无此项，违反"每个 dsh peer 在 dev 镜像"。
- **应为**：`每个 dsh peer 在 dev 镜像（现官方仅 dsh-terminal-bash 例外：peer dsh-session-projection 未镜像进 dev）`。
- **证据**：`@deepseek-ai/dsh-terminal-bash/package.json` peerDependencies vs devDependencies；289 包全量 package.json 扫描。

### [UNVERIFIED] L66：分组（core/llm/...）纯容器与 aggregate 规则

- 官方仓库目录组织，asar 内无 packages/ 树可核；lib 源码无对应常量。需人工对照 repo。

### [UNVERIFIED] L200：tsdown 预设只在仓库 packages/client/tsdown.client.ts

- 仓库路径不在 asar 产物内，无证据。需人工对照 repo。

### [UNVERIFIED] L200：拆成多行的组合包半侧留在根行

- 官方 289 包中 0 个同时声明 dsh.bundle 与 dsh.client（双面包 0 样本），规则无可对照实例；子路径行不带半侧已由 exactPackageSpecifier 语义证实（见 OK 项）。"拆行组合包"行为属推断。

其余包装要点全部核实通过（节选）：L84-89 层顺序与 readProfilePatches 一致（bundle 各层→profile cordis.patch.yml→$DSH_HOME/cordis.patch.yml→overlays，dsh-app-boot/lib/index.js:1023-1033）；L91 config 整块替换（applyEntryPatches 103-106 整体赋值 overrides）；L137 CLI 豁免无 reload（dsh/lib/plugin-*.js versionCommand 直接返回）而 GUI setVersionExemption→reload()（dsh-plugin-manager 1418-1427）；L192 dsh-base cordis.patch.yml hmr 行 config.root: [] 显式配置、dsh-hmr Config root 默认 ["."]（dsh-hmr/lib/index.js:239）；L193 client-hmr pollIntervalMs 默认 500、SSE /plugins/events、graph/rebuilt 帧（dsh-client-hmr/lib/index.js:22,4-14）；L198 57 包含 react 全在 dev、peer 计数 0；L208 legacy-peer-deps 全库 0 命中；L216 289 包；L222 ERR_PNPM_IGNORED_BUILDS（dsh-plugin-manager/lib/types/install-failure.js:9）；L58 显式 .ts 后缀（cordis/src 32 条相对导入全带 .ts）。

## publish-npm-verification.md（57 行）

- 核实断言 15，全部 OK。
- L50 -dsh.N 后缀在 289 包 0 命中（全量 package.json version 扫描；本机第三方 @wenaixi/dsh-ponytail 为 4.10.0-dsh.9 佐证社区约定）；L52 官方 289 包 scripts 字段全部为空（0 包声明 scripts，含 typecheck/verify/behavior）；L54 官方包 .github 目录 0 命中、全文本扫描无 .github/workflows；L34/46 PowerShell 5.1 无 &&（PowerShell 7+ 才支持）属外部事实；L26 lib/ 为构建时产物成立（dsh 主包 files 只有 lib）。

## architecture-refactor-experience.md（65 行）

### [STALE] L45：node:http 的 res 不是 class、无私有状态

- **现文**：`node:http 的 res 不是 class、无私有状态，普通对象即可冒充——{ setHeader(){}, writeHead(c){status=c}, end(b){body=b} }`
- **问题**：ServerResponse 是 OutgoingMessage 的子类（class），且带内部状态（_header、writableEnded 等）。"不是 class"与"无私有状态"均不成立；可冒充的真正前提是 handler 只触碰这三个方法（鸭子类型）。
- **应为**：`node:http 的 res 是 class 且带内部状态，但 handler 只触碰 setHeader/writeHead/end 这类方法时，普通对象即可冒充`。
- **证据**：Node 标准库 ServerResponse/OutgoingMessage 为 class（外部事实）；文档自身示例只使用方法调用，结论不变。

其余要点核实通过：L25 webServer.register(route) 单参对象 {kind,path,handler}（dsh-host-webserver/lib/index.js:177-184，kind 为 exact|prefix）；L29 官方技能注册表 API registry.invalidateCache() 与提供者控制句柄 control.invalidate()（dsh-skill/lib/index.js:376,151-159）双确认；L51 宿主配置唯一写盘目标 cordis.patch.yml（dsh-config-editor/lib/index.js:23-25 documentPath=profileContext.patchPath、123 writeFileAtomic）；L53 SettingsConflictError 抛错而非返回 null（dsh-settings/lib/index.js:163-181 class、511 throw，code=SETTINGS_CONFLICT）；L54 dsh-settings write(ns, change, expected, paths) 签名与 mergeLayers 保留未知键（dsh-settings/lib/index.js:281-291,501）。

## client-i18n-pitfalls.md（84 行）

- 核实断言 18，全部 OK。
- L26 register 运行时只校验 BCP 47 id（/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u）与重复 (ns,locale) 抛错、不校验键集与值（dsh-client-locale/lib/client.js:1387-1396）；键成对是 LocaleNamespaceMap 编译期强制（dsh-cordis-client-runner/lib/client.js:1214-1215 注册签名、1215 描述"missing or extra key is a compile error"）；缺词回退 key（translate 1425：lookup ?? common ?? key）。L72 字典注册只 bump revision 不 emit locale/change（client.js:1397 publish(active,false) 与 1449 if(localeChanged) 呼应 client-runner:1188 subscribe 语义）；L76 readPluginMeta 只读 meta.title/description 与 icon（dsh-app-boot/lib/index.js:1969-1999，dictionariesOf 只取 meta 键）；browser import locale/*.json 依赖 exports 放行——dsh-schedule exports 含 "./locale/*.json" 且 locale/ 下有 en.json/zh.json（官方 10 含 locale exports 的包均放行）。

## 逐条报告结束

（完整证据均在真源码路径+行号，见上文各项）
