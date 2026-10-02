# LLM 适配器与流式协议

DeepSeek Harness (DSH) 采用提供方无关（Provider-neutral）的模型调用抽象。所有具体模型 API 均通过继承 `LlmAdapter` 并向 `ctx.llm` 注册实现接入。官方文档口径：`ctx.llm` 的角色是 **seam（可替换能力缝）**，契约在 `@deepseek-ai/dsh-llm`，实现由 `llm-deepseek`、`llm-pi-ai`、`llm-replay` 等包提供；消费方是 `agent-loop` 与 `compaction-basic`，它们只依赖与提供方无关的流服务。

## 职责划分

- **`LlmRuntime`（`ctx.llm`）**：提供方路由解析、流分发、`llm/*` 事件、共享的 `BlockAssembler` 折叠、模型元数据归一化。**不做库级重试**：一次适配器调用等于一次提供方尝试。
- **`LlmAdapter`**：把标准 `GenerateOptions` 转成厂商载荷，再把厂商流式响应映射为统一的 `StreamChunk` 序列。唯一必需实现的方法是 `stream()`。

## 最小适配器实现

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

export class CustomLlmAdapter extends LlmAdapter {
  constructor(private config: Config) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { model, messages, tools, signal } = options

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        // 每个 HTTP 请求都必须合并归因头（映射 User-Agent）
        ...this.attributionHeaders(),
      },
      body: JSON.stringify({ model, messages, tools, stream: true }),
      signal, // 必须遵守调用方 signal
    })

    // 错误路径一：传输/协议故障直接抛出带稳定 code 的 LlmError
    if (!response.ok) {
      throw new LlmError(`Provider HTTP ${response.status}`, 'PROVIDER_ERROR')
    }

    // 块 index 按首次出现的流顺序分配，从 0 递增
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Hello, ' }
    yield { type: 'text-delta', index: 0, text: 'world!' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello, world!' } }

    // usage 必须在 finish 之前发出，且只发一次
    yield {
      type: 'usage',
      usage: {
        inputTokens: 120,    // 仅未命中缓存的输入
        cacheRead: 400,      // 命中缓存的输入（单独报告）
        cacheWrite: 0,       // 写入缓存的开销
        outputTokens: 50,    // 已含 reasoningTokens
        reasoningTokens: 30,
      },
    }

    // finish 必须是最后一个分片
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'my-custom-llm'
export const inject = ['llm']

export interface Config {
  apiKey: string
  endpoint: string
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().role('secret').required().description('API 认证密钥'),
  endpoint: Schema.string().default('https://api.custom.com/v1').description('接口基地址'),
  providers: Schema.array(Schema.string()).default(['custom-provider']).description('绑定的提供方路由'),
})

export function apply(ctx: Context, config: Config) {
  // 注意参数顺序：第一个参数是提供方路由列表，第二个是适配器实例
  const handle = ctx.llm.registerAdapter(config.providers, new CustomLlmAdapter(config))

  // 卸载由 handle.dispose() 释放；也可用 handle.replace(providers) 做原子路由替换
}
```

## 注册契约

```ts
// @deepseek-ai/dsh-llm
ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle

