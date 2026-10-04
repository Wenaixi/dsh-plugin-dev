# h02 · 通用性审查报告（仓库专属细节剔除）

核验范围：settings-and-plugin-ui.md / config.md / desktop-vs-cli-runtime.md / install-resolution-traps.md / packaging.md
核验基线：DSH 0.2.0-rc.2（asar 真源码 + desktop/web profile 运行时）+ 本机实测
核验时间：2026-10-04

## 结论概览

- 审查断言总数：19
- WRONG-GENERIC：19（其中 1 条同时含伪符号名问题）
- OK（保留判断：官方发布物结构/版本基线，未逐条列出）：settings 官方 section 排序（general 0/models 10/plugins 15/agent-preset 20/account -10，源码逐一证实）、dsh-base hmr 行 root: [] 与 dsh-hmr 默认 root: ['.']（官方补丁/实现，属官方发布物）、57 含 react 包 zero peer（数字与实测一致，机制保留）

## 逐条报告

### [WRONG-GENERIC] settings-and-plugin-ui.md L21：点名 dshmarket 第三方包并写死本机已装/order=40

- 现文：`官方 @deepseek-ai 包内无插件市场 section（`dshmarket` 属第三方包，本机已装并注册 id=`market` order=40）；官方内置注册者仅 account(-10, 条件)/general(0)/models(10)/plugins(15)/agent-presets(20)，已安装的第三方（dshmarket 与三大明星插件）会以更高 order 追加`
- 问题：dshmarket 是本机 desktop/web profile 才装的第三方包，别的开发者机器上没有它；order=40 是该包当前版本的注册值，随版本漂移。点名并非为了说明某个官方通用结论。
- 应为：`官方 @deepseek-ai 包内无插件市场 section（若你的 profile 装了第三方市场插件，它会在相应插槽注册自己的 section）；官方内置注册者仅 account(-10, 条件)/general(0)/models(10)/plugins(15)/agent-presets(20)，已安装的第三方插件按其声明的 order 追加在官方项之后`
- 证据：C:/Users/Administrator/.dsh/profiles/desktop/package.json（dshmarket 在 dependencies 与 bundles 中，v1.66.8）；assets 目录为端口快照

### [WRONG-GENERIC] settings-and-plugin-ui.md L45-104：整节“三大明星插件的真实实现源码深度解密”以三个第三方插件为示例

- 现文：`DSH 社区中最著名的三大带界面的插件……dsh-prompt-history（order: 60）/ dsh-better-sidebar（order: 100）/ dsh-plugin-wallpaper-engine（order: 500）` 及注册源码、图标注入细节
- 问题：三个具名包是本机 profile 的快照依赖（版本 1.2.15/0.24.1/1.2.0）；其 id/order 值、`installNavGlyph`、`src/nav-icon.js` 等是该包仓库内部实现，属“某个第三方插件仓库”内容，会随这些包的更新漂移；对读者唯一有通用价值的是“第三方插件就是这样注册 settings.section 的”这一句式。
- 应为：整节改写为“某第三方插件的真实注册代码（示例）”：保留 `ctx.slots.inject("settings.section", () => ctx.slots.register({ name, id, order, label, locale }, PanelComponent))` 的骨架与“order 需大于官方内置项 15/20”的要点，示例 id 改为 `my-plugin` 之类占位；图标 hack 段（L66-67、L103-104）降级为一句：`官方对未知 id 渲染兜底齿轮图标；少数插件用 DOM 补丁/内联样式替换图标，这是插件侧 hack，不是官方 API，需自行维护`，删除 `src/nav-icon.js`、`installNavGlyph` 等仓库内路径/函数名。
- 证据：C:/Users/Administrator/.dsh/profiles/desktop/node_modules/dsh-prompt-history/lib/client.js:1532-1538（order:60）、dsh-better-sidebar/lib/client.js（order:100）、dsh-plugin-wallpaper-engine/lib/client.js（order:500、installWeNavIcon/MutationObserver）

### [WRONG-GENERIC] settings-and-plugin-ui.md L103-104：引用第三方插件仓库内文件路径 src/nav-icon.js

- 现文：`在 `src/nav-icon.js` 中，它通过 MutationObserver 监听设置对话框挂载……`
- 问题：`src/nav-icon.js` 是 wallpaper-engine 仓库内的源码路径（产物中为内联模块注释），不随包发布，任何读者都无从对照。
- 应为：并入第 2 条的图标 hack 泛化句，删除具体仓库路径。
- 证据：desktop/node_modules/dsh-plugin-wallpaper-engine/lib/client.js:3250（“内联模块：src/nav-icon.js”——已构建进产物，无独立文件）

### [WRONG-GENERIC] settings-and-plugin-ui.md L186：“已安装列表 (已安装 10)”及六个第三方包点名

