# 插件解剖学 (Plugin Anatomy)

> 本文件是「插件是什么、怎么挂、怎么活下来」的权威定义。三角色与双面插件/Slots 见 [three-roles.md](./three-roles.md)，Cordis Context Proxy 内核见 [cordis-context-internals.md](./cordis-context-internals.md)，设置表单见 [config.md](./config.md)。

## 目录

- [1. 插件三种形态](#1-插件三种形态)
- [2. 插件标准要素解剖](#2-插件标准要素解剖)
- [3. Context 上下文 API 与作用域](#3-context-上下文-api-与作用域)
- [4. 核心能力切面 (Seams) 与依赖倒置](#4-核心能力切面-seams-与依赖倒置)

---

在 DeepSeek Harness (DSH) 中，一切能力皆为插件。Cordis 插件是一等公民对象，通过声明依赖（`inject`）、提供或消费服务、监听或分发事件，向运行上下文注入功能。本文件覆盖：插件的三种形态、标准要素（`name`/`inject`/`Config`/可逆副作用）、Context API 与作用域，以及核心能力切面（Seam）的依赖倒置法则。

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
    // 第二个参数是挂载到 ctx 上的服务键名（name 即 ctx 挂载键）；官方 Service 构造器只有 (ctx, name?) 两参
    super(ctx, 'taskQueue')
  }
  // 官方不存在 start/stop 生命周期钩子；依赖就绪后的初始化用静态符号 [Service.init]()，清理用构造期 ctx.effect 注册
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
- **依赖就绪初始化**：官方没有 start()/stop() 钩子；需要「所有依赖就绪后」执行一次的初始化写在静态符号 `[Service.init]()` 方法里（类插件构造后调用）；清理一律用构造期 `ctx.effect` 注册的可逆副作用，随 fiber 卸载自动执行。
- 服务内部注册的事件与 `ctx.effect()` 资源均与 fiber 生命周期绑定，卸载时自动注销。

---

## 2. 插件标准要素解剖

1. **`name`（唯一标识）**：每个插件模块必须导出小写连字符命名的字符串 `name`，供 Cordis 跟踪生命周期与日志排查。
2. **`inject`（依赖拓扑）**：声明运行所需的服务。列表位置不决定执行顺序，依赖关系才决定执行拓扑。声明形式有两种：数组（全部必需）或对象 `{ required: [...], optional: [...] }`。
3. **`Config` 与 `Schema`**：导出 TypeScript 接口与同名运行时校验器，默认值直接写在 Schema 中。**不要导出普通对象作为 Config**——它不满足 Cordis 要求的 Standard Schema 接口。配置非法时插件加载失败并报告明确错误。
   - **默认值有一个隐藏副作用，务必读懂再决定给不给**：Cordis 在插件启动与每次配置热更新时执行 `Config['~standard'].validate(config)`，Schemastery 会把 Schema 里的 `.default()` **填回结果对象**。也就是说宿主传给 `apply(ctx, config)` 的不是"用户写了什么"，而是「用户写了什么 + Schema 补齐的一切」。凡是插件还想从别处读同一项默认配置（自己的数据目录、环境变量、父级补丁继承值）的，该字段**绝不能挂 `.default()`**，否则「用户没写」这一信息在进 `apply` 之前就已经丢了，你的自有默认值永远赢不了、且毫无报错。判据：如果某个字段的「未设置」语义有业务含义，它就不能有 Schema 默认值。
4. **可逆副作用 (Reversible Effects)**：所有注册（工具、事件监听、中间件、服务）均受 Fiber 跟踪，卸载插件时自动逆向注销，零内存泄漏。通过 `ctx` 注册的任何东西——事件监听、工具、定时器——在插件卸载时都会被自动清理，无需手动 removeListener 或 clearInterval。
   - **有状态的东西必须活在 `apply()` 闭包里，绝不能放模块顶层**：宿主支持热重载，会在同一进程内反复重建 `apply`。模块级 `let`/`const` 单例只求值一次，第二次热重载时新 `apply` 会与残留的旧状态共享同一份内存变量，与外部持久化状态形成双写竞争——表现为「改了配置却时灵时不灵」「重启进程就好了」「两个实例互相覆盖」。规则：有状态的实例一律 `const state = createState()` 写在 `apply()` 内，让它随 fiber 一起被丢弃。
5. **不要 import 宿主提供、但你没在 `peerDependencies` 里声明的包**：宿主核心包的模块解析路径在插件视角下不保证可达（典型报错 `ERR_MODULE_NOT_FOUND`），静态 import 会让真实用户环境加载即崩；如果只是为了抄几行官方小函数而引它，代价是整个插件不可用。两种安全做法：
   - 把那几行语义**等价复刻**到你自己的深模块里，并在注释与静态门禁里写明「复刻自哪里、行为等价点是什么」，把契约漂移风险显式化；
   - 或者把官方包老实声明进 `peerDependencies`，由宿主保证单实例解析。
   复刻优于引入依赖，但复刻必须留可执行的漂移防线，不要只留一句注释。

## 3. Context 上下文 API 与作用域

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
- 派发有五个互不通用的方法：`ctx.emit` / `ctx.waterfall` / `ctx.parallel` / `ctx.serial` / `ctx.bail`。事件一旦在类型声明里标注了 `@mode`，就只能用对应方法派发，混用无效。
- 事件的完整语义（`waterfall` 的环绕中间件形态、`parallel`/`serial`/`bail` 的 bail 值短路、`EventOptions`、`isBailed` 源码、disposer 返回值）见 [events.md](./events.md) 第一节。

### 3.5 上下文过滤与隔离：ctx.isolate()

```ts
// 在子上下文中隔离自定义数据库服务，仅当前分支可见
const isolatedCtx = ctx.isolate('database')
isolatedCtx.plugin(SubPlugin)
```

## 4. 核心能力切面 (Seams) 与依赖倒置

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

### 4.1 核心能力目录

DSH 把每种能力切分为抽象契约（seam），实现以不同包名注册提供方。这张全量能力表（core / seam / bundle 角色、所属包、实现提供方与职责）维护在 [services.md](./services.md) 第一节与第三节，改动只在那里发生。

本文件只保留依赖倒置的用法规则；服务清单本身不在此重复。

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