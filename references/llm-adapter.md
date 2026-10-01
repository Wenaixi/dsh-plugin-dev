# LLM 适配器与流式协议

DeepSeek Harness (DSH) 采用提供方无关（Provider-neutral）的模型调用抽象。所有具体模型 API（如 DeepSeek 官方接口、第三方兼容接口或本地端侧模型）均通过继承 `LlmAdapter` 并向 `ctx.llm`（`LlmRuntime`）注册实现无缝接入。

## 架构职责划分

- **`LlmRuntime` (`ctx.llm`)**：模型路由分配、重试策略调度、多模态计费计算（`imageRequestPricing`）、Token 消耗统一计量以及异常恢复（`agent/request-error`）。
- **`LlmAdapter`**：具体提供方的适配器实现。将标准请求（`GenerateOptions`）转换为底层厂商 API 载荷，并将厂商流式响应映射为统一的 `StreamChunk` 序列。

## 核心实现：LlmAdapter 类与注册

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
  type AdapterRegistrationHandle,
} from '@deepseek-ai/dsh-llm'

export class CustomLlmAdapter extends LlmAdapter {
  constructor(private config: Config) {
    super()
  }

  /**
   * 核心流式生成方法：输出标准 StreamChunk 异步可迭代序列
   */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { messages, model, tools, signal, temperature } = options

    // 1. 发起网络请求，禁用提供方类库自带的自动重试（由 DSH 统一管理重试）
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: this.convertMessages(messages),
        temperature,
        stream: true,
      }),
      signal,
    })

    if (!response.ok) {
      // 传输或 HTTP 状态错误直接抛出，由 Harness 调度器捕获
      throw new Error(`Provider HTTP ${response.status}: ${await response.text()}`)
    }

    // 2. 流式解析并将数据转化为标准 StreamChunk
    // 示例文本增量
    yield { type: 'text-delta', text: 'Hello, ' }
    yield { type: 'text-delta', text: 'world!' }

    // 3. 必须在结束前上报 Token 消耗统计
    yield {
      type: 'usage',
      inputTokens: 120,    // 未命中的原生输入 Token
      cachedTokens: 400,   // 命中的上下文缓存 Token（两者互斥）
      outputTokens: 50,    // 输出 Token（已含思考链 Token）
      reasoningTokens: 30, // 思考链 Token（仅供展示，不得重复计入输出）
    }

    // 4. 终结流标记
    yield {
      type: 'finish',
      reason: 'stop', // 'stop' | 'tool-calls' | 'length' | 'error' | 'aborted'
    }
  }

  private convertMessages(messages: any[]) {
    // 转换消息体至具体厂商格式
    return []
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
  providers: Schema.array(Schema.string()).default(['custom-provider']).description('绑定的提供方前缀'),
})

export function apply(ctx: Context, config: Config) {
  const adapter = new CustomLlmAdapter(config)

  // 向 LlmRuntime 注册适配器
  const handle: AdapterRegistrationHandle = ctx.llm.registerAdapter(adapter, {
    providers: config.providers,
  })

  // 声明该适配器可配置的提供方，便于 Web 设置界面识别
  ctx.llm.registerConfigurableProviders?.(config.providers)

  // 卸载时自动由 handle.dispose() 释放
}
```

## StreamChunk 协议规范

流式通信由以下受限的 Discriminated Union 构件组成：

| Chunk 类型 | 字段载荷 | 语义说明 |
| --- | --- | --- |
| `text-delta` | `text: string` | 最终可见文本增量 |
| `reasoning-delta` | `text: string` | 深度思考（Thinking）过程增量，界面独立渲染 |
| `tool-call-start` | `id: string, name: string` | 工具调用起始块，声明工具标识符与工具名 |
| `tool-call-delta` | `id: string, argsText: string` | 工具调用参数 JSON 文本增量分片 |
| `usage` | `inputTokens, cachedTokens?, outputTokens, totalTokens?, reasoningTokens?` | 单次请求计费与计量凭证 |
| `finish` | `reason: FinishReason, failure?: LlmFailure, replayState?: ReplayEnvelope` | 生成结束终结块，携带终止原因或回放包 |

## Token 计量与互斥统计原则

DSH 实现了跨提供方统一的 Token 账本计算，适配器需严格遵循**互斥计量法则**：

1. **`inputTokens`**：仅统计**未命中缓存**的输入 Token 数量。
2. **`cachedTokens`**：单独统计命中缓存（如 Prompt Cache）的输入 Token 数量。计费输入总量等于两者之和。
3. **`reasoningTokens`**：模型思考过程消耗的 Token。该数值是**已经包含在 `outputTokens` 内的信息性字段**，聚合总数时绝对不能重复叠加。

## 双轨错误处理机制 (Two Sanctioned Error Paths)

适配器支持两种错误汇报形式，均由 `LlmRuntime` 统一归一化为 `LlmFailure`：

1. **异常抛出 (Throw)**：
   适用于网络断连、TLS 握手失败、HTTP 4xx/5xx 协议层错误。在 `stream()` 执行中直接 `throw error`。
2. **终结块上报 (In-band Finish)**：
   适用于流式传输中途发生的厂商业务错误（如内容安全拦截、配额耗尽）。输出终结分片：
   ```ts
   yield {
     type: 'finish',
     reason: 'error',
     failure: {
       code: 'CONTENT_FILTERED',
       message: 'Generation blocked by provider safety policy.',
       retryable: false,
     },
   }
   ```

## 状态回放机制 (ReplayEnvelope)

为了支持大模型的前缀缓存复用或跨轮次上下文优化，适配器可在 `finish` 分片中附带私有的 JSON 状态包（`ReplayEnvelope`）。
- 该状态包会与会话持久化日志一同安全存储。
- 在后续轮次发起请求时，若当前路由命中的依然是**同一个适配器实例**，`LlmRuntime` 会将此回放状态回传给适配器，从而大幅降低二次推理解析开销。