- 现文：`包含当前 profile 中已安装的所有第三方组合包（如 Better Sidebar、cfbridge、dsh-context、dsh-plugin-wallpaper-engine、dsh-prompt-history 等）`
- 问题：“已安装 10”是本机 desktop profile 依赖数快照（web profile 为 13 个）；点名列表随 profile 变动，“本机已装”的表述对其它读者无意义。
- 应为：`已安装列表：当前 profile 的 dependencies 中，排除 BUILTIN_PROFILE_BUNDLES（6 个官方 bundle）后剩余的全部第三方组合包（数量随 profile 变动，查询入口为 profiles/<name>/package.json 的 dsh.profile.bundles）`
- 证据：desktop/package.json dependencies=10 项；web/package.json dependencies=13 项；dsh-client-ui-plugin-manager/lib/client.js:1864-1871（BUILTIN_PROFILE_BUNDLES 恰为 6 项）

### [WRONG-GENERIC] config.md L134-152：第五节“Web Profile 官方生效的 14 个 Bundles 清单”整节

- 现文：`在当前最新的生产基准（2026-10-01）中，Web profile 包含以下 14 个标准组合包：… dshmarket / dsh-context / dsh-better-sidebar / @wenaixi/dsh-ponytail / @wenaixi/dsh-superpower / dsh-prompt-history / @linxin666/dsh-client-ui-git-graph / dsh-plugin-wallpaper-engine / @wenaixi/cfbridge / @liustack/modsearch`
- 问题：标题即误导——“官方生效/标准”实为本机 web profile 当前已装的 bundle 快照，14 项中 10 项是第三方包（web/package.json bundles 14 项逐项吻合）；2026-10-01 的“生产基准”是单机快照；这些第三方包会删除/新增，本节随之失真。
- 应为：整节删除或降级为一句：`profile 实际挂载哪些 bundle 以 profiles/<name>/package.json 的 dsh.profile.bundles 为准（含官方 base/web-app/experimental-* 与用户自行安装的第三方包），不要在各文档里维护固定清单；` 同时删除日期“2026-10-01”与逐包名列表。
- 证据：C:/Users/Administrator/.dsh/profiles/web/package.json（dsh.profile.bundles 14 项与现文一一对应）

### [WRONG-GENERIC] config.md L118-121：写死本机 web profile 路径并断言 npm 为官方推荐

- 现文：```bash cd ~/.dsh/profiles/web; npm install --legacy-peer-deps --no-audit --no-fund```（“官方推荐解决方案”）
- 问题：`~/.dsh/profiles/web` 是本机 profile 名与路径；且“npm 替代 pnpm”与 packaging.md L206-208“官方包管理链路是 pnpm、全库不依赖 npm --legacy-peer-deps”直接矛盾；把本机一次 OOM 规避手段写成官方规范会在未来误导。
- 应为：`在目标 profile 目录用其包管理器重装依赖（pnpm 解析超大依赖图 OOM 时，可临时用 npm --legacy-peer-deps 规避；两者结果需以 plugin list 零报错验收）`，路径改为 `$DSH_HOME/profiles/<name>`。
- 证据：packaging.md L206-208（官方链路 pnpm 自述）；本机 web profile 目录存在但属该机配置

### [WRONG-GENERIC] desktop-vs-cli-runtime.md L38：写死“285 个官方运行时包”

- 现文：`resources/app.asar/dsh/ ← 【dsh 运行时打在这里】（285 个官方运行时包，sharedPackages 清单见 desktop-runtime.json…）`
- 问题：数量与真源不符且必然漂移：desktop-runtime.json 的 sharedPackages 实测 287 项（全部 @deepseek-ai）。任何“包数量”都会随版本变化。同句的“asar 顶层另有约 10 个共享主进程依赖”同样失准（实测 asar/node_modules 顶层 19 项）。
- 应为：`resources/app.asar/dsh/ ← dsh 运行时打在这里（全部 @deepseek-ai 官方包，清单以 desktop-runtime.json 的 sharedPackages 字段为准）；asar 顶层另有 Electron 主进程自用的共享依赖（清单以 app.asar/node_modules 为准）`
- 证据：E:/newCC/APP/dsh/resources/app.asar/dsh/desktop-runtime.json（sharedPackages.length=287）、app.asar/dsh/package.json（dependencies=287）、app.asar/node_modules 顶层 19 项

### [WRONG-GENERIC] desktop-vs-cli-runtime.md L50：写死 node/pnpm/python 三个版本号

