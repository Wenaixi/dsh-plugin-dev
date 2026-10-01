# 事件系统与派发模式

事件是 Cordis 插件间解耦通信的核心机制。DeepSeek Harness (DSH) 大量使用事件来实现可拔插扩展点、流程拦截与状态感知。通过 `ctx.on()` 注册的所有事件监听器均受所属 Fiber 作用域管理，在插件卸载时自动注销（可逆效果）。

## 五大事件派发模式 (Dispatch Modes)

Cordis 规定：每个事件必须有明确的派发模式，且只能由其对应的方法派发。理解这五种模式是编写高内聚、正确插件的关键：

| 派发模式 | 派发方法 | 是否等待 (Awaited) | 执行顺序与调度 | 返回值规范 | 典型应用场景 |
| --- | --- | --- | --- | --- | --- |
| **emit** | `ctx.emit(name, ...args)` | 否（同步） | 按注册顺序依次调用监听器 | 无返回值 (`void`) | 状态通知、指标采集、日志记录、UI 广播 |
| **waterfall** | `ctx.waterfall(name, ...args)` | 否（同步） | 按注册顺序串行链式传递，后一个监听器接收前一个的返回值 | 返回最终加工的值 | 提示词前缀组装、配置数据加工、请求参数规范化 |
| **parallel** | `ctx.parallel(name, ...args)` | 是 (`Promise.all`) | 异步并发执行所有监听器 | 返回全部结果数组 (`Promise<T[]>`) | 批量清理、多渠道并发通知、独立数据校验 |
| **serial** | `ctx.serial(name, ...args)` | 是 (`await` 循环) | 按注册顺序依次等待每个监听器执行完毕 | 返回全部结果数组 (`Promise<T[]>`) | 顺序迁移、需严格依赖前序步骤的初始化 |
| **bail** | `ctx.bail(name, ...args)` | 是 (短路阻断) | 按注册顺序依次执行，一旦某监听器返回非 `undefined` 立即终止并返回 | 返回首个非空阻断值 (`Promise<T | undefined>`) | 权限阻断卫士、错误拦截恢复、工具调用拦截 |

## 监听器注册与选项

### 1. 基础监听与销毁器

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  // 注册监听器，返回对应的注销函数 (Disposer)
  const dispose = ctx.on('custom-event', (data) => {
    console.log('Received:', data)
  })

  // 单次监听
  ctx.once('one-time-event', () => {
    console.log('Fired once and auto-disposed')
  })

  // 当插件卸载时，ctx 范围内的监听器会自动注销，无需手动调用 dispose()
}
```

### 2. EventOptions 控制

`ctx.on(name, listener, options?)` 支持传入配置项控制监听优先级与作用域：

```ts
interface EventOptions {
  prepend?: boolean   // 插到同事件既有监听器队列的最前面（高优先级）
  global?: boolean    // 忽视上下文作用域过滤器，强制全局接收该事件
}

// 示例：高优先级优先拦截
ctx.on('tools/pre-execute', async (call) => {
  // 率先执行拦截逻辑
}, { prepend: true })
```

## DSH 官方核心事件清单

DSH 核心子系统定义了以下标准事件，插件可通过监听这些事件参与运行循环：

### 1. 生命周期事件 (Lifecycle)
- `ready`: 所有初始插件和服务加载就绪后触发（`emit`）。
- `dispose`: 当前上下文或插件即将被卸载时触发（`emit`）。
- `before-apply`: 插件应用前触发。
- `app-boot/config-reload`: HMR 配置热重载完成并稳定后广播（`emit`）。

### 2. Agent 执行循环事件 (Agent & Turn)
- `agent/turn-start`: 轮次开始，接收当前 `TurnContext` 与会话信息。
- `agent/turn-end`: 轮次正常完成，可用于持久化确认或统计耗时。
- `agent/step-start`: 单步执行开始（包括模型调用与工具调用准备）。
- `agent/step-end`: 单步执行结束。
- `agent/request-error`: LLM 请求失败时触发的阻断拦截点（`bail` 模式）。监听器在修复或等待后返回 `{ kind: 'retry' }`，可触发安全重试而不使会话崩溃。

### 3. 工具执行管线事件 (Tools Pipeline)
- `tools/pre-execute`: 工具调用参数解析完成、即将执行前的流水线（`waterfall` / `bail`）。可用于参数改写或前置鉴权阻断。
- `tools/execute`: 实际工具调度执行。
- `tools/post-execute`: 工具执行成功后触发，接收执行结果与上下文。

## 类型化事件扩展 (Declaration Merging)

为自定义插件事件提供强类型提示，需在模块中对 `@deepseek-ai/cordis` 的 `Events` 接口进行声明合并：

```ts
export interface GitCommitPayload {
  hash: string
  message: string
  author: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    // 声明为同步事件 (emit)
    'git/commit'(payload: GitCommitPayload): void

    // 声明为异步阻断事件 (bail)
    'git/pre-commit'(payload: { stagedFiles: string[] }): boolean | Promise<boolean>
  }
}
```

合并后，调用 `ctx.on('git/commit', ...)` 或 `ctx.emit('git/commit', ...)` 时，TypeScript 将全程提供参数签名校验与补全。
