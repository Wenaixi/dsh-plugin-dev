# DSH 模型工具体系与 ToolRuntime 权威指南 (DSH 0.2.0-rc.2)

本文件是 DeepSeek Harness (DSH 0.2.0-rc.2) 工具定义规范、工具执行时序、单调守卫法则与官方工具归属全貌的技术规范。

> 术语说明：官方 README 把执行路径描述为固定管线（pre-execute → 单调 guards → execute → post-execute → finalizeContent → result）。下文「16 环节」是本文档为讲解方便展开的编号，**不是源码里的枚举**；其中阶段 2（`presentCall`）与阶段 16 的 `presentResult` 半边并非调度器环节，阶段 8（FS Gate）是 `dsh-tool-fs` 工具内部行为。

---

## 一、ToolRuntime 核心职责与设计理念

`ctx.tools`（所属包 `@deepseek-ai/dsh-tools`）是面向大模型暴露能力的中央运行时：
1. **单一入口 PTC 模式与原生 Function Calling**：支持原生模式、PTC (Program-Tool-Calling) 模式（`tools.presentAs`）；
2. **卡片渲染描述符**：工具可声明纯渲染描述符供 Host-local 消费者使用；内置 Web GUI 不消费 `presentCall`/`presentResult`，卡片由客户端推导；
3. **单调安全保证**：执行单调守卫，确保权限阻断不可逆；
4. **统一错误规范化**：工具抛出的异常被优雅捕获并规范化为 `isError` 结构，永不导致 Agent 轮次意外中断。

---

## 二、官方工具执行时序 (Tool Execution Pipeline)

基于 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-agent-loop` 的源码实测，工具调用在宿主运行时的时序如下（13 个调度器/循环环节 + 3 个非调度器环节）：

```
[阶段 1] tool/call 持久化记录
         └─ agent-loop 在调用启动时先 append 至 SessionEvent，产生分配的 callSeq
   ↓
[阶段 2] presentCall 调用卡片投影（非调度器环节）
         └─ 工具可选声明的纯渲染描述符，供 Host-local 消费者使用；官方内置 Web Client 不消费它，卡片由客户端依 tool.call.toolview 与原始参数/元数据推导
   ↓
[阶段 3] tools/pre-execute (waterfall) 策略前处理
         └─ 返回 allow / ask / deny / cancel 决策；严禁改写 arguments
   ↓
[阶段 4] approval 一次性审批裁决
         └─ 若 pre-execute 返回 ask，由 ctx.approval 弹出用户确认（allowed-once / rejected / cancelled / unavailable；非 allow 统一转 deny）
   ↓
[阶段 5] 单调 guard 守卫终极校验 (单调否决权)
         └─ ctx.tools.guard 仅对 allow 调用执行；返回 string 立即拒绝，返回 undefined 弃权。审批通过仍可被 guard 否决！
   ↓
[阶段 6] tools/execute (waterfall) 环绕分派
         └─ 官方超时包裹由 dsh-tool-call-timeout-policy 注册（错误码 TOOL_TIMEOUT）；仅允许替换并融合 exec.signal。重试与性能指标无官方实现，该事件只是扩展点
   ↓
[阶段 7] execute 主体业务执行
         └─ 工具定义中的 execute(args, exec) 执行核心逻辑，返回类型化规范输出
   ↓
[阶段 8] FS Gate 文件写网关（非调度器环节，属 dsh-tool-fs 工具内部）
         └─ 针对 tool-fs 可写操作，在写/改磁盘前触发 fs/write-intent、fs/edit-intent 拦截，随后 emit fs/observed
   ↓
[阶段 9] 工具自有内部事件派发
         └─ 工具派发专属领域事件（如 todo/write、fs/observed、tool/ptc-dispatch-start）
   ↓
[阶段 10] ToolDefinition.projectContent 内容预投影
         └─ 在 post-execute 前安装已准备好的 content。注意：即使被 deny 阻断也会进入该阶段生成解释文本！
   ↓
[阶段 11] tools/post-execute (waterfall) 策略后处理
         └─ accept (替换 content/value) 或 block (转换为纠正反馈 isError)
   ↓
