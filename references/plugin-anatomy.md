# 插件解剖学 (Plugin Anatomy)

在 DeepSeek Harness (DSH) 中，一切能力皆为插件。Cordis 插件是一等公民对象，通过声明依赖（`inject`）、提供或消费服务、监听或分发事件，向运行上下文注入功能。本文件是插件开发的核心枢纽：涵盖插件形态、Context 上下文 API、作用域、可逆副作用与生命周期、核心能力切面（Seam）依赖倒置，以及设置表单与配置持久化契约。

## 1. 插件三种形态

官方权威定义：**插件是导出 `apply` 的 TypeScript 模块**，框架加载时以 `ctx`（上下文对象）调用它来注册能力。

### 1.1 函数插件 (Function Plugin)

适用于大多数无状态扩展、工具注册、事件拦截或轻量业务集成：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

// 1. 显式插件标识（必须与导出同名）
export const name = 'my-greeting-plugin'

// 2. 静态依赖声明（确保服务已就绪后 apply 才执行）
export const inject = ['tools']

// 3. 强类型配置定义与 Schema 校验（默认值写在 Schema 内）
export interface Config {
  prefix: string
  repeat: number
}

export const Config: Schema<Config> = Schema.object({
  prefix: Schema.string().default('Hello'),
  repeat: Schema.number().default(1),
})

// 4. 应用入口函数
export function apply(ctx: Context, config: Config) {
  // apply 在所有 inject 声明的服务就绪后同步执行
  ctx.tools.register({
    name: 'greet',
    description: 'Output a customized greeting',
    parameters: { name: { type: 'string', required: true } },
    async execute(args) {
      return `${config.prefix}, ${args.name}!`.repeat(config.repeat).trim()
    },
  })

  // 注册的副作用（事件监听器、工具等）受 ctx 作用域管理，卸载时自动回滚
}
```

### 1.2 对象插件 (Object Plugin)

等价于函数形式，适用于希望把 name/inject/apply 聚合在同一对象的场景：

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // ...
  },
}
```

### 1.3 服务类插件 (Service Class Plugin)

适用于管理长生命周期资源、对外公开专属服务方法、或维护复杂运行时状态的场景。当插件需要向其他插件提供服务时使用类形式：

```ts
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskQueue: TaskQueueService
  }
}

export interface TaskQueueConfig {
  concurrency: number
}

export class TaskQueueService extends Service {
  static inject = ['sessions']
  static Config: Schema<TaskQueueConfig> = Schema.object({
    concurrency: Schema.number().default(5),
  })

  private runningCount = 0

  constructor(ctx: Context, public config: TaskQueueConfig) {
    // 第二个参数是挂载到 ctx 上的服务键名（name 即 ctx 挂载键）
    super(ctx, 'taskQueue', true)
  }

  protected override start(): void | Promise<void> {
    // 所有依赖就绪后调用；返回 Promise 时下游插件保持等待
  }

  protected override stop(): void | Promise<void> {
    // 优雅停机、释放连接池或未完成任务
  }

  public enqueue(task: () => Promise<void>) {
    // 公开的业务能力
  }
}

export const name = 'task-queue-service'

export function apply(ctx: Context, config: TaskQueueConfig) {
  ctx.plugin(TaskQueueService, config)
}
```

**服务生命周期契约**：
- **构造阶段**：`super(ctx, name)` 后服务立即注册到 `ctx.<name>`，并随所属 fiber 自动移除（无需手动注销）。
- **start() 钩子**：所有依赖就绪后调用。若返回 Promise，依赖该服务的下游插件会保持等待。
- **stop() 钩子**：服务所属插件被卸载或环境退出时触发。
- 服务内部注册的事件与 `ctx.effect()` 资源均与 fiber 生命周期绑定，卸载时自动注销。

## 2. 双面插件模型 (Dual-Face Plugin Anatomy)