- 现文：`python 版本在 `primary-runtime/runtime.json`（实测 node 24.18.1 / pnpm 11.7.0 / python 3.12.14）`
- 问题：版本号是本机发行版快照，且自身已不一致：versions.json 记 node 24.18.1，而 primary-runtime/runtime.json 记 node 24.21.0（同为当前安装）。补丁升级即漂移。
- 应为：`versions.json 只含 {schemaVersion, node, pnpm} 三键；python 版本与完整 pythonPackages 清单在 primary-runtime/runtime.json。具体版本以这两个文件为准，勿在文档写死`
- 证据：E:/newCC/APP/dsh/resources/runtime/versions.json（node 24.18.1）与 primary-runtime/runtime.json（node 24.21.0 / pnpm 11.7.0 / python 3.12.14）

### [WRONG-GENERIC] desktop-vs-cli-runtime.md L119：括注“本机 web 即 isolated”

- 现文：`.pnpm 下有真实 store，顶层是符号链接（本机 web 即 isolated）`
- 问题：`本机 web` 是本机 profile 布局描述，读者机器不保证。
- 应为：删除括注，仅保留 `isolated（pnpm 默认布局）` 机制描述。
- 证据：desktop-vs-cli-runtime.md L119；web profile pnpm-workspace.yaml（nodeLinker: isolated——本机样例）

### [WRONG-GENERIC] desktop-vs-cli-runtime.md L165-166：把本机 profile 的 preset/maxBytes 段当桌面版普遍特征

- 现文：`桌面版常含特有段：preset 大块、GUI 专属覆盖段（例如把某些 `maxBytes` 从 asar 内默认值改大的段，注释里会写明"改 npm 那份对 GUI 无效"）`
- 问题：preset 大块与 maxBytes：200000 覆盖段（含注释原文）逐字来自本机 desktop 的 cordis.patch.yml，是该机运维产物，不是桌面版形态的必然成员。
- 应为：`桌面版补丁常含 GUI 专属覆盖段（覆盖 asar 内默认值的整行替换，段内注释常注明"改 npm 那份对 GUI 无效"）；迁移时这些段必须整段保留、不覆盖`，删除 maxBytes 具体例子。
- 证据：C:/Users/Administrator/.dsh/profiles/desktop/cordis.patch.yml（dsh-budget-override 段：maxBytes: 200000、注释原句）

### [WRONG-GENERIC] install-resolution-traps.md L4：头部写死“pnpm 12.8.1 + Node 24.4.1 实测”

- 现文：`全部结论均在本机 DSH 0.2.0-rc.2 + pnpm 12.8.1 + Node 24.4.1 环境实测验证。`
- 问题：Node 24.4.1 与本机其它文档（desktop-vs-cli L50 的 24.18.1/24.21.0）互斥，三者都是快照；版本号会随环境漂移，读者无法复现同一版本。
- 应为：`结论在 DSH 0.2.0-rc.2 + pnpm 11/12 + Node 24 系列环境实测验证；复现时以你本机实际版本为准。`（去掉精确到补丁的版本号）
- 证据：install-resolution-traps.md L4 与 desktop-vs-cli-runtime.md L50（版本互斥）

### [WRONG-GENERIC] install-resolution-traps.md L33：“本机捆绑 pnpm 11.7.0 与全局 12.8.1”及“285 个官方包零命中”

- 现文：`本机捆绑 pnpm 11.7.0 与全局 12.8.1 的 dist 默认块均为 `minimum-release-age: 24*60`…（本机 DSH 0.2.0-rc.2 全部 285 个 @deepseek-ai 运行时包与 dsh/lib 源码中 `minimumReleaseAge` 零命中）`
- 问题：捆绑/全局 pnpm 版本是该机发行版与全局安装快照；285 与真源 287 不符且数量漂移；“零命中”是单机单版本验证，升级即可能变化。
- 应为：`pnpm 11 起该配置的内建默认即 1440 分钟（`config get minimum-release-age` 返回 undefined 仅表示无显式配置）；冷却期由 pnpm 实现，不由 DSH 代码实现——宿主包内搜不到 `minimumReleaseAge` 属于预期`，删除版本号与 285。
- 证据：E:/newCC/APP/dsh/resources/runtime/primary-runtime/dependencies/pnpm/package.json（version 11.7.0）；desktop-runtime.json sharedPackages=287

### [WRONG-GENERIC] install-resolution-traps.md L42-44：“时间指纹”表格里的解析版本快照

- 现文：`T0 → 4.9.0-dsh.5 / T0+若干小时 → 4.10.0-dsh.1`
- 问题：这是某次实测当时的 registry 版本，且该表义正是“结果随时间前移”——示例版本号必然最快过期，读者会当成当前事实核对。
- 应为：保留“同一探针不同时刻结果前移”的机制陈述与表头，版本列改为占位（如 `<pkg>@<dfsh.旧版>`），或注明“示例取值仅为当时实测，随时间前移”。
- 证据：install-resolution-traps.md L38-46（表内版本）

### [WRONG-GENERIC] install-resolution-traps.md L85-86：单次实测解析版本与回退链数值