interface AdapterRegistrationHandle {
  dispose(): void
  replace(providers: string[]): void  // 原子替换路由绑定
}
```

- **注册基于副作用**：随所属 fiber 卸载自动注销，天然支持 HMR。
- **每个提供方路由同一时刻只能对应一个适配器**：重复注册同一路由抛出 `DUPLICATE_ADAPTER`，且**多路由注册要么全部成功、要么全部失败**（原子性）。
- 传入空路由数组合法（等价于不声明任何路由）。
- `options.provider` 用于选择适配器；`options.model` 是提供方自己的模型 ID，**无需在启动时注册**。动态模型目录不需要重新配置生命周期。
- 模型选项通过覆写 `listModels()` 公布。

## StreamChunk 协议（封闭判别联合）

`StreamChunk` 是**封闭联合**（与可声明合并扩展的 `ContentBlock`/`MessageSource`/`FinishReason` 相反）：消费端 `switch` 应以 `assertNever` 收尾。

| Chunk 类型 | 字段载荷 | 语义 |
| --- | --- | --- |
| `block-start` | `index: number, blockType: 'text' \| 'tool-call'` | 块开始；每个 `block-start` 必须有配对的 `block-end` |
| `text-delta` | `index: number, text: string` | 可见文本增量 |
| `reasoning-delta` | `index: number, text: string` | 深度思考过程增量 |
| `tool-call-delta` | `index, id: ToolCallId, name?: string, argumentsDelta: string` | 工具调用参数增量 |
| `block-end` | `index: number, block: ContentBlock` | 块结束，携带完整块 |
| `usage` | `usage: TokenUsage` | 计费与计量凭证 |
| `finish` | `reason: FinishReason, replayState?: ReplayEnvelope` | 终结分片 |

```ts
type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'error'; failure: LlmFailure }
  | { kind: 'aborted'; failure?: LlmFailure }