在 DSH Web GUI 体系中，凡是需要贡献前端界面（如自定义侧边栏、聊天节点视图、设置表单卡片、状态指示器）的插件，均遵循**双面插件 (Dual-Face Architecture)** 规范：

```
+----------------------------------------------------------+
|                    Dual-Face Plugin                      |
+----------------------------+-----------------------------+
|        Host 半侧           |         Client 半侧         |
|      (Node.js 宿主)        |      (Browser 渲染层)       |
+----------------------------+-----------------------------+
| lib/index.js               | lib/client.js               |
| export apply(ctx)          | export apply(ctx)           |
| Cordis 服务 / 工具注册      | ctx.slots.inject 插槽组件   |
+----------------------------+-----------------------------+
```

### 2.1 物理结构与 package.json 声明

双面插件在 `package.json` 中必须同时声明主入口与 `./client` 导出，并提供 `dsh.client` 配置块：

```json
{
  "name": "@my-scope/dsh-my-plugin",
  "version": "0.1.0",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=0.2.0-rc.2",
    "@deepseek-ai/dsh": ">=0.2.0-rc.2",
    "react": ">=18.0.0"
  }
}
```

- **Host 半侧 (`lib/index.js`)**：导出 `apply(ctx)`。由服务端 Cordis Loader 在 Node 进程中挂载，负责注册工具、监听核心事件、发布 Remote 服务。
- **Client 半侧 (`lib/client.js`)**：导出 `apply(ctx)`。由浏览器端独立的 Cordis 运行时加载，负责插槽组件注入与界面交互。

### 2.2 惰性 CJS Bundle 与物化机制 (Materialization)

1. **构建输出**：执行 `tsc -b && tsdown` 时，Client 半侧代码被打包为一个惰性 CJS bundle。
2. **注册契约**：脚本加载时，仅向全局加载器注册工厂函数：`window.__ModuleLoader__.load({ id, factory })`，此时**不执行模块体代码，也不注入 CSS**。
3. **按需物化**：当模块首次被消费（`import` 或 `require`）时，工厂函数被调用并缓存 (`loadCache`)。样式代码编译在 bundle 内部，物化时自动挂载带 `data-plugin` 属性的 `<style>` 标签。
4. **HMR 自动回收**：插件卸载或热重载时，旧 fiber 及其拥有的 style 标签被 `removeOwnedStyles()` 精确清理。

### 2.3 启动图注入与 Combo 路由

- **启动图注入 (`window.__DSH_BOOT__`)**：Host 端的 `ctx.clientModules` 动态扫描所有声明了 `dsh.client` 且处于启用状态的插件，生成依赖图，直接内联注入到 HTML `<head>` 的 `window.__DSH_BOOT__` 清单中。
- **Combo 批量路由**：浏览器通过单条多路复用请求按需批量下载插件脚本，路径格式为：
  ```
  /plugins/??<id1>/client.js,<id2>/client.js&rev=<composite-rev>
  ```
  受系统常量 `MAX_COMBO_URL_BYTES` 保护，若依赖插件列表超长则自动分页切分。

### 2.4 Slots 插槽体系与组件无 ctx 铁律

UI 插件绝不能直接操作宿主 DOM，必须通过插槽系统向宿主预设点位挂载 React 组件：

```tsx
// lib/client.tsx (Client 半侧)
import type { Context } from '@deepseek-ai/cordis'
import React from 'react'

export function apply(ctx: Context) {
  // 注入到会话输入框附加区域
  ctx.slots.inject('conversation.input.attachments', () =>
    ctx.slots.register(
      {
        order: 100, // 排序权重
      },
      // 核心铁律：React 组件绝不能接收 ctx！
      // 只能接收宿主插槽传入的类型化 Props 或回调函数
      ({ sessionId, disabled }: { sessionId: string; disabled?: boolean }) => {
        return (
          <button disabled={disabled} onClick={() => console.log('Clicked', sessionId)}>
            My Attachment
          </button>
        )
      }
    )
  )
}
```