- 现文：`实测裸装解析到 `4.10.0-dsh.5` 而非 4.9.0`；`实测回退链落在…（age=180 → `.8`、age=1200 → `.5`、age=3000 → `.2`）`
- 问题：解析到的具体版本/序号随 registry 与时间前移，属单次实测快照；示例数字过时后会把读者导向早已不存在的版本。
- 应为：改为不写具体版本号的机制句：`pnpm 按发布时间取满足范围且已过冷却期的最近候选；阈值越长回退越前，阈值过长报 ERR_PNPM_NO_MATURE_MATCHING_VERSION`
- 证据：install-resolution-traps.md L85-86

### [WRONG-GENERIC] install-resolution-traps.md L170：BOM/CRLF 实测括注里的版本号

- 现文：`实测 pnpm 11.7.0 / 12.8.1 与 js-yaml/yaml 库对 BOM+CRLF+注释均正确解析（实测 `minimumReleaseAge: 0` 生效）`
- 问题：版本号属快照；机制结论（BOM/CRLF 不影响 pnpm YAML 解析）本身可保留。
- 应为：`pnpm 与 js-yaml/yaml 库对 BOM+CRLF+注释均正确解析，写完回读确认 `minimumReleaseAge: 0` 生效即可`（去掉版本号）
- 证据：install-resolution-traps.md L170

### [WRONG-GENERIC] packaging.md L216：“289 个细粒度包（0.2.0-rc.2 实测）”

- 现文：`DSH 核心生态包含 289 个细粒度包（0.2.0-rc.2 实测）`
- 问题：数量是本机安装快照（asar @deepseek-ai 目录 289，但 dsh/package.json 依赖 287），随版本必然变动，写死只会快速过时。
- 应为：`DSH 核心生态由数百个细粒度 @deepseek-ai 包组成（具体数量随版本变动，以运行时 desktop-runtime.json 的 sharedPackages 或包清单为准）`
- 证据：asar/dsh/node_modules/@deepseek-ai 目录数 289；asar/dsh/package.json dependencies=287；asar/dsh/desktop-runtime.json sharedPackages=287

### [WRONG-GENERIC] packaging.md L198：伪符号名 PLATFORM_MODULES（全库 0 命中）

- 现文：`浏览器模块表 `PLATFORM_MODULES` 提供运行时 react，不复用宿主实例`
- 问题：官方包全树 grep `PLATFORM_MODULES` 零命中——该符号名不存在，未来读者无法核对；真实机制是 Web 壳（dsh-web-frontend）引导时经 `create({ staticModules })` 注入平台种子表（含 react/react-dom/cordis 等）。
- 应为：`浏览器运行时 react 由 Web 壳引导时注入的平台种子表提供（不经 node_modules 安装），插件侧只需在自己的 devDependencies 声明 react`（删除 PLATFORM_MODULES 名字）
- 证据：grep "PLATFORM_MODULES" 全 @deepseek-ai 树 0 命中；dsh-web-frontend/dist/assets/index-*.js（staticModules: rM() → {react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis…}）；dsh-client-modules/lib/client.js:5-29（seed word 机制）

### [WRONG-GENERIC] packaging.md L50-66：把官方 monorepo 内部工程规约写进通用打包文档

- 现文：`### package.json 不变式（pnpm run constraints 强制）新增 workspace 包…`、`分组（core/llm/shell/…）是纯容器… tsconfig.host.json 或 tsconfig.client.json 二选一…`
- 问题：这些是 deepseek-harness 官方仓库贡献者的开发规约（workspace 布局、constraints 校验、tsc -b/tsdown 构建链），只对在官方仓库内加包成立；外部插件作者发布独立包时无此约束。作为通用技能，它把“官方仓库专属”冒充为“打包规范”。
- 应为：在节首加限定 `本节面向在 deepseek-harness 官方仓库内新增 workspace 包的贡献者；独立发布的第三方插件包只需满足通用的 package.json 契约（main/exports/files/dsh.bundle/dsh.client）`，或将本节移出通用文档。
- 证据：packaging.md L50-66；该节引用的 tsc -b/tsdown/aggregate 均为官方仓库构建链

### [WRONG-GENERIC] packaging.md L200：引用官方仓库内部路径 packages/client/tsdown.client.ts

- 现文：`生成它的 tsdown 预设只在仓库 `packages/client/tsdown.client.ts`，仓库之外需自行复刻`
- 问题：该路径是官方源码仓库文件，不随 npm 包发布（asar 全树 0 命中），读者无从查看。
- 应为：`生成它的 tsdown client 预设属于官方仓库内部构建产物，npm 包内不带源码；仓库之外需自行复刻同构配置`（去掉具体路径）
- 证据：grep "tsdown.client.ts" asar 全树 0 命中；packaging.md L200
