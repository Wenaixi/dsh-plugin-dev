# DSH 计划模式与用户评审闸门架构 (Plan Mode & User Review Gate)

## 1. 架构背景：从「边想边做」到「先审后做」的执行防线

在软件工程、跨模块重构以及高危系统运维等复杂场景下，赋予自主智能体直接执行写操作（如写文件、执行破坏性 Shell 脚本）往往伴随着严重的不可逆风险：

```
[反模式: 边想边做 (Unchecked Execution)]
  用户需求 ---> Agent 逐步推测 ---> 边改代码边探索 ---> 误删重要文件 / 偏离初衷 / 产生脏代码
                                            |
                                            v
                                  [破坏已发生，无法撤销]

[DSH 规范模式: 计划模式与用户评审闸门 (Plan Mode Gate)]
  用户需求 ---> [ 计划模式 (Plan Mode) 激活 ]
                     |
                     +---> [ 探索与上下文收集 ] (严苛只读纪律: read, glob, grep, ask)
                     |
                     +---> [ 方案推演与架构规划 ]
                     |
                     v
  [ exit_plan_mode 提交完整 Markdown 计划 ] ===> [ 强制暂停，等待用户评审 ]
                                                          |
                                  +-----------------------+-----------------------+
                                  | 批准 (Approved)                               | 拒绝 / 提出修改意见
                                  v                                               v
                      [ 状态迁至 Executing ]                              [ 停留在 Planning 状态 ]
                      [ 开启写权限，按计划执行 ]                            [ 根据反馈重新迭代计划 ]
```

### 1.1 核心挑战与设计哲学
1. **执行破坏性不可逆**：Agent 一旦在理解不完全的情况下执行了批量文件覆写或进程终止命令，即便事后纠偏，历史工作区状态也已遭破坏。
2. **上下文污染与目标漂移**：在没有明确结构化方案约束的情况下，Agent 容易陷入「改错一个地方 -> 补丁修复 -> 引入新错」的无序震荡中。
3. **架构解耦哲学**：DSH 将 Agent 的认知与执行周期划分为**探索规划期 (Planning Phase)** 与 **实施执行期 (Executing Phase)**。在规划期建立严密防线，必须通过用户显式确认闸门后，方可换取执行权限。

---

## 2. 核心服务：`planMode` 与权威代际状态模型

在 DSH 体系中，计划模式由挂载在会话上下文 (`ctx.planMode`) 上的核心服务统一驱动。

### 2.1 状态机与阶段转移矩阵
计划模式生命周期包含四种核心状态（`Phase`）：

```
              /plan on / 触发计划模式
                         |
                         v
                  +--------------+  exit_plan_mode (提交评审)  +------------------+
                  |   Planning   | --------------------------> | AwaitingApproval |
                  |  (探索规划期) | <-------------------------- |    (等待评审)    |
                  +-------+------+   用户拒绝 / 提出修改意见    +--------+---------+
                          |                                             |
                          | /plan off / 显式取消                         | 用户批准 (Approved)
                          v                                             v
                  +--------------+      计划执行完毕 / 取消      +------------------+
                  |   Inactive   | <--------------------------- |    Executing     |
                  |  (非计划状态) |                              |    (实施执行期)   |
                  +--------------+                              +------------------+
```

```typescript
export enum PlanPhase {
  /** 未激活计划模式 */
  Inactive = 0,
  /** 探索与收集上下文，拟定计划方案 */
  Planning = 1,
  /** 计划已提交至用户前端界面，处于等待批准的阻塞挂起状态 */
  AwaitingApproval = 2,
  /** 计划已获用户批准，进入具体执行实施阶段 */
  Executing = 3
}

export interface PlanState {
  /** 当前阶段 */
  phase: PlanPhase;
  /** 权威代际纪元号 (单调自增) */
  epoch: number;
  /** 当前已暂存或已获批的 Markdown 计划内容 */
  planMarkdown?: string;
  /** 用户最新的反馈意见 (若有) */
  userFeedback?: string;
}
```

### 2.2 单调自增的权威代际纪元 (`Epoch`) 机制
为了彻底防止在网络时延、并发工具回调或会话分支场景下陈旧操作穿透，DSH 引入了**权威纪元 (`Epoch`) 控制算法**：
- 状态机每一次发生变迁（无论由 `enter`、`submitPlan`、`approve` 还是 `reject` 触发），`epoch` 必须原子自增（`epoch++`）；
- 工具调用拦截层在执行阶段敏感校验时，不仅比对 `phase`，还会比对调用发起时的 `epoch`；
- 若检测到底层代际已更新（说明该调用产生于上一轮已被否决或过期的规划周期），宿主将直接阻断该过时调用的生效，彻底消除状态竞态。