#### 核心铁律：组件绝不能接收 ctx (Zero-Context Component Rule)
- **原因**：React 组件的生命周期由 React Fiber 驱动，而 Cordis 上下文拥有严格的局部依赖跟踪与可逆生命周期。若将 `ctx` 作为 Props 传给组件，会导致闭包泄漏、HMR 无法正常解构上下文、以及跨作用域状态污染。
- **通信手段**：组件所需状态全部通过宿主插槽定义的 `props` 传入；若组件需要触发服务端操作，通过 props 传递的回调函数或自定义 hook 与 Client 侧的 `ctx.remote` 通信。

#### 官方标准 Slot 层级树

| 根节点 / 分支 | 典型 Slot 标识 | Cardinality（基数） | Scope（作用域） | 典型用途 |
| --- | --- | --- | --- | --- |
| **root** | `root` | single | root | 应用最外层骨架挂载 |
| **sidebar.*** | `sidebar.brand` | single | root | 侧边栏品牌区域 |
| | `sidebar.workspaces` | list | root | 工作区列表项 |
| | `sidebar.settings` | list | root | 侧边栏底部设置入口 |
| | `sidebar.files` | list | session | 会话关联的文件树视图 |
| | `sidebar.terminal` | list | session | 侧边栏终端集成面板 |
| **main.*** | `main.chat` | single | session | 主聊天交互区 |
| | `conversation.session` | single | session | 会话状态外壳 |
| | `conversation.view` | list | session | 消息流呈现视口 |
| | `conversation.chat.node` | chain | session | 消息节点流水线包裹/拦截 |
| | `conversation.composer` | list | session | 输入框下方功能区 |
| | `conversation.input.attachments` | list | session | 输入框附加能力条 |
| **rightbar.*** | `sidebar.right.pane.tab` | keyed | session | 右侧抽屉栏扩展 Tab（原 rightbar.session） |
| **shell.*** | `shell.leading` | list | root | 顶部全局横幅通知 |
| | `shell.overlay` | list | root | 全局模态框 / 浮层 |
| **settings.*** | `settings.general.item` | list | root | 常规设置条目 |
| | `settings.models.provider-card` | list | root | 模型提供方卡片 |
| | `settings.plugins.tab` | keyed | root | 插件管理 Tab 面板 |
| | `settings.section` | list | root | 扩展设置区块 |

- **Cardinality（基数）**：`single`（唯一覆盖）、`list`（按 order 列表排布）、`keyed`（按 key 唯一索引替换）、`chain`（责任链环绕，提供 next 渲染后续组件）。
- **Scope（作用域）**：`root`（全局单例）、`session-maybe`（会话可选）、`session`（强绑定当前会话生命周期）。

## 3. 插件标准要素解剖

1. **`name`（唯一标识）**：每个插件模块必须导出小写连字符命名的字符串 `name`，供 Cordis 跟踪生命周期与日志排查。
2. **`inject`（依赖拓扑）**：声明运行所需的服务。列表位置不决定执行顺序，依赖关系才决定执行拓扑。声明形式有两种：数组（全部必需）或对象 `{ required: [...], optional: [...] }`。
3. **`Config` 与 `Schema`**：导出 TypeScript 接口与同名运行时校验器，默认值直接写在 Schema 中。**不要导出普通对象作为 Config**——它不满足 Cordis 要求的 Standard Schema 接口。配置非法时插件加载失败并报告明确错误。
4. **可逆副作用 (Reversible Effects)**：所有注册（工具、事件监听、中间件、服务）均受 Fiber 跟踪，卸载插件时自动逆向注销，零内存泄漏。通过 `ctx` 注册的任何东西——事件监听、工具、定时器——在插件卸载时都会被自动清理，无需手动 removeListener 或 clearInterval。

## 4. Context 上下文 API 与作用域

`Context` 是 Cordis 运行时的根基，也是每个插件与微内核交互的唯一媒介。整个 DSH 系统由树状上下文（Context Tree）维系。

### 3.1 Context 的本质：代理与子上下文

