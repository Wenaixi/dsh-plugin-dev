# 自主目标系统：Service Goals、生命周期与跨轮驱动器

> 适用范围：DSH v0.2.1+ 架构下基于 Cordis 微内核实现多轮长任务自动化驱动、目标持久化折叠、工具权限判据与安全熔断机制的插件开发与集成。
> 核心命题：**自主目标系统 (Goal-Driven System) 是 DSH 从单轮交互走向自主智能体 (Autonomous Agent) 的核心枢纽；通过在 Session 中维护具名目标、以受限状态机管理推进状态、以纯函数折叠持久化历史，并由驱动器在回合静止时注入延续提示词，配合连续 3 轮无法推进的严格阻断门禁，杜绝长任务无端半途放弃或陷入无限空转。**

---

## 一、自主目标系统架构总览

在传统的对话驱动模式中，智能体通常依赖用户在每一轮输入中主动提出指引或输入延续指令。DSH v0.2.1 正式引入了面向长周期工程任务的自主目标系统。该系统由四个正交解耦的包协同构成：

1. **核心领域模型与服务 (`@deepseek-ai/dsh-goal`)**：定义目标领域的数据结构、状态机、品牌类型及纯函数折叠逻辑，向 Cordis Context 注册 `goals` 服务；
2. **跨轮延续驱动器 (`@deepseek-ai/dsh-goal-round-driver`)**：监听智能体生命周期与会话事件，在智能体静止 (quiescent) 时自动分发下一轮推进提示词；
3. **模型交互工具集 (`@deepseek-ai/dsh-tool-goal`)**：向模型提供 `create_goal`、`get_goal` 与 `update_goal` 三项结构化工具，并施加严密的操作权限判据；
4. **前端交互界面 (`@deepseek-ai/dsh-client-ui-goal`)**：在 Web GUI 中渲染目标卡片、进度状态与人工干预控件。

```text
+-----------------------------------------------------------------------------------+
|                             Cordis Context (ctx)                                  |
|                                                                                   |
|  +--------------------+        +-------------------------+        +------------+  |
|  |     ctx.goals      | <----> |    goal-round-driver    | <----> | ctx.agents |  |
|  | (GoalService 实体) |        | (Same-session 驱动器)   |        | (智能体树) |  |
|  +--------------------+        +-------------------------+        +------------+  |
|            ^                                |                           ^         |
|            | 状态折叠与读写                  | 发送驱动提示词            | 检查状态|
|            v                                v                           v         |
|  +--------------------+        +-------------------------+        +------------+  |
|  |   goal/change      |        | <goal_round> 注入       |        | agent.     |  |
|  |   (事件流与快照)   |        | (Round: N / Max)        |        | followup() |  |
|  +--------------------+        +-------------------------+        +------------+  |
|            ^                                                                      |
|            | 工具调用权限与修改                                                   |
|  +--------------------+                                                           |
|  |   tool-goal        |                                                           |
|  | (模型交互工具契约) |                                                           |
|  +--------------------+                                                           |
+-----------------------------------------------------------------------------------+
```

---

## 二、Service Goals 与品牌类型 GoalId

### 1. GoalId 品牌类型 (Branded Type)

为防止将无意义的普通字符串或会话 ID 误传入目标系统，DSH 在类型层面对目标唯一标识符施加了品牌约束：

```typescript
declare const GoalIdBrand: unique symbol;

/** 带有编译期品牌约束的目标标识符 */
export type GoalId = string & { readonly [GoalIdBrand]: typeof GoalIdBrand };

/**
 * 运行时构造器：将原始字符串显式赋予 GoalId 品牌
 * @param id 原始目标标识字符串（通常为 UUID v4）
 */
export function GoalId(id: string): GoalId {
  return id as GoalId;
}
```

### 2. Service goals 接口契约

`dsh-goal` 模块通过 Cordis `Service` 机制挂载至 `ctx.goals`，为其他插件提供完备的目标控制方法：

