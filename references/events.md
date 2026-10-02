# 事件系统与派发模式

事件是 Cordis 插件间解耦通信的核心机制。DSH 大量使用事件实现可拔插扩展点、流程拦截与状态感知。通过 `ctx.on()` 注册的所有监听器均受所属 Fiber 作用域管理，插件卸载时自动注销（可逆效果）。

## 五大事件派发模式（官方权威表格）

Cordis 规定：每个事件必须有明确的派发模式，且只能由其对应方法派发。新事件通过 `@mode` 标签记录模式，使生成目录能将声明与分发调用点交叉校验。

| 模式 | 派发方法 | 是否 await | 分发顺序 | 返回值 |
| --- | --- | --- | --- | --- |
| emit | `ctx.emit(name, ...args)` | 否（同步） | 按注册顺序观察 | 否 |
| waterfall | `ctx.waterfall(name, ...args)` | 否（同步） | 按注册顺序观察（环绕中间件） | 是（最终加工值） |
| parallel | `ctx.parallel(name, ...args)` | 是（并发） | 所有监听器并行观察，全部 settle 后兑现 | 否（`Promise<void>`，不是结果数组） |
| serial | `ctx.serial(name, ...args)` | 是（按序） | 依次 `await` 直到第一个 bail 值 | 是（首个 bail 值，`Promisify<ReturnType>`，不是结果数组） |
| bail | `ctx.bail(name, ...args)` | 否（同步） | 同步按序调用直到第一个同步 bail 值 | 是（首个 bail 值） |

**bail 值判定**：非 `null`、非 `false` 且非 `undefined` 的第一个值。`on` 返回 disposer（`() => boolean`）；布尔 options 是 `prepend` 简写；`EventOptions = { prepend?, global? }`（`global: true` 忽略上下文过滤器）；全部事件方法均有 `thisArg` 首参重载。

## Waterfall 语义（重要：不是传值链）

`ctx.waterfall` 是**环绕中间件（around-middleware）**，**不是**"后一个监听器接收前一个返回值"的简单传值链：

- 监听器接收 `(...args, next)`；调用 `next()` 执行下游，下游返回值经 `next()` 回到当前包装层，可再包装后外传。
- **不调用 `next()` 直接返回即短路**。
- 协作式监听器可修改共享请求/决策对象后委托，也可**整体替换结果**（下游只看到替换后的值）。
- 单决策事件中短路是设计意图：策略监听器不调 `next()` 直接返回；观察/标注类必须委托。
- 仅当必须早于普通注册运行时才使用 `prepend: true`。

```ts
ctx.waterfall('my-pipeline', initial, (ctx, value, next) => {
  // 可以修改 value 后委托
  return next({ ...value, injected: true })
  // 或者短路直接返回
  // return { blocked: true }
})
```

## 监听器注册与选项

### 基础监听与销毁器

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  const dispose = ctx.on('custom-event', (data) => {
    console.log('Received:', data)
  })

  ctx.once('one-time-event', () => {
    console.log('Fired once and auto-disposed')
  })

  // 插件卸载时 ctx 范围内的监听器自动注销，无需手动 dispose()
}
```

### EventOptions 控制

```ts
interface EventOptions {
  prepend?: boolean // 插到同事件既有监听器队列最前面（高优先级）
  global?: boolean  // 忽视上下文作用域过滤器，强制全局接收
}