```typescript
export interface PlanModeService {
  /** 获取当前计划状态快照 */
  getState(): Readonly<PlanState>;
  /** 激活进入计划模式 */
  enter(): Promise<PlanState>;
  /** 提交计划方案并等待用户评审 (由 exit_plan_mode 工具底层调用) */
  submitPlan(markdown: string): Promise<boolean>;
  /** 记录用户评审结果 */
  resolveReview(approved: boolean, feedback?: string): Promise<PlanState>;
  /** 显式关闭计划模式 */
  exit(): Promise<PlanState>;
  /** 注册状态变迁监听 */
  onStateChange(listener: (state: PlanState) => void): () => void;
}
```

---

## 3. 会话投影与状态持久保全

### 3.1 会话日志中的折叠机制 (Folded Transcript Projection)
在探索规划期间，Agent 会执行大量的只读检索工具调用（如 `glob` 扫描仓库、`read` 读取文件、`grep` 搜索符号等）。如果将这些长篇累牍的工具输入输出全部线性平铺在主会话列表中，会导致整个 UI 界面被大量中间过程刷屏，造成严重的信息过载。

DSH 客户端通过投影折叠算法对计划模式日志进行智能收敛：
- **阶段折叠容器 (Planning Step Fold)**：在渲染投影层（View Projection），所有在 `Planning` 阶段产生的检索过程被自动聚合至一个可折叠的 Timeline 容器中；
- **高亮计划卡片**：只有当 Agent 调用 `exit_plan_mode` 产出最终的结构化 Markdown 计划时，该计划才会作为高优先级独立卡片（Plan Review Card）呈现在交互主区域；
- **折叠持久化契约**：日志的折叠表现由事件流的 `phase` 标记投影解算得出，不篡改底层 Session 原始事件数据，保证了数据回放与审计的完整性。

```typescript
/**
 * 客户端会话投影折叠解算器 (简化逻辑)
 */
export function projectSessionTimeline(events: SessionEvent[]): RenderableTimelineItem[] {
  const items: RenderableTimelineItem[] = [];
  let currentPlanningGroup: PlanningGroupItem | null = null;

  for (const event of events) {
    if (event.planPhase === PlanPhase.Planning) {
      if (!currentPlanningGroup) {
        currentPlanningGroup = {
          type: 'planning_group',
          title: '正在进行项目结构探索与方案规划...',
          collapsed: true,
          children: []
        };
        items.push(currentPlanningGroup);
      }
      currentPlanningGroup.children.push(event);
    } else {
      currentPlanningGroup = null;
      items.push({
        type: 'standard_item',
        event
      });
    }
  }

  return items;
}
```

### 3.2 会话 Resume 与 Fork 时的状态保全
当用户刷新浏览器、网络中断后重连（Session Resume），或者从当前会话某一历史节点分叉（Session Fork）时：
1. **快照保全 (Snapshot Persistence)**：DSH 会将 `PlanState`（含当前 `phase`、`epoch`、以及待审核或已审核的 `planMarkdown`）连同会话元数据一同落盘序列化。
2. **状态精准复原**：
   - 若会话在 `AwaitingApproval` 阶段断开，Resume 后 UI 依然精准停留在等待用户审批的浮层界面，模型不会提前进入执行期；
   - 若用户在 Fork 会话时选择继承上下文，Fork 后的子会话将继承原会话在对应节点上的计划模式状态与已批准的方案基线，避免重复规划。

---

## 4. 行为与权限边界

### 4.1 部署层指导片段自动注入 (System Marker)
在计划模式激活期间，宿主调度器会在每一次发给大模型的请求上下文（User Turn / Middleware 注入层）中强制注入标准计划模式指导标记 (`Marker`)。

```text
[Plan mode — planning workflow. Gather context, ask clarifying questions with ask, maintain planning state with todo_write, and delegate focused research when useful. Do not begin implementation in this mode: until the user approves your plan the host refuses file writes, side-effecting shell commands, capability installation, memory mutation, writer-capable delegation, long-lived process control, and execution-step completion — don't spend turns retrying them. That refusal is a workflow phase, not a permission decision: approval switches the phase, and every call then goes through the active Permissions and Sandbox policy as usual. Reading, searching, inspecting, read-only shell commands, read-only delegation, todo_write, and ask stay available.]
```

该片段向模型明确指明：
- 当前处于计划阶段，核心任务是分析现状并输出方案；
- 严禁尝试写入文件或运行具有副作用的命令，否则会被宿主直接阻断；
- 使用 `exit_plan_mode` 呈递最终方案以触发审批。

### 4.2 探索期只读纪律与工具调用拦截
在 `Planning` 与 `AwaitingApproval` 阶段，DSH 工具分发内核执行严格的副作用分类拦截（Side-Effect Barrier）：