```

## 适配器契约清单

1. **分片顺序**：`usage` 必须在 `finish` 之前；`finish` 之后不得再发出任何分片。稳健做法是把 `finish`/`usage` 缓冲到提供方流结束标记再统一 flush，以应对"末尾只有 usage 分片"的提供方。
2. **参数全程保持原始 JSON 字符串**：工具调用参数从头到尾都是未解析的 JSON 文本；流式片段用 `argumentsDelta`；若提供方直接返回解析后的对象，必须在 `block-end` 重新 stringify。
3. **index 分配**：按首次出现的流顺序分配，从 0 递增；同一个块的后续 delta 复用该 index。容忍 delta-only 协议；已 `block-end` 关闭的 index 再收到 delta 时忽略。
4. **禁止库级重试**：适配器绝不自行重试。agent 层恢复会开启新的持久编号轮次；直接调用 `ctx.llm.stream()` 的调用方仍然只尝试一次。`providerRetryAfterMs` 是校验过的正延迟提示，不是重试决策。
5. **遵守 `options.signal`**：`resolveModel(provider, model, signal?)` 等异步查询也必须响应中止。
6. **不支持的能力显式拒绝**：必须抛 `LlmError(..., 'UNSUPPORTED_OPTION')`，**绝不允许静默丢弃**请求参数。
7. **归因头**：每个 HTTP 请求合并 `attributionHeaders()`（映射 User-Agent；AppIdentity 不含 secret、路径、session id 或逐请求信息）。
8. **密钥从配置读取**：通过 Schemastery Config（可带环境变量回退）在 `cordis.yml` 用 `!!js process.env.MY_API_KEY` 注入。**切勿在代码中读取自行约定的密钥文件**。
9. **流空闲看门狗**：只在 `next()` 未完成时启动，超时映射 `TIMEOUT`；调用方中止保留 `ABORTED`。`streamIdleTimeoutMs` 默认五分钟。

## Token 计量（互不重叠）

```ts
interface TokenUsage {
  inputTokens: number      // 仅未命中缓存的输入
  cacheRead?: number       // 命中缓存的输入
  cacheWrite?: number      // 写入缓存的开销
  outputTokens: number     // 输出，已包含 reasoningTokens
  reasoningTokens?: number // 信息性字段，不得重复相加
}
```

计费输入 = `inputTokens + cacheRead + cacheWrite`。`reasoningTokens` 已含于 `outputTokens`，汇总时严禁叠加。

## 两条合法错误路径

两条路径都由 `LlmRuntime` 归一化为 `LlmFailure`，消费方必须同时处理：

1. **`stream()` 抛出**：传输层或协议层故障，抛出带稳定 code 的 `LlmError`。
   ```ts
   throw new LlmError('Provider HTTP 500', 'PROVIDER_ERROR')
   ```
2. **`finish` 带内终结**：提供方带内故障（内容安全拦截、配额耗尽等）。
   ```ts
   yield {
     type: 'finish',
     reason: { kind: 'error', failure: { code: 'CONTENT_FILTERED', message: 'Blocked by provider policy.' } },
   }
   ```

稳定错误码（消费方按 code 路由，绝不依赖提供方文本）：

| code | 语义 |
| --- | --- |
| `CONTEXT_WINDOW_EXCEEDED` | 上下文溢出的唯一 code（DeepSeek 适配器经 `isContextWindowExceededError` 分类） |
| `EMPTY_RESPONSE` | 空 completion，属可重试错误，`dsh-llm-retry` 默认重试 |
| `TIMEOUT` | 流空闲看门狗超时 |
| `ABORTED` | 调用方中止 |
| `UNSUPPORTED_OPTION` | 请求了适配器不支持的字段 |
| `REQUEST_EXTENSION` | `deepseekLlmApiExtensions` 认领字段失败 |
| `PROVIDER_ERROR` | 提供方返回的其他错误 |

## 状态回放（ReplayEnvelope）与 BlockAssembler

- `finish.replayState` 携带提供方私有元数据（响应 ID、签名等）的最小无损 JSON 投影：`response` 不透明，`blocks` 与块逐一对齐；组装过程中丢弃某块时，同位置条目一并丢弃。
- **传递条件严格**：仅当历史提供方路由与目标提供方路由当前由**完全相同的适配器实例**拥有时，`LlmRuntime` 才传递该状态。状态缺失时**不得仅凭 provider/model 名称推断原生回放**；读取到适配器无法使用的已存状态时降级为提供方无关转换并附诊断。
- `BlockAssembler` 是唯一共享的 fold：`push()` 累积，`blocks()`/`message()`/`usage`/`finish`/`replayState`/`interruptedBlocks()` 读取。`max-tokens` 结束时丢弃不可安全执行的 tool-call。

## 模型元数据与推理强度

- 覆写 `resolveModel(provider, model, signal?)`（或 `prepareCall`）按**确切路由**返回模型身份与可选元数据：`contextWindow`、`defaultMaxTokens`、`reasoning` 强度列表、`systemPromptUpdate`（仅 `'in-history'`，其他值被 `normalizeModelInfo` 拒绝）、`toolUpdate`。
- **推理强度是有序的不透明 ID**：保留适配器给出的权威可选列表（含 `off`），不要提升为核心枚举，也不要暴露最终协议拼写。省略 `reasoning` 表示该模型无推理强度能力。仅在配置显式指定默认值时才声明 `defaultEffort`。
- catalog 仅供参考，**不是请求白名单**。

## 与 agent loop 的边界

- loop 构建的请求会**深层冻结**并带上 `markAgentLoopRequest` 进程本地标识（纯日志函数，监听器只读）；`agent/request` waterfall 可替换冻结的 `LlmCallConfig`。
- `GenerateOptions.system` **只服务单次调用方**（如会话标题生成）；loop 构建的请求**永不携带 `system` 字段**——系统提示词是派生历史中的 `system/message` surface 节点。
- `purpose?: 'compaction' | 'session-title'` 标识特殊用途调用。

## 事件与官方 API 扩展

- `llm/stream`（**waterfall**）：可短路整个流分发。
- `llm/adapters-updated`（**emit**，负载为空）：每次 commit 点触发，消费方据此重读 `listProviders()` / `listModels()`。
- `ctx.deepseekLlmApiExtensions.register(field, provider)`：认领官方请求的顶层字段；在 prepare 之后、HTTP 之前合并；`accept()` 在 2xx 后提交交付状态；失败使用 `REQUEST_EXTENSION`。

## 常见误解

- 把 `StreamChunk` 当作可扩展联合用 `default` 放行——它是封闭联合，`switch` 必须穷尽。
- 在适配器里做重试——重试是 agent 层职责。
- 认为 `GenerateOptions.system` 承载系统提示词——loop 请求没有该字段。
- 认为 `replayState` 只要 provider/model 名称对得上就会传递——必须先满足"同一适配器实例"条件。
- 把 `reasoningTokens` 加进总输出——它已包含在 `outputTokens` 内。
- 静默忽略不支持的请求字段——必须抛 `LlmError(..., 'UNSUPPORTED_OPTION')`。
