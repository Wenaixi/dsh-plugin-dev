# 三角色架构模型与 Client-UI 插件开发标准

DeepSeek Harness (DSH 0.2.0-rc.2) 采用清晰的物理分层与进程隔离架构：**Browser 界面端**、**Host 核心宿主** 与**隔离进程沙箱区**（教学名；源码中 Worker 专指 worker_threads）。前端 Web GUI 同样是运行在浏览器中的 Cordis 运行时，所有含界面的插件均采用"双面插件"（Dual-Face Architecture）规范。

```
┌────────────────────────────────────────────────────────┐
│               Browser 角色 (Web GUI 前端)               │
│  - React 渲染层 + 浏览器端 Cordis 运行时                 │
│  - Slots 插槽系统 + ctx.remote 通信网络                 │
└───────────────────────────▲────────────────────────────┘
                            │
        HTTP POST /api/* (一元 RPC) + Remote 流式长连接
                            │
┌───────────────────────────▼────────────────────────────┐
│              Host 角色 (服务端 Node.js 宿主)             │
│  - 核心 Cordis 运行时（ctx.sessions / ctx.tools /       │
│    ctx.agents / ctx.llm / ctx.settings 等）             │
│  - ctx.webServer、ctx.clientModules（__DSH_BOOT__ 图）   │
└───────────────────────────▲────────────────────────────┘
                            │
     ctx.subprocess (spawn / spawnTerminal) + 沙箱 confine
                            │
┌───────────────────────────▼────────────────────────────┐
│              隔离进程角色 (subprocess / 沙箱隔离区)          │
│  - 独立运行的 Subprocess / Native Runner               │
│  - PowerShell / Bash / Python / 重计算任务沙箱          │
└────────────────────────────────────────────────────────┘
```

## 目录