| 工具类别 | 具体工具示例 | 规划期策略 | 阻断响应与行为 |
| :--- | :--- | :--- | :--- |
| **只读检索类** | `read`, `glob`, `grep`, `read_image` | **[允许执行]** | 正常返回文件或检索内容 |
| **用户澄清类** | `ask_user_question` | **[允许执行]** | 向用户抛出单选/多选/文本问答框 |
| **规划跟踪类** | `todo_write` | **[允许执行]** | 记录规划阶段的步骤清单 |
| **文件写操作** | `write`, `edit` | **[强制拦截]** | 抛出错误：`[错误] 计划模式激活期间严禁执行文件写操作！` |
| **终端执行类** | `pwsh` (含破坏性指令) | **[严格分类]** | 只读探测允许（如 `git status`, `node -v`）；带副作用指令强制拦截 |

### 4.3 计划模式与沙箱模式 (Sandbox Mode) 的正交解耦准则
**这是 DSH 架构设计中最为关键的边界法则之一**：

```
       +-------------------------------------------------------+
       |               Workflow Layer (工作流层)                |
       |  Plan Mode: Inactive -> Planning -> Executing         |
       +-------------------------------------------------------+
                                  |
                                  | 决定工作阶段是否允许提交改动
                                  v
       +-------------------------------------------------------+
       |             Security & Sandbox Layer (安全与沙箱层)    |
       |  Sandbox Policy: read-only | workspace-write | danger  |
       |  Approval Policy: prompt / untrusted / disabled       |
       +-------------------------------------------------------+
```

- **职责边界正交**：
  - **计划模式 (Plan Mode)** 是**工作流阶段控制 (Workflow Phase)**，它解决的是「Agent 是否已经想清楚了、用户是否认可该方案」的工程协同问题；
  - **沙箱模式 (Sandbox Mode)** 与 **审批策略 (Approval Policy)** 是**底层安全防线 (Security Boundary)**，它解决的是「该进程物理上是否有权访问宿主文件系统、修改外部注册表或发起网络连接」的安全受控问题。
- **绝不越权提升**：
  - 计划模式获得用户批准（进入 `Executing` 态）**仅仅代表该工作流阶段允许执行写操作**；
  - 获批后的每一次具体文件写入与命令执行，**依然必须 100% 遵从当前配置的沙箱策略**（如 `workspace-write` 限制只能写入工作区，不可越权写入操作系统根目录）；
  - 计划模式绝对不能、也无权覆盖或旁路沙箱的安全审批策略。

---

## 5. 交付与退出闸门

### 5.1 `exit_plan_mode` 工具交互契约
Agent 完成现状分析与方案制定后，通过且仅通过调用 `exit_plan_mode` 将方案交付给用户评审。

```typescript
export interface ExitPlanModeArgs {
  /**
   * 完整的 Markdown 计划方案。
   * 硬性格式契约: 必须以 '# 计划标题' 作为起始第一行！
   */
  plan: string;
}

export interface ExitPlanModeResult {
  /**
   * 用户的最终评审裁决。
   * true: 用户批准计划，进入执行阶段；
   * false: 用户拒绝计划或提出修改意见，停留在规划阶段。
   */
  approved: boolean;
}
```

### 5.2 用户批准与拒绝的双向分支逻辑
当 Agent 调用 `exit_plan_mode` 后，宿主会将当前轮次挂起，前端界面弹出结构化计划审查卡片：

```typescript
// Agent 内部调用范式
const reviewResult = await tools.exit_plan_mode({
  plan: `# 系统模块重构与接口升级方案

## 1. 现状痛点
- 模块耦合严重，缺少类型保护...

## 2. 计划变动步骤
1. 新建 src/core/contract.ts
2. 迁移旧实现并编写单测
3. 验证构建产物并提请回归测试

## 3. 风险评估与回滚方案
- 本次改动涉及文件均处于 write_scopes 范围内，无全局破坏风险。`
});

if (reviewResult.approved) {
  // [分支 A: 用户批准]
  // 阶段自动切入 Executing，Agent 开始调用 write / edit 工具落实代码修改
  console.log("计划已获批准，开始按序实施代码编写...");
} else {
  // [分支 B: 用户拒绝或提出修改意见]
  // 阶段保持在 Planning，Agent 不可调用写工具，必须基于用户随附反馈重新调整方案
  console.log("用户提出了补充要求，重新规划并优化方案...");
}
```

### 5.3 `/plan off` 指令与快捷退出通道
用户拥有对计划模式的最高即时控制权：
- **命令行快捷指令**：用户在输入框键入 `/plan off`，宿主服务立即将计划模式原子关闭（`active = false`），清除挂起的审批状态；
- **UI 顶栏开关 (Toggle Switch)**：客户端 UI 顶栏常驻「计划模式」切换控件，用户随时可以手动关闭该模式；
- **回滚一致性**：无论通过指令还是 UI 开关退出，宿主都会原子清理相关的临时中间态，重置计划模式状态，确保下一次会话轮次处于绝对干净的标准执行模式下。

---

## 相关 DSH 源码

```text
packages/plan/plan-mode  <-  @deepseek-ai/dsh-plan-mode@<version>
packages/client/ui-plan  <-  @deepseek-ai/dsh-client-ui-plan@<version>
```
