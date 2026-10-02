# 插件打包、分发与工作区开发 (Packaging, Distribution & Workspace)

在 DeepSeek Harness (DSH 0.2.0-rc.2) 中，可安装与可分发的插件单元被称为**组合包（Bundle）**。Bundle 通过携带配置补丁向指定的**装配体（Profile）**贡献能力。本文件覆盖打包、安装、Profile 组合、git 安装授权与 Monorepo 工作区多包联调。

## 核心概念：Bundle vs Profile（互斥）

Bundle 与 Profile 职责截然不同，在 `package.json` 中携带互斥的 `dsh` 声明。官方原文："**没有东西同时是两者**"：

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
  "peerDependencies": { "@deepseek-ai/dsh": ">=0.2.0-rc.1" }
}
```

- `dsh.client`：声明双面插件的前端半侧（`platform: "web"`）。Host 侧 `clientModules` 服务扫描到此字段时，将其加入 `window.__DSH_BOOT__` 并开放 Combo 路由。
- `dsh.bundle.patch` 支持字符串路径（`"./cordis.patch.yml"`），也支持**有序文件数组**（`["./base.patch.yml", "./web.patch.yml"]`），按序作为同一层应用。
- patch 行按**包名**引用（`- insert: - { id: hello, name: 'dsh-hello-plugin' }`），不是文件路径。

### package.json 不变式（pnpm run constraints 强制）

新增 workspace 包（`packages/<group>/<pkg>/`）必须满足：

- `private: true`、version 与根一致、`type: module`。
- `main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`exports["."]` 同构（types + default）。
- `@deepseek-ai/cordis` **同时**出现在 peerDependencies 与 devDependencies（同版本范围）；每个 dsh peer 在 dev 镜像；`@deepseek-ai/schemastery` 放 dependencies（运行时校验器）。
- `files` 精确列表（lib/index.js + lib/types/**/*.d.ts；不发布 src/声明映射/JS map）；带 bin 的包在 files 中紧跟 lib/bin.js。
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
# 向默认 web profile 添加已发布的 npm 插件包
dsh plugin add dsh-my-feature

# 向特定 profile 添加
dsh plugin --profile demo add ./hello-plugin

# 验证合并配置树
dsh --profile demo --dump-config

# 从 profile 中移除
dsh plugin --profile demo remove dsh-hello-plugin

# 从本地 tarball 安装
dsh plugin add ./hello-plugin-0.1.0.tgz
```

### git 安装与构建授权

`dsh plugin --profile demo add github:you/hello-plugin` 拉取的是**源码而非构建产物**：

- 作者需提供**自包含的 `prepare` 脚本**（从源码构建）。
- pnpm >= 10 的用户须在 profile 的 `pnpm-workspace.yaml` 配置 `allowBuilds: { dsh-hello-plugin: true }` 授权（视为安装时执行代码，建议锁 commit `#<sha>`）。
- 不想授权则发 npm（publish 时构建 lib/）或 tarball。

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

- **服务端 Node 插件**：在 `web` profile 中经 `cordis.patch.yml` 变更触发配置重载（HMR = 卸载旧实例 → 加载新实例，注册皆 effect 自动清理）。
- **客户端 UI 插件**：`@deepseek-ai/dsh-client-hmr` 监听到 `lib/client.js` 变更后经 SSE 推送热替换，不刷新页面完成组件与样式更新。

### 多包发布最佳实践

