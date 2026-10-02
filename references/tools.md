# 工具开发与 ToolRuntime

面向模型的工具（Tools）由 `@deepseek-ai/dsh-tools` 的 `ctx.tools`（core 角色）统一管理。官方职责口径：**注册能力、负责 PTC 模式传输，并让调用依次经过策略前处理、单调守卫、环绕分派、策略后处理和最终结果观测**。

## 两种注册方式

1. **`defineTool`（第一方推荐）**：类型化 DSL。自动根据 `parameters` 推导并校验输入参数、根据 `output.schema` 校验返回值，并为 `output.render` 提供类型保障。
2. **原始 JSON Schema `ToolDefinition`（直接注册）**：`ctx.tools.register()` 接受标准 JSON Schema 定义（MCP 工具导入常用）。此类工具自行负责输入合法性校验。

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
      path: { type: 'string', required: true, description: 'Target absolute file path' },
      encoding: { type: 'string', enum: ['utf-8', 'ascii'], description: 'File encoding, defaults to utf-8' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args 已由 defineTool 依据 parameters 推导并校验
      return await readFile(args.path, { encoding: (args.encoding ?? 'utf-8') as BufferEncoding })
    },
  }))
  // unregister() 可手动注销；所属插件 fiber 卸载时自动注销
}
```

## ToolDefinition 字段契约

```ts
interface ToolDefinition extends ToolSchema {
  // ToolSchema = { name; description; parameters; deferLoading? }
  output: ToolOutputDefinition            // 必填
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?(ctx: ProjectContentContext): Promise<void> // 由定义自身控制
  finalizeContent?(ctx: FinalizeContentContext): Promise<void>
  timeoutMs?: number                      // 由 dsh-tool-call-timeout-policy（tools/execute 包装）执行
  isConcurrencySafe?(args): boolean       // 控制与 extern 并发的合规性
  presentCall?(args): ToolCallView | undefined
  presentResult?(args, result): ToolResultView | undefined
}
```

- **`schemas()` 白名单**：模型请求中只包含 `name` / `description` / `parameters`。`output`、`execute`、`projectContent`、`finalizeContent`、`timeoutMs`、`isConcurrencySafe`、`presentCall`、`presentResult` **绝不泄漏到模型请求**。
- **注册基于副作用**：dispose 工具所属插件 fiber 即注销；热替换 = dispose 副作用 + 注册替代品。
- **注册借用只读定义**：注册后不得修改 schema、不得替换回调。
- **`exec`（ToolRunContext）携带不可变身份**：`callId` / `name` / `arguments`（物化为无损 JSON 并冻结）/ `agent` / `token` / `signal` / `parent` 全程不可变；`exec.signal` 是操作字段（触发时取消工作），仅 around-dispatch 包装器可替换并恢复它（不能移除）。

## 执行流水线（顺序固定）

```
tools/pre-execute (waterfall)   →  allow/deny/cancel/ask 决策
       ↓
单调 guard（ctx.tools.guard）   →  返回 string 即拒绝；无 allow 结果
       ↓
tools/execute (waterfall)      →  环绕包装（截止时间/重试/指标）；只能替换 signal
       ↓
projectContent                  →  在执行后策略之前安装已准备内容
       ↓
tools/post-execute (waterfall)  →  accept：替换展示 content 或 value 二选一；block：转含纠正反馈的 isError
       ↓
finalizeContent                 →  定义拥有的回调，恰好一次
       ↓
tools/result (emit)             →  观察冻结的权威结果；观察者失败隔离
```

要点：

- 三个 waterfall（pre-execute / execute / post-execute）可以改写**一次调用**，但不能替换工具定义本身。
- 未知工具名或执行抛异常 → `UNKNOWN_TOOL` 结构化错误，**不终止轮次**。
- `tools/result` 是 emit 观察，结果不可变、不可变换；规范 value 仅执行期存在，持久化只存 `content` / `error` / `meta`。
- `ctx.approval` 询问在单调守卫之前处理。

## 执行调度

- `executionMode(exec)`：只有**精确 true** 才 `parallel`，否则 `exclusive`（屏障）。
- `timeoutMs` 由 `dsh-tool-call-timeout-policy` 包裹 `tools/execute` 执行；超时是"环绕分发"关注点，不属于工具定义。

## 策略钩子与决策类型

```ts
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: ToolInfo }
  | { kind: 'cancel'; reason?: string }
  | { kind: 'ask'; reason?: string; displayReason?: string }

type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: unknown } // 二选一
  | { kind: 'block'; reason: string; error?: string }