[阶段 12] 外层结果规范化与错误定型
         └─ materializeFinalResult 捕获全阶段异常，统一打包为 { content, isError, error? } 结构
   ↓
[阶段 13] ToolDefinition.finalizeContent 内容收尾
         └─ 工具拥有的最终内容处理回调，保证恰好执行一次
   ↓
[阶段 14] tools/result (emit) 同步结果广播
         └─ 结果已完全冻结不可篡改，同步广播给全局与 Agent 观察者，单个监听器异常被隔离
   ↓
[阶段 15] tool/result 持久化事件写入
         └─ agent-loop 按模型顺序 commit 至 SessionEvent，附带 surfaceOp: 'append' 与 sourceEventSeqs: [callSeq]
   ↓
[阶段 16] presentResult 结果卡片展示投影与上下文注入
         └─ presentResult 同样无调度器消费（非调度器环节）；additionalContexts 按 commit 顺序 FIFO 注入下一轮历史
```

### 关键架构时序辨析
1. **Approval 与 Guard 的先后关系**：源码中当 `pre-execute` 决策为 `ask` 时，**先调 `serviceAsk`（`ctx.approval`）获取用户审批**；用户点击允许后，**再执行单调 `guard`**！单调守卫拥有硬性一票否决权，防止用户意外误点批准了违规路径操作。
2. **`projectContent` 在 Denied 场景下的生命周期保证**：即使工具调用被中间件阻断（`decision.kind === 'deny'`），主体 `execute` 会跳过，但流水线**依然会执行 `projectContent`**，为模型生成易于理解的阻断原因提示块。

---

## 三、单调安全守卫法则 (Monotonic Guard)

注册单调守卫示例：
```js
ctx.tools.guard((exec) => {
  if (exec.name === 'bash' && exec.arguments.command.includes('rm -rf /')) {
    return '绝对禁止高危毁灭性根目录删除命令'
  }
  // 返回 undefined 表示弃权，不阻断
})
```
- **单调不可逆性**：多个守卫链式检查，只要有任何一个守卫返回非空字符串（Deny 理由），该调用立即被判定为阻断；后注册的守卫绝无可能“取消”前序守卫的拒绝裁决。

---

## 四、官方工具归属包与命名全貌矩阵

| 工具名 | 官方所属包 | 职责与模型用途 |
| --- | --- | --- |
| `run_code` | `@deepseek-ai/dsh-tools` | PTC 单入口沙箱，执行 TypeScript 代码以调用环境中的其他能力 |
| `bash` | `@deepseek-ai/dsh-tool-bash` | 非交互式 Bash 命令执行 |
| `pwsh` | `@deepseek-ai/dsh-tool-pwsh` | 非交互式 PowerShell 命令执行 |
| `read`, `read_image`, `edit`, `write` | `@deepseek-ai/dsh-tool-fs` | 文本文件读取、图像多模态读取、文本精准替换、全量写入 |
| `glob`, `grep` | `@deepseek-ai/dsh-tool-fs-search` | 路径模式匹配与基于 ripgrep 的文件内容正则检索 |
| `skill` | `@deepseek-ai/dsh-tool-skill` | 载入技能指令规范（支持六级 rank 100-600 注入） |
| `subagent` | `@deepseek-ai/dsh-tool-subagent` | 委派子代理；单个可配置工具（toolName 默认 `subagent`），「继承当前上下文」的 fork 语义由所选 provider 的 `inheritsParentContext` 能力决定，不存在独立的 `subagent_fork` 工具 |
| `list_agents`, `send_message`, `interrupt_agent` | `@deepseek-ai/dsh-tool-subagent-control` | 查看智能体列表、向智能体发送信件、中断执行 |
| `job_output`, `job_kill`, `job_list` | `@deepseek-ai/dsh-tool-jobs` | 异步长耗时后台任务结果读取、终止与任务列表查询 |
| `create_goal`, `get_goal`, `update_goal` | `@deepseek-ai/dsh-tool-goal` | 会话持久化目标管理与多轮次自驱推进 |
| `exit_plan_mode` | `@deepseek-ai/dsh-plan-mode` | 退出计划模式，将完成的方案呈递给用户审核 |
| `ask_user_question` | `@deepseek-ai/dsh-tool-ask-user` | 向用户发起结构化提问卡片 |
| `todo_write` | `@deepseek-ai/dsh-tool-todo` | 记录并更新任务看板列表 |
| `present` | `@deepseek-ai/dsh-tool-present` | 将本地现有文件声明为最终交付物卡片 |
| `web_search`, `web_fetch` | `@deepseek-ai/dsh-tool-web`（执行经 `ctx.web` seam，官方引擎包 `dsh-web-search-deepseek` / `dsh-web-fetch-http`） | 网络搜索引擎检索与网页全文内容提取 |
| `schedule_create`, `schedule_list`, `schedule_delete`, `schedule_update` | `@deepseek-ai/dsh-schedule` | 宿主持久化定时任务管理四件套 |
| `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_*` | `@deepseek-ai/dsh-experimental-tool-agent-team` | Agent Teams 多智能体团队编排与共享任务看板协同工具 |
| `ralph` | `@deepseek-ai/dsh-tool-ralph` | 代码重构与分析助手工具 |

---

## 五、自定义工具编写规范 (defineTool)

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'calculate_hash',
      description: '计算指定字符串的 SHA-256 哈希值',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待计算哈希的明文字符串' }
        },
        required: ['text']
      },
      // 必须声明返回类型
      output: {
        type: 'object',
        properties: {
          hash: { type: 'string' }
        }
      },
      async execute({ text }, exec) {
        // exec 提供信号和调用元数据
        if (exec.signal.aborted) {
          throw new Error('执行已被取消')
        }
        const crypto = await import('node:crypto')
        const hash = crypto.createHash('sha256').update(text).digest('hex')
        return { hash }
      }
    })
  )
}
```