ctx.on('tools/pre-execute', async (call) => {
  // 率先执行拦截逻辑
}, { prepend: true })
```

### parallel 的 thisArg 重载

`ctx.parallel` 支持先传 `thisArg` 作为监听器的 `this` 绑定（`NoInfer<ThisType<Events[K]>>`）。

## DSH 官方核心事件（按子系统与模式）

事件按子系统组织，模式是公开约定的一部分。以下为官方文档确认的事件及模式：

### 1. Agent 生命周期与协调（ctx.agents / dsh-agent）

| 事件 | 模式 | 说明 |
| --- | --- | --- |
| `agent/created` | serial | 可 throw 否决创建；AgentLoop 在监听器全部完成前保持排队输入 |
| `agent/status` | emit | 状态变化（idle/running）通知 |
| `agent/pre-step` | waterfall | 返回 `PreStepDecision`：`{kind:'reject'}` 或 `{kind:'enter'; messages; startsRequestSeries?}` |
| `agent/request` | waterfall | 替换冻结的 LlmCallConfig（提供方/模型必须存在） |
| `agent/request-error` | **waterfall** | 处理者返回 `{kind:'retry'}` 且不调 `next()` 则重试，否则失败终态 |
| `agent/turn-stopping` | serial | 可 steer 后再读 inbox |
| `agent/inbox/inserted` | `claimed` | `discarded` | emit | 收件箱有序持久列表变更 |
| `agent/assistant-stream` | emit | 实时流分片（瞬态，回放读持久 settlement） |
| `agent/error` | emit | 错误通知 |
| `agent/disposed` | emit | Agent 被 dispose（不是第三个 status） |

注意：**轮次/步骤边界是持久会话事件，不是 agent emit**。

### 2. 工具执行管线（ctx.tools / dsh-tools）

| 事件 | 模式 | 说明 |
| --- | --- | --- |
| `tools/pre-execute` | waterfall | allow/deny/cancel/ask 决策；**参数在此阶段禁止改写**（历史/审计/UI/执行一致） |
| `tools/execute` | waterfall | 环绕包装（截止时间/重试/指标）；只能替换 signal |
| `tools/post-execute` | waterfall | accept（替换展示 content 或 value 二选一）或 block（转含纠正反馈的 isError） |
| `tools/result` | emit | 观察冻结的权威结果；观察者失败隔离 |
| `tools/change` | emit | 故意不 scope 过滤（全局变化影响所有 agent 下次组装） |
| `tools/ptc-dispatch-log` | waterfall | 只能修改持久日志副本（程序已拿到完整 value，模型两者都看不到） |

### 3. 会话与持久化（ctx.sessions / dsh-session）

| 事件 | 模式 | 说明 |
| --- | --- | --- |
| `session/event` | emit | post-commit fire-and-forget 广播 |
| `session/created` | emit | 同步 throw 可否决并回滚 |
| `session/disposed` | emit | 会话销毁 |
| `session/flush` | parallel | 无 waterfall veto；flush(session) 是唯一刷盘入口（禁止裸 ctx.parallel('session/flush',…)） |
| `api-session/added` | `removed` | `status` | `error` | `activity` | emit | API 层会话状态 |

### 4. LLM 流（ctx.llm / dsh-llm）

| 事件 | 模式 | 说明 |
| --- | --- | --- |
| `llm/stream` | waterfall | 可短路整个流分发 |
| `llm/adapters-updated` | emit | 负载为空；每次 commit 点触发，消费方重读 listProviders/listModels |

### 5. 系统提示词（ctx.systemPrompt）

| 事件 | 模式 | 说明 |
| --- | --- | --- |
| `system-prompt/change` | emit | 注册/注销提示词段落；故意不 scope 过滤 |
| `system-prompt/assemble` | waterfall | Scoped 过滤；返回值为权威；complete 段在 waterfall 后恢复为唯一段落 |

### 6. 环境与内部钩子事件（Inherited Cordis API）

| 事件 | 模式 | 说明 |
| --- | --- | --- |
| `internal/plugin` | — | fiber 创建 |
| `internal/status` | — | fiber 生命周期状态变化 |
| `internal/service` | — | 服务绑定拦截钩子（无核心生产者） |
| `internal/update` | waterfall | fiber 配置更新正在应用 |
| `internal/config` | waterfall | 配置校验前解析 |
| `internal/get` | `internal/set` | waterfall | 从存储读/写服务 |
| `internal/listener` | — | 监听器注册 |
| `internal/dispatch` | — | 派发至监听器 |
| `exit` | — | 信号退出 |
| `loader/config-update` | `loader/entry-init` | `loader/partial-dispose` | `loader/patch-context` | — | loader 重载生命周期 |
| `loader/volatile-update` | — | 波动配置不重挂载直接提交进运行 fiber，**只派发给所属 fiber** |

内部钩子事件多为 Waterfall/拦截类，不是广播通知。**拦截和策略优先用事件，直接能力调用优先用服务方法**。

## 类型化事件扩展 (Declaration Merging)

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
    // 声明为阻断事件 (bail)
    'git/pre-commit'(payload: { stagedFiles: string[] }): boolean | Promise<boolean>
  }
}
```

事件名先声明（声明合并）+ `@mode` 标分发模式，再按对应方法派发，**不能混用**。
