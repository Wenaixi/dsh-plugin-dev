# 插件打包、分发与工作区开发 (Packaging, Distribution & Workspace)

在 DeepSeek Harness（DSH）中，可安装与可分发的插件单元被称为**组合包（Bundle）**。Bundle 通过携带配置补丁向指定的**装配体（Profile）**贡献能力。本文件覆盖打包、安装、Profile 组合、git 安装授权与 Monorepo 工作区多包联调。

## 核心概念：Bundle vs Profile（互斥）

Bundle 与 Profile 职责截然不同，在 `package.json` 中携带互斥的 `dsh` 声明。官方模型读写域互斥（无读取器同时消费两类字段）：

| 实体 | 物理形态 | 清单声明 | 核心回答的问题 | 典型用法 |
| --- | --- | --- | --- | --- |
| **组合包 (Bundle)** | npm 包（可发布或本地包） | `dsh.bundle: { patch: ... }` | "这个包贡献什么能力与配置？" | 编写、发布、`dsh plugin add` 安装 |
| **装配体 (Profile)** | `$DSH_HOME/profiles/<name>` 目录 | `dsh.profile: { bundles: [...] }` | "当前运行实例由哪些 Bundle 按什么顺序叠加？" | `dsh --profile <name>` 启动 |

- Profile manifest **不需手写**：`dsh --profile <name> --from-default-profile` 或 `dsh plugin` 命令自动维护。
- 无 `dsh.bundle` 声明的包仍可安装，但只作普通依赖（打印警告、不激活配置层）。

## Bundle 目录结构与规范

标准 Bundle 的推荐文件组织（支持纯服务端插件与双面 Client-UI 插件）：

```
my-feature-plugin/
├── package.json          # 声明入口、依赖与 dsh.bundle 清单
├── cordis.patch.yml      # Profile 引入本 Bundle 时应用的配置补丁层
├── lib/
│   ├── index.js          # Node 宿主端入口（导出 apply(ctx)）
│   └── client.js         # (可选) Browser 前端入口（lazy-CJS factory）
└── README.md
```

### package.json 声明

```json
{
  "name": "dsh-my-feature",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": { "@deepseek-ai/dsh": ">=0.2.0-rc.1", "@deepseek-ai/cordis": ">=4.0.0" },
  "devDependencies": { "react": "^18.2.0", "@deepseek-ai/cordis": ">=4.0.0" }
}
```

- `dsh.client`：声明双面插件的前端半侧，字段为 `dsh.client.{platform, inject, external, immediately}`（无 `dsh.client.module` 之类的字段）。Host 侧 `clientModules` 服务扫描到此声明时，将其加入 `window.__DSH_BOOT__` 并开放 Combo 路由。
- `dsh.bundle.patch` 支持字符串路径（`"./cordis.patch.yml"`），也支持**有序文件数组**（`["./base.patch.yml", "./web.patch.yml"]`），按序作为同一层应用。
- patch 行按**包名**引用（`- insert: - { id: hello, name: 'dsh-hello-plugin' }`），不是文件路径。

### package.json 不变式（面向 deepseek-harness 官方仓库内新增 workspace 包的贡献者；独立发布的第三方插件包只需满足通用契约 main/exports/files/dsh.bundle/dsh.client）

新增 workspace 包（`packages/<group>/<pkg>/`）必须满足：