- `ctx` 是一个 **Proxy**：普通属性读取经由服务解析器进行，不是普通对象字段。不要把它当作可变对象直接赋值。
- 子上下文只通过 `ctx.extend(meta?)` / `ctx.isolate()` / `ctx.intercept()` 创建，**绝不修改父上下文**。
- `ctx.extend(meta = {})`：子上下文原型式继承父上下文每个属性，`meta` 的自有属性（含 symbol 键）遮蔽继承属性。
- 环境句柄：`ctx.root`、`ctx.fiber`、`ctx.registry`、`ctx.reflect`、`ctx.events`、`ctx.logger`。
- 底层服务存储：`ctx.get` / `ctx.set` / `ctx.provide` / `ctx.accessor` / `ctx.mixin`。
- 计时器助手：`ctx.timer` 提供 `interval` / `timeout` / `throttle` / `debounce` 四个可释放助手（直接混入 ctx）。

### 3.2 插件挂载：ctx.plugin() 与 ctx.inject()

```ts
// 挂载函数插件并传入配置
ctx.plugin(MyPlugin, { timeout: 5000 })

// 挂载类插件
ctx.plugin(MyServiceClass)
```

每次调用 `ctx.plugin()` 会生成一个关联的 `Fiber` 句柄，用于控制该插件实例的销毁与重载。

`ctx.inject(deps, callback)` 是 `ctx.plugin({ inject, apply: callback })` 的简写：**每当所需服务变化（被卸载/替换），回调会被整体卸载并重新运行**——因此依赖声明是可逆的，不要用它做一次性初始化；一次性副作用应走 `ctx.effect()`。

### 3.3 可逆副作用：ctx.effect()

```ts
ctx.effect(() => {
  const timer = setInterval(() => {
    // 定时轮询
  }, 1000)

  // 返回清理函数 (Disposer)，在两种时机逆序执行：
  // (a) 该 disposer 被手动调用 或 (b) fiber 卸载，先到先得
  return () => {
    clearInterval(timer)
  }
})
```

**Fiber 语义要点**：
- `ctx.fiber` 是当前 fiber；`ctx.effect()` 会把调用委托给它，`ctx.effect` 的 `execute` 立即运行并收集 disposer（不是"等资源可用再执行"——依赖就绪是 `inject` 的职责）。
- 清理顺序为**逆序**（后注册的先清理）；重复调用 disposer 是 no-op。
- 错误语义：fiber 已释放时抛 `CordisError('INACTIVE_EFFECT')`；execute 返回非法形状抛 `TypeError`。
- 当 teardown 顺序有要求时，把相关注册放进同一个 effect。

### 3.4 事件派发与监听

- `ctx.on(name, listener, options?)`：注册事件监听器（disposable）；`ctx.once(name, listener)` 单次监听。
- 派发方法（每个事件必须明确其派发模式，并只能由对应方法派发）：
  - `ctx.emit(name, ...args)`：同步广播，无返回值。
  - `ctx.waterfall(name, ...args)`：同步链式加工，返回最终值。监听器接收 `(...args, next)`，调用 `next()` 执行下游；不调 `next()` 直接返回即短路。协作式监听器可修改共享请求对象后委托，也可整体替换结果。
  - `ctx.parallel(name, ...args)`：异步并发（`Promise.all`）等待全部 settle，无返回值。
  - `ctx.serial(name, ...args)`：按注册顺序依次 `await`，直到第一个 bail 值（非 null/false/undefined）即返回该值（`Promisify<ReturnType>`，不是结果数组）。
  - `ctx.bail(name, ...args)`：**同步**按序调用，直到某个监听器返回 bail 值（非 null/false/undefined）即返回该值。
- `EventOptions`：`prepend?`（插到队列最前）、`global?`（忽视作用域过滤器强制全局接收）。
- 事件是"通知加规约"：先通过 TS 声明合并注册事件名并标注 `@mode` 分发模式，再按对应方法派发，不能混用。

### 3.5 上下文过滤与隔离：ctx.isolate()