---

## 六、官方 ToolRuntime 底层安全与隔离四大契约 (源码级深度揭秘)

基于 `@deepseek-ai/dsh-tools` 源码（第 3410~3480 行），流水线在调度和收尾阶段贯彻了四项绝对安全铁律：

### 1. `Object.freeze(exec)` 调用元数据绝对冻结
在执行流水线第 14 阶段派发 `tools/result` 事件前，调度器会对当前调用的执行对象执行硬性冻结：
```js
Object.freeze(exec);
```
- 杜绝任何后置观察者、事件监听器或第三方插件篡改已完成调用的名称、参数、Agent 句柄或调用 ID。

### 2. 观察者故障绝对隔离 (Observer Fault Isolation)
流水线在向外部广播 `tools/result` 同步通知时，采用双重异常隔离机制：
```js
const callbacks = this.ctx.events.dispatch("emit", [scopeTarget(this, exec.agent), "tools/result", exec, result]);
for (const callback of callbacks) {
  try {
    const returned = callback(exec, result);
    Promise.resolve(returned).catch(reportFailure);
  } catch (error) {
    reportFailure(error);
  }
}
```
- **安全保障**：无论是同步抛出的异常还是异步 Reject，调度器仅记录 `ctx.logger.warn` 警告日志，**绝不中断工具结果交付**，单个恶意或崩溃的监听器绝对无法拖垮 Agent 轮次。

### 3. `finalizeContent` 权限受限的内容收尾
工具定义中可选提供的 `finalizeContent(exec, result)` 回调拥有严格的权限边界：
- 调度器仅提取其返回值并更新 `content` 数组；
- 工具开发者**无法接触也无法篡改**系统的 `isError`、`error` 等判定字段，保证错误分类的绝对纯洁性。

### 4. `serviceAsk` 审批服务机会性消费与安全降级
当策略中间件在第 3 阶段返回 `{ kind: "ask" }` 时，系统调用 `serviceAsk` 解析审批结果：
- **机会性消费 (Opportunistic Consumption)**：通过 `ctx.get("approval")` 动态获取审批服务；
- **自动降级为 Deny**：
  1. 若当前环境未加载审批服务插件（如无头环境），系统**自动降级为 `deny`**（报错 `requires approval (not yet supported)`）；
  2. 若当前调用未绑定 Agent 句柄（Agent-less），无法审计且无前端 UI，系统同样**自动降级为 `deny`**；
  3. 唯有具备完整 Agent 且已挂载审批服务的调用，才会弹出真实的人类确认弹窗。