```

**单调安全法则（guard）**：

- 任何匹配的守卫只要返回字符串错误原因，调用即被判定为拒绝（Deny）。
- guard **没有 allow 结果**：后注册的监听器不可能把先前的拒绝变回允许（单调用器的单调性）。
- 全局上下文注册的守卫对所有调用生效；`agent.ctx` 注册的守卫仅对该 Agent 生效。
- 示例：
  ```ts
  ctx.tools.guard((call) => {
    if (call.toolName === 'write_file' && !call.args.path.startsWith('/sandbox/')) {
      return 'Permission denied: Writes outside /sandbox/ are restricted.'
    }
  })
  ```

**`restrict(filter)` 作用域限制**：

```ts
interface ToolRestriction {
  allow?: string[] // 白名单
  deny?: string[]  // 黑名单
}
```

- 只掩码**继承的全局工具**（allow/deny 交集）；作用域自身注册与保留的 PTC 传输不受影响。
- 空过滤器 / 未知名 / 作用域本地名 / 保留传输名都会失败。
- scope 链上每个祖先 layer 都参与。

## 呈现模式：`presentAs(mode)`

- **Native 模式**：将工具转换为标准模型函数调用 JSON Schema。
- **PTC 模式（Programmatic Tool Calling）**：将所有可见工具集中投影为 `tools.<name>(args)` 绑定，由模型编写可执行代码并发调度。
- 采用就近优先原则（Nearest scope wins）；`presentAs` 仅作用域内生效、每 scope 一次，进程全局覆盖用 `mode` 配置字段。

## PTC 模式调用约定

```ts
// 在 PTC 程序中：每个可见已注册工具都可用
const value = await tools.calculate({ expression: '1 + 1' })
```

- 成功解析为**策略处理后的最终规范 JSON 值**（不是渲染后的 Native 内容）。
- 失败以真正的 `ToolCallError` reject，程序只能访问 `name` / `toolName` / `message`——**无法取得内部错误码或失败联合**。
- PTC 子调用重新进入完整且受守卫保护的流水线，携带父级 token，记录 `tool/ptc-dispatch` 事件。
- **后台任务**：`ctx.jobs.start({ kind, label, owner: exec.agent, run })`，成功返回类型化句柄 `{ kind: 'background', jobId }`；**PTC 绝不能通过解析 Native 文本取 jobId**。任务发布后取消外层调用只停止等待、不终止已发布的工作（生命周期归 `job_kill` / owner dispose / teardown）。
- `exec.agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })`：追加持久化上下文（非唤醒；空闲 agent 保持空闲；对已 dispose 的 agent 用 try/catch 防御）。

## 多模态输出与展示投影

- `output.schema` 根可为对象 / 数组 / 标量 / null；`execute` 只返回推导出的规范值，注册表负责 快照 → 校验 → 冻结 → `output.render(args, value)`。
- 抛异常或返回无效值 = isError；**领域不理想状态也应写进规范值**，由 Native 渲染器解释。
- `output.presentationMeta(args, value)` 从同一规范值派生**可回放**的 JSON，核心持久化在 `tool/result` 并传给 `presentResult`（嵌套 Code 分发跳过该投影器）。
- **展示词汇（纯函数）**：直播与回放都可能调用，禁止 I/O、读会话状态、时钟或随机数。
  - `presentCall` → `ToolCallView`: generic / terminal / diff（read / search / web 工具无调用视图，pending 保持 generic）
  - `presentResult` → `ToolResultView`: generic / terminal / diff / read / search / web
  - `ToolCallKind`: read | edit | delete | move | search | execute | fetch | other
- `defineTool` 对展示路径做**软校验**：格式错误或旧日志参数回退 generic，绝不抛异常。
- UI 格式（\`\`\`console 围栏、diff、相对化路径）**绝不进入规范值或 Native 内容**。

## Web Client 与展示的边界（重要）

内置 Web Client **不消费 `presentCall` / `presentResult`**。Session 页面与 follow 运输原始 `tool/call` 与 `tool/result` 事件（含持久化的 `result.meta`）；Client 插件在 keyed slot `tool.call.toolview` 注册自己的 wire 工具名并自行派生组件 props。

- 不要在 `metadata` 里保存 React props 或预选卡片。
- 不要把 Host 工具实现导入浏览器 bundle。
- 不要另建 Client presenter registry。

## 常见误解

- 认为 `tools/pre-execute` 可以改写参数——参数在 pre-execute 阶段禁止改写（历史 / 审计 / UI / 执行必须一致）。
- 认为 `tools/result` 可以变换结果——它是 emit 观察，结果冻结。
- 认为"替换 content"能隐藏程序化值——那是展示策略；要隐藏必须 block 或替换 value。
- 钩子可跨工具系列工作，无需让工具与某个策略服务耦合。