```ts
// 在子上下文中隔离自定义数据库服务，仅当前分支可见
const isolatedCtx = ctx.isolate(['database'])
isolatedCtx.plugin(SubPlugin)
```

## 5. 核心能力切面 (Seams) 与依赖倒置

DSH 的设计精髓是**切面（Seam）化设计**：不存在特权或硬编码的内置逻辑，所有产品能力均被切分为抽象契约，由配置可替换的插件实现。DSH 官方将每种能力划分为四种角色之一：

| 角色 | 语义 |
| --- | --- |
| **core** | 每个组合（组合包组合）必启动的主干服务 |
| **seam** | 可替换能力缝：契约包与实现分离，实现以不同名称注册提供方 |
| **bundle** | 具体组合包（如 `dsh-base`、`dsh-sdk-minimal`） |
| **service** | 独立服务 |

一个标准的 Seam 包含三层角色：
1. **接口声明 (Service Definition)**：定义方法与事件契约的包或服务。
2. **实现提供方 (Service Provider)**：具体提供该能力的插件（如 DeepSeek 适配器、SQLite 存储）。
3. **消费者 (Consumer)**：使用该服务的业务插件或面向模型的工具。

### 4.1 DSH 核心能力目录（官方 capability-seams 口径）

| ctx 键 | 角色 | 所属包 | 实现提供方举例 | 核心职责 |
| --- | --- | --- | --- | --- |
| `ctx.sessions` | core | `@deepseek-ai/dsh-session` | session-memory + persistence-fs | 仅追加的 `SessionEvent` 唯一真源日志与状态快照（注意为复数） |
| `ctx.systemPrompt` | core | `@deepseek-ai/dsh-system-prompt` | system-prompt 基础装配器 | 动态收集提示词片段与模型可见工具 Schema 生成 |
| `ctx.tools` | core | `@deepseek-ai/dsh-tools` | dsh-tools 标准执行管线 | 注册能力、PTC 传输、调用依次经过策略前处理、单调守卫、环绕分派、策略后处理与最终结果观测 |
| `ctx.agents` | core | `@deepseek-ai/dsh-agent` | agent-loop | 活跃 Agent 注册表与发起者作用域（注意为复数） |
| `ctx.agentLoop` | **bundle** | `@deepseek-ai/dsh-agent-loop` | — | **唯一的具体循环插件；扩展包依赖 dsh-agent 的事件与服务，绝不依赖此包** |
| `ctx.llm` | **seam** | `@deepseek-ai/dsh-llm` | llm-deepseek, llm-pi-ai, llm-replay | 提供方无关消息流式协议与适配器注册 |
| `ctx.settings` | core | `@deepseek-ai/dsh-settings` | config-editor | 从活动 profile 条目投影 volatile Config 字段成表单，委托 config-editor 持久化 |
| `ctx.configEditor` | core | `@deepseek-ai/dsh-config-editor` | — | 在应用文件锁与 HMR 队列下持久化 profile 配置补丁，并协调 Loader 条目 |
| `ctx.credentials` | seam | `@deepseek-ai/dsh-credentials` | credentials-local | 用户 API Key 与敏感环境变量受控注入与脱敏 |
| `ctx.subprocess` | seam | `@deepseek-ai/dsh-subprocess` | subprocess-local | 子进程 spawn 与终端原语（bash 执行器、PTY、LSP Host、ACP 后端均经它） |
| `ctx.shell` | seam | `@deepseek-ai/dsh-shell` | bash-local / bash-sandbox / pwsh-local | 终端执行沙箱 |
| `ctx.web` | seam | `@deepseek-ai/dsh-web` | web-search-exa / web-fetch-http | 网页搜索与抓取能力（提供方注册能力而非工具） |
| `ctx.jobs` | seam | `@deepseek-ai/dsh-jobs` | jobs-local | 后台任务生命周期管理 |
| `ctx.fs` | seam | `@deepseek-ai/dsh-fs` | fs-local / fs-sandbox / fs-ssh | 文件系统能力（配套 fs-observation-policy） |
| `ctx.sessionPersistence` | seam | `@deepseek-ai/dsh-session-persistence` | session-persistence-jsonl | 会话持久化存储 |
| `ctx.sessionQuery` | seam | `@deepseek-ai/dsh-session-query` | session-query-sqlite | 会话查询 |
| `ctx.storage` | seam | `@deepseek-ai/dsh-storage` | storage-json / storage-sqlite | 通用键值存储 |
| `ctx.skills` | seam | `@deepseek-ai/dsh-skill` | skill-filesystem / skill-badge / skill-office | 技能（Skill）注册表与调用策略 |
| `ctx.ptcRuntime` | seam | `@deepseek-ai/dsh-ptc-runtime` | ptc-runtime-local | PTC 模式程序执行运行时 |
| `ctx.sandbox` | seam | `@deepseek-ai/dsh-sandbox` | sandbox-local (bwrap/Landlock, Seatbelt, Windows ACL) | 文件效果策略沙箱（`SandboxMode` 只管文件效果，不管网络/进程可见性） |
| `ctx.approval` | seam | `@deepseek-ai/dsh-approval` | approval-local | 审批请求（approval/request waterfall） |
| `ctx.compaction` | seam | `@deepseek-ai/dsh-compaction` | compaction-basic | 上下文压缩 |