```typescript
export interface GoalRef {
  readonly id: GoalId;
  readonly revision: number;
}

export interface GoalBlockReason {
  readonly code: string;       // 必须为 lower-kebab-case，如 "permission-denied"
  readonly message: string;    // 非空、规范化的具体阻断原因文本
}

export interface GoalSnapshot {
  readonly id: GoalId;
  readonly revision: number;
  readonly objective: string;
  readonly phase: "active" | "paused" | "blocked" | "complete";
  readonly maxGoalRounds: number;
  readonly blockedReason?: GoalBlockReason;
}

export interface GoalView extends GoalSnapshot {
  readonly roundsStarted: number;
  readonly activation: "armed" | "disarmed";
}

export interface GoalsService {
  /** 获取指定 Agent 当前绑定的目标视图 */
  get(agent: Agent): GoalView | undefined;
  
  /** 为 Agent 创建全新目标（初态为 active 且 armed） */
  create(agent: Agent, init: { objective: string; maxGoalRounds?: number }): GoalView;
  
  /** 修改活跃目标的文本意图或轮次上限（要求 CAS 乐观锁比较版本号） */
  edit(agent: Agent, ref: GoalRef, patch: { objective?: string; maxGoalRounds?: number }): GoalView;
  
  /** 暂停目标：停止自动延续轮次驱动 */
  pause(agent: Agent, ref: GoalRef): GoalView;
  
  /** 恢复目标：重新装载自动延续驱动器 (armed) */
  resume(agent: Agent, ref: GoalRef): GoalView;
  
  /** 标记目标圆满达成 */
  complete(agent: Agent, ref: GoalRef): GoalView;
  
  /** 标记目标受阻并记录归因分析 */
  block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView;
  
  /** 临时卸载驱动权限 (disarm)，保留其持久化 phase */
  disarm(agent: Agent): void;
}
```

---

## 三、四态生命周期与纯函数事件折叠

### 1. 四态生命周期状态机

目标生命周期包含四种互斥的 `phase`：
- `active`：正在执行中。驱动器处于激活状态（若 `activation === "armed"` 则自动规划下一轮）；
- `paused`：人工或策略性暂停。保持当前上下文和已消耗轮次，不自动分发下一轮；
- `blocked`：硬性阻断。遇到无法自主突破的外部瓶颈，驱动器终止并提示用户接管；
- `complete`：最终完成。目标已达成，所有子任务验证通过，自主驱动闭环。

```text
                  create (由人类意图推导)
                          |
                          v
         +------------[ active ]------------+
         |            ^        ^            |
   pause |     resume |        | resume     | block (阻断阈值或系统级错误)
         v            |        |            v
    [ paused ]--------+        +-------[ blocked ]
         |                                  |
         |                                  | complete (达成并核验)
         +------------> [ complete ] <------+
```

### 2. 持久化事件与纯函数折叠 (Pure Fold)

DSH 会话底层基于只追加 (Append-Only) 的事件日志。每次对目标的变动均通过 `goal/change` 事件写入：

```typescript
export interface GoalChangeEvent {
  readonly kind: "goal/change";
  readonly version: 1;
  readonly operation: "create" | "edit" | "pause" | "resume" | "complete" | "block" | "clear";
  readonly goal?: GoalSnapshot;
  readonly cleared?: GoalRef;
  readonly roundsStarted: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
```

在会话加载或重放 (Replay) 时，系统使用纯函数累加器 `emptyGoalFoldState()` 遍历历史事件：
1. 校验 `updatedAt >= createdAt`，杜绝时钟漂移导致的时序错乱；
2. 校验 `phase === "blocked"` 时必须严格伴随合法的 `blockedReason`（包含 `code` 与 `message`），其他状态严禁出现该字段；
3. 将最终折叠结果投射为内存中的活跃快照，确保重启或断电后状态机完全确定。

---

## 四、跨轮次自动延续驱动器 (goal-round-driver)

### 1. 驱动执行循环与静止态触发