1. **统一类型定义**：共享类型抽离至纯类型包或根模块导出，避免跨包循环依赖。
2. **peerDependencies 严格解耦**：`@deepseek-ai/cordis`、`@deepseek-ai/dsh`、`react` 声明为 peerDependencies，确保运行时加载宿主统一实例。
3. **发布前校验**：`files` 显式包含编译后的 `lib/` 与 `cordis.patch.yml`，避免遗漏关键补丁。
4. **client 半侧挂载规则**：浏览器半侧**只挂在说明符恰为裸包名的那一行上**；子路径导出挂载的行永远不带半侧。拆成多行的组合包，其半侧留在根行，注册的每个页面随根行关闭而消失；需在其他行关闭时仍保留页面的子插件应作为**独立包**发布。`./client` 必须是客户端模块系统的 lazy-CJS factory 格式；生成它的 tsdown 预设只在仓库 `packages/client/tsdown.client.ts`，仓库之外需自行复刻。

## 安装与依赖陷阱避坑指南 (npm & pnpm Pitfalls)

在安装 DSH 插件或进行多包联调时，由于 DSH 的微内核多包架构与严格单例设计，极易触发以下两大包管理器陷阱：

### 1. npm install --legacy-peer-deps 陷阱与根因

- **现象**：直接运行 `npm install` 安装插件或依赖时，频繁抛出 `npm ERR! ERESOLVE unable to resolve dependency tree` 并阻断安装。
- **根本原因**：
  - DSH 规范强制将 `@deepseek-ai/cordis`、`@deepseek-ai/dsh` 以及 `react` 声明为 `peerDependencies`，以保证全局运行时仅存在单一实例。
  - npm 7+ 默认开启了严格的 peerDependencies 自动安装与深层依赖图推导。当多个插件或间接依赖声明的 peer 版本范围存在微小的边界不重合，或者与全局安装树形成菱形依赖时，npm 会拒绝安装。
- **规避与应对指南**：
  1. **使用 `--legacy-peer-deps` 参数**：`npm install <plugin-package> --legacy-peer-deps`（回退到跳过严格 peer 冲突校验的经典行为）。
  2. **在项目或 Profile 根目录配置 `.npmrc`**：写入 `legacy-peer-deps=true`。
  3. **优先使用 DSH 官方 CLI 安装**：`dsh plugin add <package-name>`（官方 CLI 内部会安全调度包管理器并自动维护 Profile 的 cordis 补丁层）。

### 2. pnpm 内存溢出 (OOM) 陷阱与性能优化

- **现象**：在 Profile 目录或大型 monorepo 中执行 `pnpm install` 或 `pnpm run build` 时，Node.js 进程卡死并崩溃，报错：`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`。
- **根本原因**：
  - **超深依赖拓扑**：DSH 核心生态包含 260+ 个细粒度包，深层依赖符号链接图极其庞大复杂。
  - **V8 默认堆内存限制**：Node.js 默认分配给 V8 的最大堆内存通常仅 1.4GB ~ 2GB。pnpm 在全量计算符号链接图、跨包校验依赖一致性、或 tsc 同时编译数十个包的双面 bundle 时，内存极易被打爆。
- **避坑与解决实操**：
  1. **临时/全局提高 Node.js 内存上限**：设置环境变量 `NODE_OPTIONS="--max-old-space-size=8192"`（提升至 8GB 堆内存）。
  2. **避免盲目全局 pnpm link**：优先采用基于 `pnpm-workspace.yaml` 的 Monorepo 相对路径安装或 `pnpm add ./packages/<pkg>`，利用 pnpm 的硬链接与虚拟 store 机制节省内存。
  3. **定向过滤构建 (Filtered Build)**：使用 `pnpm --filter <pkg> run build` 精准针对目标包构建，严禁在根目录无脑并发打包整个 monorepo。
  4. **pnpm >= 10 构建脚本授权**：在 Profile 目录的 `pnpm-workspace.yaml` 中显式配置 `allowBuilds: { "<package-name>": true }`。

## 常见误解

- 把 patch 当作深合并——它是整行 config **整体替换**。
- 认为 bundle 可以同时是 profile——两者 manifest 互斥。
- 认为 git 安装拿来即用——需要 prepare 脚本与 allowBuilds 授权。
- 认为多行挂载的组合包每行都带半侧——半侧只在裸包名行。