- [三大角色的物理边界与职责](#三大角色的物理边界与职责)
- [前端插件的双面架构 (Dual-Face Architecture)](#前端插件的双面架构-dual-face-architecture)
- [浏览器端插件加载、Slots 插槽与样式管理](#浏览器端插件加载slots-插槽与样式管理)
- [进程间通信 (IPC) 协议](#进程间通信-ipc-协议)
- [常见误解](#常见误解)

---

## 三大角色的物理边界与职责

| 角色 | 运行环境 | 核心职责 | 权限与安全边界 |
| --- | --- | --- | --- |
| **Browser** | 浏览器或桌面内嵌 Webview | 用户界面渲染、流式 Markdown 显示、输入捕获 | 零本地文件系统与系统调用权限，所有交互受浏览器安全沙箱与 Host API 约束 |
| **Host** | 操作系统常驻 Node.js 进程 | 运行核心 Cordis 总线、调度工具执行、持久化存储、Web 服务器 | 具备完整的服务端宿主权限 |
| **隔离进程**（源码中 Worker 一词专指 worker_threads，勿混用） | 隔离子进程（Native Runner） | 执行高风险外部命令、计算密集型数据处理、脚本沙箱 | 受文件效果沙箱（bwrap/Landlock、Seatbelt、Windows ACL）限制 |

## 前端插件的双面架构 (Dual-Face Architecture)

所有涉及 Web UI 界面的插件必须同时提供 Node 宿主半侧与 Browser 界面半侧：

- **Node 宿主半侧（`lib/index.js`）**：导出 `apply(ctx: Context): void`。即使插件无服务端逻辑，空实现 `apply()` 也必须存在，确保插件能注册进宿主 Loader 条目树。
- **Browser 界面半侧（`lib/client.js`）**：导出 `apply(ctx: ClientContext): void`，且必须是**客户端模块系统的 lazy-CJS factory 格式**（向页面模块加载器登记包名 + `factory(require)`）。

  加载器语义（来自 `@deepseek-ai/dsh-client-modules` 源码注释）：执行 bundle **只注册 factory**（`window.__ModuleLoader__.load({id, factory})`），模块体的全部副作用——包括 CSS 注入——都发生在 factory 闭包内，**物化时才运行**，而非脚本执行时。物化（`factory(require)` 返回 exports）在首次 import/require 时发生并记入 `loadCache`；factory 若 require 另一个已注册未物化的模块，会递归物化，因此加载顺序无需外部编排。

  解析分支顺序：seed word 命中 shell 实例 → 已物化记录直接返回 exports → 图行则注册依赖 factory 与自身 factory → 已注册 factory 则物化 → 其余情况**大声抛错**（构建期 bundle 纯度门禁的运行时镜像）。

  **硬约束**：factory 内是 CJS 作用域，不能出现 ESM `import`、顶层 `return`、JSX；依赖一律 `require`，收尾必须 `return module.exports`。三条各自对应的报错与可运行骨架见 [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md) 第 3 节。

### package.json 声明规范

```json
{
  "name": "@my-scope/dsh-client-ui-example",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "id": "client-ui-example", "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "module": "./lib/client.js",
      "inject": ["@deepseek-ai/dsh-client-ui-settings"]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.2.0-rc.1",
    "react": "^18.2.0"
  }
}
```

注意：client 端插槽运行时是 `dsh-client-ui-slots`（SlotCore 纯注册表）+ `dsh-client-ui-renderer`（slots 服务包装）；连接/传输由 `dsh-client-connection` 独立提供；设置 UI 是 `dsh-client-ui-settings`（注入 remote.settings）。三包在 0.2.0-rc.2 均独立存在，未合并。**浏览器半侧只挂在说明符恰为裸包名的那一行上**；子路径导出挂载的行永远不带半侧。

**真实契约（0.2.0-rc.2 全库实测，`dsh.bundle.id` 与 `dsh.client.module` 均不存在）**：双面包声明 `dsh.client.platform: "web"`（+ 可选 `inject`/`external`/`immediately`），客户端入口由 `exports["./client"]` 子路径导出（该路径必须真实存在）；组合补丁用 `dsh.bundle.patch`（路径或有序数组）。peerDependencies 以 `@deepseek-ai/cordis ~4.0.4` 为准 文件）。`exports` 也可以写成带条件导出对象的形式（`{ "types": ..., "default": "./lib/client.js" }`）。

## 浏览器端插件加载、Slots 插槽与样式管理

### 1. 启动图注入与惰性物化

- Host 的 `ctx.clientModules`（Node 半）扫描声明 `dsh.client` 的包，组合 `__DSH_BOOT__` 启动图（WebBootGraph）注入 HTML。
- 路由 `GET/HEAD /plugins/??<pkg>/client.js,<pkg>/client.js&rev=<rev>`（combo），rev 由 mtime/ctime/size 派生（跨重启稳定），URL ≤3KiB。
- 浏览器加载 bundle 只**注册 factory**，materialize entry 时才同步 require（惰性物化）；`ui-renderer` 只调一次 `renderSlot('root')`。
- HMR 仅经 `rebuilt(id)` / `onRebuilt` / `onGraphChanged` 达图；source map 变化不触发重载。

### 2. Slots 插槽系统（类型化 React 组合）

DSH Web GUI 禁止插件直接操作外部 DOM，所有组件注入必须通过 `ctx.slots`：

```tsx
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import React from 'react'

const MyFeatureChip: React.FC = () => <div className="my-feature-chip">Extra Action</div>

export function apply(ctx: ClientContext) {
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      // list 槽的 id 必须全局唯一：用自己的命名空间前缀，避免与真实注册冲突
      { name: 'conversation.input.right', id: 'my-plugin:feature-chip', order: 50 },
      MyFeatureChip
    )
  )
}
```

**两个独立维度**：

| 维度 | 取值 | 语义 |
| --- | --- | --- |
| cardinality | `single` | priority 胜者 |
| | `list` | 必填 id，先 order 后注册序 |
| | `keyed` | entryKey 定址 |
| | `chain` | 纯 select(owner) 函数，首个非 null 获选（matched 传入），全拒用 owner fallback |
| scope | `root` | 无会话依赖 |
| | `session-maybe` | 值可选 |
| | `session` | 必可解析 |

**组件输入 props**：`PropsRuntime`、`PropsRenderSlots`（含 SessionProvider）、`PropsStore`、`InjectFace`、`PropsLocale`、`matched`。

**组件绝不收到 ctx**：owner props 传父已知值、共享视图状态走声明的 store、service/model 留 apply closure 只投影 callback/observable。

**为什么组件不能拿到 ctx**：React 组件的生命周期由 React Fiber 驱动，而 Cordis 上下文有严格的局部依赖跟踪与可逆生命周期。把 `ctx` 当 Props 传进组件会造成闭包泄漏、HMR 无法正确解构上下文、以及跨作用域状态污染。组件所需状态全部经宿主插槽定义的 `props` 传入；需要触发服务端操作时，用 props 传入的回调函数，或经 Client 侧的 `ctx.remote` 通信。

#### 标准 Slot 层级（官方 slots 页）

```
root
├── sidebar.*            （.brand / .workspaces / .settings …）
├── main.*
│   ├── plugins.*
│   └── conversation.*   （conversation.session / view / chat.node / composer / input.*）
├── rightbar.session → sidebar.right.pane.tab
└── shell.*              （shell.leading / overlay）
```

已知注入点示例：`settings.general.item`、`settings.models.provider-card`、`settings.plugins.tab`、`main.conversation→conversation.session/view/chat.node/composer/input.*`、`rightbar.session→sidebar.right.pane.tab`、`shell.leading/overlay`。
#### 常用 Slot 标识清单（按层级）

| 层级 | Slot 标识 | Cardinality | Scope | 典型用途 |
| --- | --- | --- | --- | --- |
| `sidebar.*` | `sidebar.brand.mark` / `sidebar.brand.name` | single | root | 侧边栏品牌标记与名称（无独立的 `sidebar.brand` 槽） |
| | `sidebar.workspaces` | single | root | 工作区列表项 |
| | `sidebar.settings` | single | root | 侧边栏底部设置入口 |
| | `sidebar.panellist` / `sidebar.footer.action` | list / list | root | 面板列表与底部动作（不存在 `sidebar.files`/`sidebar.terminal`） |
| `main.*` | `main` | keyed | root | 主导航面板（`main.conversation` 为 single/session-maybe；不存在 `main.chat`） |
| | `conversation.session` | single | session | 会话状态外壳 |
| | `conversation.view` | list | session | 消息流呈现视口 |
| | `conversation.chat.node` | keyed | session | 消息节点渲染点（客户端 `renderSlot(..., { entryKey: routedNode.kind })` 逐节点渲染，不是 chain 包裹） |
| | `conversation.composer` | chain | session | 输入框下方功能区（select 首个非 null 胜） |
| | `conversation.input.attachments` | single | session-maybe | 输入框附加能力条 |
| `rightbar.*` | `sidebar.right.pane.tab` | keyed | session | 右侧抽屉栏扩展 Tab（其父级 `rightbar.session` 仍然存在，是声明方，并未被重命名） |
| `shell.*` | `shell.leading` | single | root | 侧栏收起时的窗口顶栏席位 |
| | `shell.overlay` | list | root | 全局模态框 / 浮层 |
| `settings.*` | `settings.general.item` | list | root | 常规设置条目 |
| | `settings.models.provider-card` | keyed | root | 模型提供方卡片（按 settingsNs 定址） |
| | `settings.plugins.tab` | list | root | 插件管理 Tab 面板 |
| | `settings.section` | list | root | 扩展设置区块 |

Cardinality 选错会导致重复渲染或完全不渲染；调试实时插槽树用 `cordis_inspect_list` 列出平台/提供方/方法，再 `cordis_inspect_query {platform:'client', provider:...}` 查询（不存在 `what:"client"` 语法）。

**标准 hooks**：全 scope 有 `useSessions` / `useSessionStatus` / `useSessionRetainInfo` / `useWorkspaces` / `usePanelInfo`；session 系另有 `sessionId` / `useSession` / `useProjection` / `useConversation` / `useInput` / `useChat` / `useTrajectory`；store 与 locale 推导 `useStore` / `t`。

**扩展规则**：

- 其他包只能 `import type`；只在拥有并渲染处声明新 child slot，他人 `inject + register`。
- `single` 与已占用的 keyed cell 是替换点；增量用新 list id / 未占 key。
- UI domain 间只传 JSON 兼容数据与 callback。
- 调试：`cordis_inspect what:"client"` 查看实时插槽树。

### 3. 样式管理与自动回收

- 组件样式由打包工具编译并内嵌；物化时创建带 `data-plugin` 属性的 `<style>` 标签。
- 插件禁用、卸载或 HMR 热替换时，`removeOwnedStyles()` 按包名精准移除相关样式。

## 进程间通信 (IPC) 协议

### 1. Browser ↔ Host IPC

由生成式 Remote（Typert）提供，契约在 api-gateway：

- 直接调用是 `ctx.remote.<namespace>` / `agentCtx.remote.<namespace>`（普通对象具体函数，非 Proxy）；`assembly` 经 `ctx.remote.$mount()` 挂载。
- **`@Remote('create')` 等注解才把方法开放给 Client**（未标记不能经 ctx.remote 调用）；`@RemoteScope('agent','current')` 先经 `ctx.typert.contexts` 解析作用域 Context。继承 `TypertRemoteService`（super(ctx,'goals') 绑 key+namespace）或 `bindTypertRemote(this, serviceKey)`。
- 方法签名硬约束：公开/非静态/有具体实现、不能泛型、参数具名必填简单标识符、**禁解构/默认值/rest/可选**。
- **协作取消**：Host 签名最后一个参数必须是 `signal: AbortSignal`（记于描述符而非 args）。
- 一元 RPC：`connection.rpc.call('/api','<ns>/<method>',{args},signal)` → HTTP `POST /api/<ns>/<method>`。
- **`@Remote({mode:'stream'})`**：返回 `Iterable/AsyncIterable/RemoteStream<Out,In>`，经 `/api/remote.mux` WebSocket 投递；Client 得 `ClientStreamHandle`（send/end/dispose，0.2.0-rc.2 中没有 `RemoteStreamHandle` 这个名字），上行经 `ctx.invocation.uplink<In>()` 读取。**这就是 remote.mux 的唯一合法用途（流式 Remote），不是通用多路复用总线**。
- `ctx.remote.$on()` 把 allowlist 事件交 root Context、scoped waterfall 事件交 Session Context（可返回结果 / next() / 拒绝）。
- 依赖声明归实际调用方：业务包 `inject` 须含 `['remote','remote.<ns>']`。
- 错误码：`gateway/lookup-unavailable`、`session/not-found`、`session/agent-busy`、未归类 → `gateway/internal`。
- 构建：`tsc -b tsconfig.host.json` → `tsdown --env.DSH_BUILD_FACE host`（Typert 生成器只在 Host 阶段跑一次）→ Client 阶段只消费生成声明；产物写包 `lib/`（typert.host.*、typert.remote-client.*），经 `./typert` 与 `./remote` 入口暴露；SRC 回退不读 TS 类型、不生成 Zod schema，Client 拒绝挂载无严格 codec 的 SRC 描述符。
- 浏览器侧 `ctx.sessions`（ClientSessions→SessionManager→Session）是 session-controller 的 Client 面镜像，不是 SessionLog 本体；`ctx.workspaces` 来自 workspace-controller。
- 重连：物理/逻辑独立；普通通知不重放；可靠恢复需 baseline/cursor/显式 query；`page()` 仅用于更早历史与 gap repair。架构中不存在 Client Runtime / HostFrame / `events.mux` / `events.host` / 通用 `resync()`。

### 2. Host ↔ Worker IPC

由 `@deepseek-ai/dsh-subprocess`（Definition）+ `dsh-subprocess-local`（Provider）管理：

- `ctx.subprocess.spawn(spec)` 同步返回活跃 handle；`spec.argv` 实施**严格的零 shell 解释 (Zero Shell Interpretation)**，argv[0] 直接传给系统 exec，绝不经过 cmd.exe / sh 解析；每条流处置（stdin/stdout/stderr/control）全部显式给出，seam 绝不应用任何隐式默认值。
- `SubprocessCollect`：`maxBytes` 溢出保 TAIL，可选 `spill: { maxBytes }` 落盘；offset reader `readFrom(fromByte)→{text; nextOffset; lossy; spillPath?}`，lossy 表示内存 tail 丢 head、完整流可从 spillPath 恢复。
- `spawnTerminal`：唯一非管道原语，提供方拥有终端分配/UTF-8/前台进程组/信号/整体清停（TERM→KILL 须等待）；就绪/scrollback/沙箱策略归 PTY 消费方。
- `DSH_*` 变量归 Harness：先丢弃环境已有 `DSH_*` 再合并显式 env；`undefined` tombstone 删普通环境值；env 字符串=有意凭据转发。
- `done` 只报 close 词汇（exitCode/signal），不带超时/取消分类（调用方读自己的 signal 判定）。

### 3. 进程沙箱 (ctx.sandbox)

- `SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`：**只管文件效果，网络与进程可见性不在此词汇内**。
- `danger-full-access` 直接 spawn 原始 argv、**不经过 ctx.sandbox**；只有两种 confined 模式可发提供方。
- 策略**逐调用携带**（per call），非固定在提供方：同时刻不同消费方可请求不同边界；已批准提权重试 = 更宽策略的新调用。
- `confine(argv, policy, signal?) → ConfinedArgv{ argv; enforcement: 'full'|'partial'; denialSignatures; runnerFailureRules }`；无后端 → `SandboxUnavailableError`；受限策略下静默无隔离透传永不合法（fail-closed）。
- deny 判定：allowedExitCodes 门控 → informationalLines 整行排除 → fatalSignatures 匹配；**退出状态永不能证明 runner 失败**（runner failure=命令从未执行，denial=沙箱正常拦截）。
- 后端方言：EROFS/bwrap、EACCES/Landlock、EPERM/Seatbelt；Windows ACL 属 partial（硬链接/读不受限/AppContainer 边界）。
- `ctx.sandboxPolicy.resolve()` 优先级：显式已批准 mode > 会话最近 sandbox/mode 事件 > 部署默认。

## 常见误解

- 把 `presentCall` / `presentResult` 当作 Web Client 的渲染入口——内置 Web Client 不消费它们；Session 页运输原始 `tool/call`、`tool/result` 事件，Client 插件在 keyed slot `tool.call.toolview` 注册自己的 wire 工具名。
- 把 slot 组件做成直接拿 `ctx`——组件绝不收到 ctx。
- 以为 `SandboxMode` 管控网络——它只管文件效果。
- 误以为全部 browser↔host 通信或事件广播都依赖一个通用的 WebSocket 事件总线（如臆造的 events.mux / events.host）——当前官方架构是：一元 RPC 严格走 HTTP POST `/api/<namespace>/<method>`；只有标记为流式的方法（@Remote({mode:'stream'})）才通过 `/api/remote.mux` 长连接传输；架构中绝对不存在 Client Runtime、HostFrame、events.mux、events.host 或通用 resync()。