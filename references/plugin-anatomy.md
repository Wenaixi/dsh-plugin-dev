# 插件解剖学 (Plugin Anatomy)

在 DeepSeek Harness (DSH) 中，一切能力皆为插件。Cordis 插件是一等公民对象，通过声明依赖（`inject`）、提供或消费服务、监听或分发事件，向运行上下文注入功能。

## 两种主要插件形态

### 1. 函数插件 (Function Plugin)

适用于大多数无状态扩展、工具注册、事件拦截或轻量业务集成：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

// 1. 显式插件标识（必须与导出同名）
export const name = 'my-greeting-plugin'

// 2. 静态依赖声明（确保服务已就绪）
export const inject = ['tools']

// 3. 强类型配置定义与 Schema 校验
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
      return `${config.prefix}, ${args.name}! `.repeat(config.repeat).trim()
    },
  })

  // 注册的副作用（事件监听器、工具等）受 ctx 作用域管理，卸载时自动回滚
}
```

### 2. 服务类插件 (Service Class Plugin)

适用于管理长生命周期资源、对外公开专属服务方法、或维护复杂运行时状态的场景：

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
    // 注册服务名 'taskQueue'，true 表示全局单例/立即生效
    super(ctx, 'taskQueue', true)
  }

  protected override start(): void | Promise<void> {
    // 异步初始化连接或启动工作线程
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

## 插件标准要素解剖

1. **`name` (唯一标识)**：每个插件模块必须导出小写连字符命名的字符串 `name`，供 Cordis 跟踪生命周期与日志排查。
2. **`inject` (依赖拓扑)**：声明运行所需的硬性或软性服务。列表位置不决定执行顺序，依赖关系才决定执行拓扑。
3. **`Config` 与 `Schema`**：导出 TypeScript 类型与运行时校验器，提供安全类型约束与默认值兜底。
4. **可逆副作用 (Reversible Effects)**：所有注册（工具、事件监听、中间件、服务）均受 Fiber 跟踪，卸载插件时自动逆向注销，零内存泄漏。