`goal-round-driver` 监听 Cordis 总线上的智能体状态变更。其驱动推进必须满足以下四个硬性安全条件：
1. **智能体处于静止态**：`agent.status === "idle"`；
2. **无竞争队列消息**：`state.competingQueued === false`（没有更高优先级的用户打断指令或系统插入消息）；
3. **目标处于可驱动状态**：`goal.phase === "active" && goal.activation === "armed"`；
4. **生命周期未注销**：当前 Cordis 纤程状态正常且插件未处于卸载流程。

### 2. 跨轮驱动提示词规范

当满足驱动条件时，驱动器构造一个 `user/message` 并自动调用 `agent.followup(message)`。注入的提示词具有标准化固定模板：

```markdown
<goal_round>
Objective: "<目标具体描述文本>"
Round: 2/20

Continue working toward the objective in this same session. Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current. Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal, and mark it complete. If work remains, leave the goal active for the next round. Follow the configured goal-tool policy before reporting a blocker.
</goal_round>
```

**提示词设计意图解析**：
- **强化实事求是**：命令模型将当前工作区文件、工具执行产物和持久化状态视为唯一真源，杜绝仅凭上轮输出的虚假记忆做假设；
- **自包含推进**：明确要求在达成目标前收集确凿验证证据，并调用 `update_goal` 标记 `complete`；
- **防虚假阻断**：明确要求遵循配置的阻断门禁，未达条件前必须继续寻找解决方案。

### 3. 轮次累计与安全熔断

为防止智能体陷入无限死循环造成资源耗尽，驱动器内置硬性熔断机制：
1. **轮次计数递增**：每成功进入一个新轮次，`roundsStarted` 计数累加 1；
2. **硬性上限核验**：在准备生成第 `N` 轮前，校验 `if (goal.roundsStarted >= goal.maxGoalRounds)`；
3. **熔断处置**：一旦达到上限，驱动器直接调用 `ctx.goals.block(agent, goalRef, { code: "round-limit", message: "Goal reached its configured limit of N rounds." })`，强制将状态推进为 `blocked`，移交控制权给人类。

### 4. 竞争排队与检查点栅栏

- **持久化检查点**：在分发新轮次前，驱动器会先行调用 `await ctx.sessions.flush(agent.session)`。若持久化刷盘失败，驱动器自动 `disarm`，拒绝在未落盘的状态上继续盲目生成；
- **子智能体排空**：若检测到会话中存在活动的子智能体（`ctx.subagents`），驱动器通过 `subagents.waitForChildren(agent)` 挂起自身，直至所有并发子任务完全收敛；
- **上下文超限自愈**：若收到 `turn/end` 携带 `reason.kind === "max-tokens"`，驱动器立即执行 `disarm`，停止无效空转。

---

## 五、目标交互工具与判定守则

`dsh-tool-goal` 向模型注册了三个原子工具：

### 1. `create_goal`
- **功能**：由模型的直接理解从用户输入中推导出长周期目标；
- **参数**：
  - `objective` (string, 必填)：明确的完成指标；
  - `max_goal_rounds` (number, 可选)：最大延续轮次（默认通常为 20）；
- **门禁守则**：**必须具备直接人类输入权限 (`requireDirectHuman`)**。子智能体或后台自动化流程不得凭空创建未授权的顶层目标。

### 2. `get_goal`
- **功能**：读取当前会话绑定的目标快照与当前状态；
- **输出**：返回包含 `id`、`revision`、`objective`、`phase`、`roundsStarted`、`maxGoalRounds` 及 `activation` 的紧凑对象。更新前必须先通过该工具获取最新的 `revision`。

### 3. `update_goal`
- **功能**：更新目标状态或参数；
- **参数**：
  - `goal_id` (string, 必填)：由 `get_goal` 返回的 ID；
  - `revision` (number, 必填)：乐观锁版本号，不一致直接抛出 CAS 冲突异常；
  - `action` (enum, 必填)：`"edit" | "pause" | "resume" | "complete" | "blocked"`；
  - `objective` (string, 可选)：仅在 action 为 `edit` 时合法；
  - `max_goal_rounds` (number, 可选)：仅在 action 为 `edit` 时合法；
  - `blocked_reason` (string, 可选)：action 为 `blocked` 时必填。

