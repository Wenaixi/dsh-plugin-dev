# 工具开发与 ToolRuntime

面向模型的工具（Tools）由 `@deepseek-ai/dsh-tools` 提供的 `ToolRuntime` 服务（挂载于 `ctx.tools`）统一管理与调度。工具支持参数校验、多模态输出渲染、作用域遮蔽、单调安全守卫以及 PTC（代码化调用）模式投影。

## 两种注册方式

1. **`defineTool`（第一方推荐）**：类型化 DSL 辅助函数。自动根据 `parameters` 推导并校验输入参数、根据 `output.schema` 约束执行返回值，并为输出投影器 `output.render` 提供类型保障。
2. **原始 JSON Schema `ToolDefinition`（直接注册）**：`ctx.tools.register()` 直接接受标准 JSON Schema 定义。MCP（Model Context Protocol）工具导入通常采用此形式。此类工具需自行负责输入合法性校验。

## 最小可用实现 (defineTool)

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-file-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  const unregister = ctx.tools.register(defineTool({
    name: 'read_text_file',
    description: 'Read the text content of a file from disk.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Target absolute file path',
      },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'ascii'],
        description: 'File encoding, defaults to utf-8',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [
        { type: 'text', text: value }
      ],
    },
    async execute(args, options) {
      const encoding = args.encoding ?? 'utf-8'
      return await readFile(args.path, { encoding: encoding as BufferEncoding })
    },
  }))

  // unregister() 可手动注销；所属插件卸载时会自动注销
}
```

## ToolRuntime 核心方法契约

### 1. 注册与作用域遮蔽：`ctx.tools.register()`

```ts
register(definition: ToolDefinition): () => void
```

- 全局上下文注册的工具对所有 Agent 实例可见。
- 在子作用域（如 `agent.ctx`）注册的工具仅在该 Agent 内部可见，且会同名遮蔽全局工具。
- 保留工具名称 `run_code` 禁止重复注册，否则抛出异常。
- 返回值是严格的注销函数（Disposer），卸载时可逆回滚。

### 2. 呈现模式投影：`ctx.tools.presentAs()`

```ts
presentAs(mode: ToolPresentationMode): () => void
```

- 控制模型所看到的工具呈现形态。
- **Native 模式**：将工具转换为标准的模型函数调用 JSON Schema 格式。
- **PTC 模式 (Programmatic Tool Calling)**：将所有可用工具集中投影为 TypeScript 类型声明与 `run_code` 单一沙箱入口，由模型编写可执行 TypeScript 脚本并发调度。
- 采用就近优先原则（Nearest scope wins），Agent 预设声明的呈现模式覆盖全局默认值。

### 3. 单调安全守卫：`ctx.tools.guard()`

```ts
guard(guard: ToolGuard): () => void
```

守卫在 `tools/pre-execute` 流程之后触发，用于实现强制访问控制与鉴权：

```ts
type ToolGuard = (call: ToolCallContext) => string | undefined | void
```

- **单调安全法则**：任何匹配的守卫只要返回字符串错误原因，调用即被判定为拒绝（Deny）。**任何守卫均不可强制放行被其他守卫已拒绝的调用**。
- 全局上下文注册的守卫对所有调用生效；`agent.ctx` 注册的守卫仅对该 Agent 生效。
- 示例：禁止在非安全路径执行写入：
  ```ts
  ctx.tools.guard((call) => {
    if (call.toolName === 'write_file' && !call.args.path.startsWith('/sandbox/')) {
      return 'Permission denied: Writes outside /sandbox/ are restricted.'
    }
  })
  ```

### 4. 作用域工具限制：`ctx.tools.restrict()`

```ts
restrict(filter: ToolRestriction): () => void
```

为指定 Agent 作用域过滤可调用的全局工具集：

```ts
interface ToolRestriction {
  allow?: string[] // 白名单：仅允许使用的全局工具名称
  deny?: string[]  // 黑名单：禁止使用的全局工具名称
}
```

限制规则取交集生效。局部作用域内自行注册的工具不受全局限制影响。

## 多模态输出投影与 ContentBlock

工具执行完毕后的输出通过 `output.render` 转换为模型可见的消息内容块（`ContentBlock`）：

```ts
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'file'; name: string; content: string }
  | { type: 'reasoning'; text: string }
```

### 渲染图文混排结果示例

```ts
output: {
  schema: {
    type: 'object',
    properties: {
      chartData: { type: 'string' },
      imageBuffer: { type: 'string' },
    },
    required: ['chartData', 'imageBuffer'],
  },
  render: (_args, value) => [
    { type: 'text', text: `Data analysis report: ${value.chartData}` },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: value.imageBuffer,
      },
    },
  ],
}
```

## 执行上下文与中断支持

`execute` 方法的第二个参数为执行选项 `ToolExecutionOptions`：

```ts
async execute(args, { signal, agent, session }) {
  // 响应取消信号（如用户点击中断按钮或轮次超时）
  if (signal?.aborted) {
    throw new Error('Tool execution aborted by user.')
  }

  // 长时间异步任务需将 signal 传递给底层系统调用或 fetch
  const response = await fetch(args.url, { signal })
  return await response.text()
}
```

遵循此规范可确保工具在用户中止生成或退出会话时立刻释放系统资源与子进程，避免僵尸进程滞留。