注意：`@deepseek-ai/dsh-scope` 是纯函数库（提供 `createScope`、`scopeOf`、`scopeTarget`），**不挂载任何服务**。

### 4.2 DSH 专用作用域库 (@deepseek-ai/dsh-scope)

为实现按 Agent / 会话维度的精确状态隔离（避免多 Agent 共享同一进程时的上下文污染），DSH 提供零依赖基础库：

- `createScope(owner)`：为指定的 Agent 实体创建专属作用域对象。
- `scopeOf(ctx)`：解析当前调用栈所属的目标作用域。
- `scopeTarget(scope)`：获取作用域绑定的宿主实例。
- `ScopeKey` 是不透明对象，按身份比较（原语从不检视对象内部）。
- 作用域过滤是派发层机制（Scoped this 类型）：经 `agent.ctx` 调用只 scope EFFECTS。

通过将 `ToolRuntime` 的 `register()`、`guard()`、`restrict()` 与作用域结合，系统可实现单进程内多个不同预设 Agent 拥有完全独立的工具集和拦截规则。

### 4.3 插件依赖倒置法则

- **依赖接口声明包**：只依赖声明接口的抽象包（如 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-tools`），在 `inject` 中按服务名声明。
- **严禁依赖具体实现包**：绝不直接 `import` 具体提供方实现（例如不要在业务代码中直接 `import { DefaultAgentLoop } from '@deepseek-ai/dsh-agent-loop'`），以确保底座在更换驱动器或沙箱环境时业务逻辑完全不受影响。
- **命名规则**：单数 ctx 键用于 engine/runtime/policy/controller/resolver/store 等；复数键用于 registry 或拥有多个具名成员的服务（如 `ctx.sessions`、`ctx.agents`）。
- **host 与 client 不得复用同一 Cordis Context 键**：TS 声明合并会同时看到两种类型。

## 6. 设置表单与配置持久化 (Settings Forms)

DSH 为插件提供统一的用户配置表单体系。插件导出的 Schemastery 配置契约会被自动反射为 Web GUI 设置界面的可视化表单控件，并在用户修改后持久化至配置补丁文件。

### 5.1 核心服务与寻址

- **`SettingsService` (`ctx.settings`, `@deepseek-ai/dsh-settings`)**：将当前激活 Profile 中的插件配置字段动态投影为前端表单描述符（Descriptors）。核心方法：`configure({auto?})`、`describe()`、`update(ns, patch, expectedRevision?)`、`replace(ns, section, expectedRevision?)`、`mutate(ns, ops, expectedRevision?)`。
- **`ConfigEditor` (`@deepseek-ai/dsh-config-editor`)**：提供带文件锁的原子化持久化写入服务，目标为当前 Profile 的配置补丁。
- **标识寻址**：表单系统基于当前 Profile 中条目的**局部唯一标识符（Entry ID）**进行命名空间寻址。若同一插件包挂载多个实例（如两个 MCP 客户端），只要 `id` 不同，前端设置面板就会呈现为多份独立表单。只有带明确 `id` 且导出非空 Schema 的条目才会生成表单。

### 5.2 三种写入语义（官方权威）

| 方法 | 语义 |
| --- | --- |
| `update(ns, patch)` | **合并**提交字段（默认语义） |
| `replace(ns, section)` | 先将即时字段**重置为继承配置**，再应用提交字段（整体替换） |
| `mutate(ns, ops)` | **路径级**寻址编辑，保留客户端响应中未包含的秘密值 |

每次写入都会验证完整 Config，并在持久化前**拒绝过期修订号**（乐观并发控制）。

### 5.3 表单描述符与乐观版本控制

每个配置表单的描述符包含：
- `resolvedValues`：当前生效的最终配置值（已合并默认值与用户覆盖）。
- `inheritedValues`：由底层 Bundle 定义的基础默认配置。
- `profileOverrides`：在当前 Profile 补丁中显式声明的覆盖字段。
- `revision`：用于并发安全保护的递增版本号。前端提交时必须附带期望版本号，若中途有其他进程更新了文件，保存操作将因版本冲突安全中止。

### 5.4 持久化写入语义规范

1. **唯一写入目标**：当前 Profile 的补丁文件（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）。
2. **全量替换规约 (Replaced Wholesale)**：写入的配置字段会完整替换该条目的 `config` 块，**不会执行深合并**。表单提交必须提交完整的已解析配置对象。
3. **文件锁保护**：写入过程受文件锁保护，避免并发写入导致 YAML 语法损坏。
4. **HMR 自动触发**：写入完成后，文件监听器自动检测到补丁变动，执行增量重载而无需重启应用。
5. **即时字段 (Volatile)**：配置可用 `Volatile<T>` + `Schema.xxx().volatile()` 声明即时字段，运行时用 `.get()` 读取、跨字段校验用 `.check()`（Host 持久化前执行，不进表单 schema）；变更经 `loader/volatile-update` 事件推送（只派发给所属 fiber）。`role('secret')` 阻止值进入表单响应；凭据域值用凭据引用。

---

## 8. Cordis 4.0.4 微内核 Context Proxy 隔离底层深度剖析

在 DSH 中，`Context` 对象本质是一个受保护的 JavaScript Proxy，属性访问通过服务解析器（Service Resolver）动态分发。

### 1. `ctx.isolate(key)` 服务作用域物理隔离槽
当插件希望在子上下文（Child Context）中覆盖某个全局服务，但又不希望污染全局父级上下文时：
```js
// 在子上下文为 customCache 服务创建隔离槽
const childCtx = ctx.isolate('customCache');

// 子上下文注册的实现仅对自己及后代可见，父上下文完全感知不到
childCtx.plugin(MyIsolatedCachePlugin);
```
- 隔离键被记录在 `Context[symbols.isolate]` 映射表中；
- 实现了多 Agent 或多任务间的服务多租户隔离。

### 2. `ctx.intercept(key, config)` 动态拦截代理
允许针对特定服务的方法调用或属性读取挂载动态拦截器（Intercept Map），在不重写服务类的情况下实现切面监控或参数注入。

### 3. `Context.is(value)` 全局跨 Realm 品牌检验
Cordis 废弃了脆弱的 `value instanceof Context` 判定，改用全局 Symbol 品牌：
```js
Context.is[Symbol.toPrimitive] = () => Symbol.for("cordis.is");
```
- 使得即便在多包 Monorepo、不同 npm 副本或不同 iframe/Worker Realm 下，跨环境的 Context 对象依然能 100% 准确识别！