- `private: true`、version 与根一致、`type: module`。
- `main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`exports["."]` 同构（types + default）。
- `@deepseek-ai/cordis` **同时**出现在 peerDependencies 与 devDependencies（同版本范围）；每个 dsh peer 在 dev 镜像（唯一例外：dsh-terminal-bash 的 peer `dsh-session-projection` 未镜像进 dev）；用 schemastery 做 Config 校验的包（如 dsh-plugin-manager）放 dependencies；其余包（如 dsh-app-boot）只把它放 devDependencies。
- `files` 精确列表：dsh-* 生态包一般不含 src/声明映射/JS map（cordis 内核是例外，files 含 `src` 与 `.d.ts.map`、根 `bin.js`）；带 bin 的包由 files 覆盖其 bin 输出（dsh 主包用 `lib/*.js` 通配含 `lib/bin.js`）。
- 源码内相对导入用显式 `.ts` 后缀（JS 输出重写为 `.js`，声明保留 `.ts`）。

### 角色命名规则（官方）

- **单数 ctx 键**用于 engine / runtime / policy / controller / resolver / store / provider / backend / handle / config。
- **复数 ctx 键**用于 registry 或拥有多个具名成员的服务（如 `ctx.sessions`、`ctx.agents`）。
- 不兼容的 **host 与 client 不得复用同一个 Cordis Context 键**（TS 声明合并会同时看到两种类型）。
- 不要用首个实现 / 未来扩展 / Cordis 基类命名。
- 分组（core/llm/shell/compaction/subagent/todo/session/client/host/util/test-support）是纯容器：无 package.json、无源文件，包恰在其下一层；普通包只加入一个 aggregate（tsconfig.host.json 或 tsconfig.client.json 二选一，绝不两个都加；api/remotes 是特例不得仿照）。

## cordis.patch.yml 规范

Bundle 携带的补丁文件用于在装配树中挂载插件实例：

```yaml
- insert:
    - id: my-feature-entry
      name: 'dsh-my-feature'
      config:
        enabled: true
        maxConcurrency: 4
      disabled: false
```

## 生效配置层顺序（官方权威）

```
1. dsh.profile.bundles 各包的 patch（按列表顺序，先 @deepseek-ai/dsh-base）
2. profile 自身 cordis.patch.yml（$DSH_HOME/profiles/<name>/cordis.patch.yml）
3. $DSH_HOME/cordis.patch.yml（机器本地偏好）
4. 每个 --patch overlay（按 argv 顺序）
```

**关键语义（官方原文）**："后应用的层按行胜出，且 patch 会**替换**目标行的整个 config 值，**而不是深度合并各键**"。

- 覆盖前面某层的行必须**重述每一需要的键**，不能只写要改动的键。
- 用户可以在自己的 profile 覆盖你 bundle 的行而无需改包，因此应优先给出用户大概率保留的默认值。
- patch 只贡献配置，**不改变 loader 解析模块路径所用的 profile 目录**。

## 安装与卸载命令 (dsh plugin CLI)

```bash
# 向 web profile 添加已发布的 npm 插件包（--profile 必填，宿主 CLI 无"默认 profile"概念）
dsh plugin --profile <profile> add dsh-my-feature

# 向特定 profile 添加
dsh plugin --profile demo add ./hello-plugin

# 验证合并配置树
dsh --profile demo --dump-config

# 从 profile 中移除
dsh plugin --profile demo remove dsh-hello-plugin

# 从本地 tarball 安装
dsh plugin --profile <profile> add ./hello-plugin-0.1.0.tgz
```

### git 安装与构建授权

`dsh plugin --profile demo add github:you/hello-plugin` 拉取的是**源码而非构建产物**：

- 作者需提供**自包含的 `prepare` 脚本**（从源码构建）。
- 在 profile 的 `pnpm-workspace.yaml` 配置 `allowBuilds: { dsh-hello-plugin: true }` 授权 pnpm 11 执行依赖构建脚本（构建脚本被默认忽略时报 `ERR_PNPM_IGNORED_BUILDS`；键必须是精确包名、拒绝通配），否则安装被拦（视为安装时执行代码，建议锁 commit `#<sha>`）。
- 不想授权则发 npm（publish 时构建 lib/）或 tarball。

### 兼容门禁与精确版本豁免（allow-version 命令族）

插件对 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 peer 声明是**兼容门禁**：启动时对每个 bundle 做 peer 预检（`workspace:*` 等协议按当前运行时解析；其余范围用 semver 含预发布版本判断），不兼容且未豁免的 bundle **启动时跳过**；安装时（`dsh plugin` 转发的 add/install/i）在 pnpm 运行**之前**预检清单，不兼容直接拒绝安装、一个都不装（INSTALL_COMMANDS 不含 update）；`update` 走的是安装后兼容复查路径，不合格则恢复 `package.json`/`pnpm-lock.yaml` 并 repair。

豁免用精确版本命令族管理，豁免记录独立存于 profile 的 `compatibility.json`（与 package manifest、patch 无关）：

```bash
dsh plugin --profile <profile> allow-version <pkg>@<版本> --dsh-version <DSH 版本> --accept-risk
dsh plugin --profile <profile> revoke-version <pkg>@<版本> --dsh-version <DSH 版本>
dsh plugin --profile <profile> version-exemptions   # 列出当前豁免
```

- 豁免键是精确的 `package@version`，`--dsh-version` 必须是含预发布与构建元数据的精确 SemVer；`allow-version` 需要 `--accept-risk` 显式确认。
- CLI 豁免命令不卸载也不重载；从运行中的 GUI 管理器豁免时，若启用了 HMR 会热重载。

### 表层组合包自持 CLI

组合包可自带 CLI：插件 `inject = ['cmdlineArgs']`，用 `@deepseek-ai/dsh-cmdline` 的 `parseCmdline` 建立 commander program；行配置可写 `port: !!js ctx.myAppStartup.port ?? 8080` 回退；`--help` 时提供方不发布服务、该行不激活。

## 工作区开发与多包联调

DSH 原生基于 pnpm，支持 pnpm workspace 规范与多包联动开发。

### 工作区结构

```
my-dsh-workspace/
├── pnpm-workspace.yaml
├── package.json
└── packages/
    ├── dsh-plugin-foo/        # 插件 A（含 dsh.bundle 声明）
    │   ├── package.json
    │   ├── cordis.patch.yml
    │   └── src/index.ts
    └── dsh-plugin-bar/        # 插件 B
```

### 在 Profile 中联调本地工作区插件

**方式 A：相对路径引用（推荐）**：

```bash
cd $DSH_HOME/profiles/web
pnpm add C:/path/to/my-dsh-workspace/packages/dsh-plugin-foo
```

随后在 profile 的 `dsh.profile.bundles` 数组追加包名 `dsh-plugin-foo`（或交给 `dsh plugin` 自动维护）。

**方式 B：pnpm link 软链联调**：

```bash
cd /path/to/my-dsh-workspace/packages/dsh-plugin-foo
pnpm link --global
cd $DSH_HOME/profiles/web
pnpm link --global dsh-plugin-foo
```

### 开发态构建与实时 HMR

```json
{
  "scripts": {
    "build": "tsc -b && tsdown",
    "dev": "tsdown --watch"
  }
}
```

- **服务端 Node 插件**：`root: []`（只监听 profile 配置层）是 dsh-base 的 hmr 行显式配置；`dsh-hmr` 插件自身默认 `root: ["."]`。要让源码热更，需在 profile patch 给 `hmr` 行配 `root: ["."]` 使其监听模块根；`cordis.patch.yml` 变更始终触发配置重载（HMR = 卸载旧实例 → 加载新实例，注册皆 effect 自动清理）。
- **客户端 UI 插件**：`@deepseek-ai/dsh-client-hmr` 对每个 graph 行的 client bundle 做 stat 轮询（默认 `pollIntervalMs: 500`，设计上就是轮询，网络挂载不产生 inotify 事件），变更后经 SSE `/plugins/events`（graph/rebuilt 帧）推送热替换；开发期另有 dev watcher 先重建 bundle。不刷新页面完成组件与样式更新。

### 多包发布最佳实践

1. **统一类型定义**：共享类型抽离至纯类型包或根模块导出，避免跨包循环依赖。
2. **peerDependencies 严格解耦**：只把 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-*` 系列声明为 peerDependencies；`react` 一律放 devDependencies——官方包全部如此（57 个含 react 的包 peer 计数为 0），浏览器运行时 react 由 Web 壳引导时注入的平台种子表（staticModules）提供，插件侧只需在自己的 devDependencies 声明 react。
3. **发布前校验**：`files` 显式包含编译后的 `lib/` 与 `cordis.patch.yml`，避免遗漏关键补丁。
4. **client 半侧挂载规则**：浏览器半侧**只挂在说明符恰为裸包名的那一行上**；子路径导出挂载的行永远不带半侧。拆成多行的组合包，其半侧留在根行，注册的每个页面随根行关闭而消失；需在其他行关闭时仍保留页面的子插件应作为**独立包**发布。`./client` 必须是客户端模块系统的 lazy-CJS factory 格式；生成它的 tsdown client 预设属于官方仓库内部构建产物，npm 包内不带源码；仓库之外需自行复刻同构配置。
5. **产物注册的 id 必须等于包名**：客户端产物那句 `window.__ModuleLoader__.load({ id, factory })` 的 `id` 要与 `exports["./client"]`
   所属的裸包名逐字一致。不一致时组合批次跑完但没注册成功，启动遮罩报
   `loaded without registering "<id>"` / `already executed without registering "<id>"`，整条 client bundle 不激活。
   门禁：构建后从产物 grep 出 `load({ id:` 的字面量，与 `package.json` 的 `name` 断言相等。完整取证见
   [client-bundle-loading-and-artifact-trace.md](./client-bundle-loading-and-artifact-trace.md)。
6. **发布白名单（files）与多语言 README 404 陷阱**：
   开源插件通常同时维护双语说明文档（如 `README.md` 与 `README.zh.md`），并在两份文档顶部互置跳转链接。
   npm 的打包规则是：默认无条件打入标准 `README.md`，但**绝不会自动识别多语言变体**！
   若在 `package.json` 声明了 `"files"` 白名单且遗漏了 `"README.zh.md"`，打出的 tarball 中将彻底丢失中文文档，导致用户在 npm 线上网页或解压阅读时点击语言切换链接直接触发 **404 死链**。
   **规避法则**：凡在文档中有互跳链接的说明文件，必须在 `package.json` 的 `"files"` 数组中逐一显式列出，并在发布前的 `pnpm pack --dry-run` 清单中建立自动断言。

## 安装与依赖陷阱避坑指南 (npm & pnpm Pitfalls)

在安装 DSH 插件或进行多包联调时，由于 DSH 的微内核多包架构与严格单例设计，极易触发以下两大包管理器陷阱：

### 1. peer 依赖冲突（官方处理链路是 pnpm）

- 官方包管理链路是 **pnpm**：`dsh plugin` 只负责解析参数并把其余命令转发给 pnpm，profile 本身就是一个 pnpm workspace。全库不依赖 `npm --legacy-peer-deps` 或 `.npmrc` 的 `legacy-peer-deps=true`（官方包内零处出现该配置）。
- profile 初始化的 `pnpm-workspace.yaml` 模板显式设置 `autoInstallPeers: false`，peer 不自动安装。
- peer 冲突的官方处理是**兼容门禁 + 精确版本豁免**：安装前预检拒绝、启动时跳过（见下文"兼容门禁与精确版本豁免"），而不是放宽解析器。

### 2. pnpm 内存溢出 (OOM) 陷阱与性能优化

- **现象**：在 Profile 目录或大型 monorepo 中执行 `pnpm install` 或 `pnpm run build` 时，Node.js 进程卡死并崩溃，报错：`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`。
- **根本原因**：
  - **超深依赖拓扑**：DSH 核心生态包含数百个细粒度包（精确清单以运行时 `desktop-runtime.json` 的 `sharedPackages` 为准），深层依赖符号链接图极其庞大复杂。
  - **V8 默认堆内存限制**：Node.js 默认分配给 V8 的最大堆内存通常仅 1.4GB ~ 2GB。pnpm 在全量计算符号链接图、跨包校验依赖一致性、或 tsc 同时编译数十个包的双面 bundle 时，内存极易被打爆。
- **避坑与解决实操**：
  1. **临时/全局提高 Node.js 内存上限**：设置环境变量 `NODE_OPTIONS="--max-old-space-size=8192"`（提升至 8GB 堆内存）。
  2. **避免盲目全局 pnpm link**：优先采用基于 `pnpm-workspace.yaml` 的 Monorepo 相对路径安装或 `pnpm add ./packages/<pkg>`，利用 pnpm 的硬链接与虚拟 store 机制节省内存。
  3. **定向过滤构建 (Filtered Build)**：使用 `pnpm --filter <pkg> run build` 精准针对目标包构建，严禁在根目录无脑并发打包整个 monorepo。
  4. **pnpm 11 构建脚本授权**：依赖构建脚本被 pnpm 默认忽略时报 `ERR_PNPM_IGNORED_BUILDS`（这是构建授权问题，**不是 OOM 对策**），需在 Profile 的 `pnpm-workspace.yaml` 显式配置 `allowBuilds: { "<package-name>": true }`；键必须是精确包名、拒绝通配符。

## scoped 化改名清单（`name` 改 `@scope/pkg` 时六处必须同步）

把插件包名从裸名改成 scoped（或反过来）时，包名会出现在六个独立位置，**任何一处漏改都是静默失效**，且症状各不相同：

| # | 位置 | 漏改的症状 |
| --- | --- | --- |
| 1 | `cordis.patch.yml` 的 `name:` | 整文件 YAML 解析失败（裸 `@` 开头），`dsh plugin add` 回滚、`pnpm add` 报错（见 config.md 1.5） |
| 2 | 客户端构建脚本的注册 id（tsdown `ID` / 产物 `id:`） | 浏览器报 `loaded without registering`，整条 client bundle 不激活（见 client-bundle-loading-and-artifact-trace.md） |
| 3 | `plugins.bundle.config` 插槽注册的 `key` | 插件页配置区**连容器都不渲染**且零报错（配置区渲染门按包名匹配） |
| 4 | profile 的 `dsh.profile.bundles` | 启动时 `cannot resolve profile bundle`，插件整条跳过 |
| 5 | `exports` / `files` / peer 声明里的旧名 | 组合 URL 404 或安装链解析到旧包 |
| 6 | README 徽章/安装命令/`plugin add` 文档 | 用户照文档装到不存在的包名（镜像里旧包还在，误导更强） |

改名后逐项核对：`npm pack --dry-run` 看 tarball 里的 `package.json` 与 `cordis.patch.yml`，再在隔离 profile 里走一遍「add → 启动 → 浏览器看注册 id」三查。六处全部一致才算 scoped 化完成。

## 常见误解

- 把 patch 当作深合并——它是整行 config **整体替换**。
- 认为 bundle 可以同时是 profile——两者 manifest 互斥。
- 认为 git 安装拿来即用——需要 prepare 脚本与 allowBuilds 授权。
- 认为多行挂载的组合包每行都带半侧——半侧只在裸包名行。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.4
apps/cli  <-  @deepseek-ai/dsh@0.2.0-rc.2
packages/boot/app-boot  <-  @deepseek-ai/dsh-app-boot@0.2.0-rc.2
packages/bundle/base  <-  @deepseek-ai/dsh-base@0.2.0-rc.2
packages/client/hmr  <-  @deepseek-ai/dsh-client-hmr@0.2.0-rc.2
packages/boot/cmdline  <-  @deepseek-ai/dsh-cmdline@0.2.0-rc.2
packages/boot/hmr  <-  @deepseek-ai/dsh-hmr@0.2.0-rc.2
packages/boot/plugin-manager  <-  @deepseek-ai/dsh-plugin-manager@0.2.0-rc.2
packages/session/session-projection  <-  @deepseek-ai/dsh-session-projection@0.2.0-rc.2
packages/terminal/terminal-bash  <-  @deepseek-ai/dsh-terminal-bash@0.2.0-rc.2
packages/workspace/workspace  <-  @deepseek-ai/dsh-workspace@0.2.0-rc.2
```