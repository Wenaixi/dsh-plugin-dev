# DSH 模型工具体系与 ToolRuntime 参考指南

本文件整理工具定义、执行管线和单调守卫的核验要点。工具名、包归属、阶段顺序和返回值必须按目标版本的实际发布物与运行时复核。

> 术语说明：官方 README 把执行路径描述为固定管线（pre-execute → 单调 guards → execute → post-execute → finalizeContent → result，共 8 步）。下文「16 环节」是本文档为讲解方便展开的编号，**不是源码里的枚举**；其中 `presentCall`/`presentResult` 是工具定义上**可选的纯渲染描述符**（dsh-tools 调度器从不调用它们，属 Host-local 消费者读取面），阶段 8（FS Gate）是 `dsh-tool-fs` 工具内部行为。

---

## 一、ToolRuntime 核心职责与设计理念

`ctx.tools`（所属包 `@deepseek-ai/dsh-tools`）是面向大模型暴露能力的中央运行时：
1. **单一入口 PTC 模式与原生 Function Calling**：支持原生模式、PTC (Program-Tool-Calling) 模式（`tools.presentAs`）；
2. **卡片渲染描述符**：工具可声明纯渲染描述符供 Host-local 消费者使用；内置 Web GUI 不消费 `presentCall`/`presentResult`，卡片由客户端推导；
3. **单调安全保证**：执行单调守卫，确保权限阻断不可逆；
4. **统一错误规范化**：工具抛出的异常被优雅捕获并规范化为 `isError` 结构，永不导致 Agent 轮次意外中断。

---

## 二、官方工具执行时序 (Tool Execution Pipeline)