### 4. 阻塞判定铁律 (Anti-Abandonment Policy)

在模型自主推进长任务时，常常会因为偶发性错误（如单元测试失败、路径找不到、单次网络抖动）而产生挫败感，试图直接调用 `blocked` 放弃任务。为此，DSH 制定了硬性技术门禁：

```typescript
// tool-goal 源码中的阻断门禁断言
if (args.action === "blocked" && authority.kind === "goal-round") {
  const currentRounds = authority.goal.roundsStarted;
  const threshold = resolved.blockedAfterConsecutiveRounds; // 默认值为 3
  
  if (currentRounds < threshold) {
    throw new HarnessError(
      `blocked requires at least ${threshold} consecutive goal rounds; current round is ${currentRounds}`,
      "GOAL_TOOL_BLOCK_THRESHOLD"
    );
  }
}
```

**阻断判定守则**：
1. **3 轮连续门禁**：同一阻断条件必须在经历至少 3 轮连续尝试（重试、切换思路、查阅上下文、更换方案）后仍然完全无法推进，才允许标记为 `blocked`；
2. **严禁将未完成当阻断**：单纯的任务量大、耗时长、探索期未知或仍有其他可行方案的场景，属于正常工作进展，严禁标记为阻断；
3. **归因明确**：必须给出具体的 `blocked_reason`，说明已经尝试过的排查手段与当前缺少的先决外部条件（如缺少凭据、物理网络断开等）。

### 5. 终局收拢上下文 (Wrapup Context)

当智能体在自主轮次中合法执行了 `complete` 或 `blocked` 之后，系统并非直接硬性杀死对话，而是通过 `deferContext` 注入收尾提示词，促使模型向人类交付结构化的完结陈词：

- **达成收尾 (`<goal_complete>`)**：
  ```markdown
  <goal_complete>
  Objective: "重构持久化日志管道"
  The goal is marked complete and this autonomous run is ending. Write the closing message to the user now: state the outcome, summarize what was done and how it was verified, and point to the concrete results (files, commits, or other artifacts). Report only what earlier rounds and tool results in this session actually establish; when a detail is not in the session, say so instead of inventing it. Note anything the user should review or do next. Address the user directly. Do not call any more tools in this run; further work waits for the user's next instruction.
  </goal_complete>
  ```
- **阻断收尾 (`<goal_blocked>`)**：
  引导模型详细列出已完成的部分、卡住的确切外部因素，以及需要人类主人提供何种干预支持。

---

## 六、工程最佳实践与反模式清单

| 维度 | [错误] 反模式 | [正确] 最佳实践 |
| --- | --- | --- |
| 目标创建 | 在单轮简单问答（如“1+1等于几”）中频繁调用 `create_goal` 滥用上下文 | 仅针对需要多工具串联、代码重构、跨文件排错的长周期任务创建目标 |
| 轮次延续 | 模型在轮次末尾输出“请用户回复继续”，等待人类推动 | 只要目标未达成且有工作可做，保持 goal 为 active，交由驱动器无缝分发下一轮 |
| 阻断申报 | 第一次遇到某个工具报错立即调用 `update_goal(action='blocked')` | 先行分析报错根因，尝试至少 3 种变通手段；仅在物理死锁时方可阻断 |
| 达成判定 | 未运行测试或未检查构建结果，仅凭写完代码即标记 `complete` | 先行执行验证工具拿到确凿成功证据，在完结汇报中附上证据链后标记完成 |

---

## 相关 DSH 源码

```text
packages/goal/goal               <-  @deepseek-ai/dsh-goal@<version>
packages/goal/goal-round-driver  <-  @deepseek-ai/dsh-goal-round-driver@<version>
packages/shell/tool-goal         <-  @deepseek-ai/dsh-tool-goal@<version>
packages/client/ui-goal          <-  @deepseek-ai/dsh-client-ui-goal@<version>
```