基于 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-agent-loop` 的源码实测，工具调用在宿主运行时的时序如下（编号为讲解方便，真实调度器环节为 12-13 个，presentCall/presentResult 不计入）：

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
| `skill` | `@deepseek-ai/dsh-tool-skill` | 按名加载技能并渲染 `<skill_content>`（rank 体系属 `dsh-skill`/`dsh-skill-filesystem`：档位 100/200/250/300/400/500/600，rank 小者胜，与本工具无关） |
| `subagent`, `subagent_fork` | `@deepseek-ai/dsh-tool-subagent` | 委派子代理：同一插件按 `config.toolName` 实例化多个工具（默认 `toolName=subagent`；典型装配 `subagent`=provider `spawn` 与 `subagent_fork`=provider `fork`，可再装配 disabled 实例） |
| `list_agents`, `send_message`, `interrupt_agent` | `@deepseek-ai/dsh-tool-subagent-control` | 查看智能体列表、向智能体发送信件、中断执行 |
| `job_output`, `job_kill`, `job_list` | `@deepseek-ai/dsh-tool-jobs` | 异步长耗时后台任务结果读取、终止与任务列表查询 |
| `create_goal`, `get_goal`, `update_goal` | `@deepseek-ai/dsh-tool-goal` | 会话持久化目标管理与多轮次自驱推进 |
| `exit_plan_mode` | `@deepseek-ai/dsh-plan-mode` | 退出计划模式，将完成的方案呈递给用户审核 |
| `ask_user_question` | `@deepseek-ai/dsh-tool-ask-user` | 向用户发起结构化提问卡片 |
| `todo_write` | `@deepseek-ai/dsh-tool-todo` | 记录并更新任务看板列表 |
| `present` | `@deepseek-ai/dsh-tool-present` | 将本地现有文件声明为最终交付物卡片 |
| `web_search`, `web_fetch` | `@deepseek-ai/dsh-tool-web`（执行经 `ctx.web` seam，官方引擎包 `dsh-web-search-deepseek` / `dsh-web-fetch-http`） | 网络搜索引擎检索与网页全文内容提取 |
| `schedule_create`, `schedule_list`, `schedule_delete`, `schedule_update` | `@deepseek-ai/dsh-schedule` | 宿主持久化定时任务管理四件套 |
| `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_*` | `@deepseek-ai/dsh-experimental-tool-agent-team` | Agent Teams 多智能体团队编排与共享任务看板协同工具（**实验性包**，需挂载配套组合包方可使用） |
| `ralph` | `@deepseek-ai/dsh-tool-ralph` | 长周期目标续跑工具（条目是否启用取决于 profile 配置） |
| `list_subagent_models` | `@deepseek-ai/dsh-tool-subagent` | 列出可用的子代理 provider/model 路由（`tool-subagent` 配置 `modelSelectionSettings: true` 时注册） |
| `read_page` | `@liustack/modsearch` 桥（非 @deepseek-ai 官方包） | 读取单页网页内容（第三方桥，由宿主运行时按版本注入） |
| `x_search` | `@liustack/modsearch` 桥（非 @deepseek-ai 官方包） | 搜索 X（Twitter）帖子（同上，宿主运行时按版本注入） |

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

---

## 九、特权工具与外部服务的多级物理守卫模式 (Multi-Tier Tool Guard Pattern)

当插件向宿主注册特权工具（如代码执行、外部生产 API 调用、特权网桥或 MCP 接入）时，既要支持用户全局一键关闭，又要支持在特定安全预设中按需隔离。仅靠提示词软约束无法防范模型幻觉或跨会话污染，必须构建**双道物理防线与双重短路机制**：

### 9.1 双道物理防线架构

在 `agent/created` 全局事件监听器中，对新建的智能体实例上下文 `agentCtx` 施加双重保护：

1. **第一道防线：静态目录物理剥离 (`tools.restrict`)**：
   - 目标：从模型提示词中彻底移除工具描述；
   - 动作：调用 `agentCtx.tools.restrict({ deny: PRIVILEGED_TOOLS })`；
   - 效果：模型在构建 Prompt 时收到的工具列表（Tool Definition List）中完全看不到这些特权工具，从源头消灭模型的调用意图。
2. **第二道防线：运行期执行拦截抛错 (`tools.guard`)**：
   - 目标：防范历史长上下文残留记忆或模型幻觉盲调；
   - 动作：挂载单调运行期守卫 `agentCtx.tools.guard((exec) => ...)`；
   - 效果：一旦检测到受限工具名称，同步返回明确的中文拒绝理由（如「特权工具已在设置中关闭」或「该工具仅在专属预设下可用」），直接中断执行管线并安全交付阻断结果，杜绝穿透可能。

### 9.2 双重短路逻辑 (Master Switch vs Preset Scope)

拦截守卫必须区分「全局主控关闭」与「按预设作用域隔离」两种状态：

```ts
function installToolGuard(ctx: Context, options: {
  getEnabled: () => boolean
  getScopeMode: () => 'preset' | 'global'
  getAgentPresets: () => any
  getTools: () => any
}): () => void {
  return (ctx as any).on('agent/created', (payload: any) => {
    const isActive = options.getEnabled()
    const isIsolated = options.getScopeMode() === 'preset'
    // 若总控开启且为全局模式，全量放行
    if (isActive && !isIsolated) return

    const targetAgent = payload?.agent ?? payload
    const agentCtx = targetAgent?.ctx
    if (!agentCtx) return
    const toolsService = options.getTools()
    if (toolsService === undefined) return

    try {
      const presetId = options.getAgentPresets()?.composedPreset?.(agentCtx)
      // 判定是否拦截：主控关闭则无条件全量拦截；主控开启时仅拦截非专属预设会话
      const shouldBlock = !isActive || presetId !== 'dedicated-preset'
      if (shouldBlock) {
        const known: Set<string> | undefined = agentCtx.tools?.view?.()?.restrictableNames
        const denyTargets = known ? PRIVILEGED_TOOLS.filter((t) => known.has(t)) : PRIVILEGED_TOOLS
        
        // 防线 1：静态目录剥离
        if (denyTargets.length > 0 && typeof agentCtx.tools?.restrict === 'function') {
          agentCtx.tools.restrict({ deny: denyTargets })
        }
        // 防线 2：运行期动态守卫
        if (typeof agentCtx.tools?.guard === 'function') {
          agentCtx.tools.guard((exec: { name: string }) => {
            if (PRIVILEGED_TOOLS.includes(exec.name)) {
              return !isActive
                ? '特权工具已在设置中全局关闭'
                : '该特权工具仅在专属智能体预设下可用'
            }
          })
        }
      }
    } catch (e) {
      ctx.logger.debug?.('[plugin] tools guard failed: ' + String(e))
    }
  }, { global: true })
}
```

### 9.3 响应式配置联动与生命周期可逆性
- 守卫状态必须通过闭包动态函数（如 `options.getEnabled`）读取，结合宿主 `settings/document-updated` 事件广播，配置变更免重启即时生效；
- 安装器必须遵循对称具名安装器规范（Symmetric Named Installer），返回标准清理函数，卸载时注销事件监听与运行期守卫，零资源泄漏。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/core/agent-loop  <-  @deepseek-ai/dsh-agent-loop@0.2.0-rc.2
packages/experimental/tool-agent-team  <-  @deepseek-ai/dsh-experimental-tool-agent-team@0.2.0-rc.2
packages/plan/plan-mode  <-  @deepseek-ai/dsh-plan-mode@0.2.0-rc.2
packages/schedule/schedule  <-  @deepseek-ai/dsh-schedule@0.2.0-rc.2
packages/skill/skill  <-  @deepseek-ai/dsh-skill@0.2.0-rc.2
packages/skill/skill-filesystem  <-  @deepseek-ai/dsh-skill-filesystem@0.2.0-rc.2
packages/interaction/tool-ask-user  <-  @deepseek-ai/dsh-tool-ask-user@0.2.0-rc.2
packages/shell/tool-bash  <-  @deepseek-ai/dsh-tool-bash@0.2.0-rc.2
packages/guard/timeout-policy  <-  @deepseek-ai/dsh-tool-call-timeout-policy@0.2.0-rc.2
packages/fs/tool-fs  <-  @deepseek-ai/dsh-tool-fs@0.2.0-rc.2
packages/fs/tool-fs-search  <-  @deepseek-ai/dsh-tool-fs-search@0.2.0-rc.2
packages/goal/tool-goal  <-  @deepseek-ai/dsh-tool-goal@0.2.0-rc.2
packages/jobs/tool-jobs  <-  @deepseek-ai/dsh-tool-jobs@0.2.0-rc.2
packages/deliverables/tool-present  <-  @deepseek-ai/dsh-tool-present@0.2.0-rc.2
packages/shell/tool-pwsh  <-  @deepseek-ai/dsh-tool-pwsh@0.2.0-rc.2
packages/workflow/tool-ralph  <-  @deepseek-ai/dsh-tool-ralph@0.2.0-rc.2
packages/skill/tool-skill  <-  @deepseek-ai/dsh-tool-skill@0.2.0-rc.2
packages/subagent/tool-subagent  <-  @deepseek-ai/dsh-tool-subagent@0.2.0-rc.2
packages/subagent/tool-subagent-control  <-  @deepseek-ai/dsh-tool-subagent-control@0.2.0-rc.2
packages/todo/tool-todo  <-  @deepseek-ai/dsh-tool-todo@0.2.0-rc.2
packages/web/tool-web  <-  @deepseek-ai/dsh-tool-web@0.2.0-rc.2
packages/core/tools  <-  @deepseek-ai/dsh-tools@0.2.0-rc.2
packages/web/web-fetch-http  <-  @deepseek-ai/dsh-web-fetch-http@0.2.0-rc.2
packages/web/web-search-deepseek  <-  @deepseek-ai/dsh-web-search-deepseek@0.2.0-rc.2
```
