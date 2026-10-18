# DSH 原生多智能体团队协作架构 (Agent Teams)

## 1. 架构演化：从单 Agent 到隐式根 Agent Teams

在大型复杂软件工程与长程多步骤任务中，Agent 系统面临着严峻的上下文容量与执行稳定性挑战。DSH 经历了三个阶段的协同架构演化：

```
[演化历程 1: 单 Agent 线性执行]
  LLM Context ---> [ 线性增长的单会话上下文 (Prompt/Tool 历史) ] ---> 极易发生注意力漂移与遗忘

[演化历程 2: 树状父子单向 Subagent]
  Parent Agent ---> subagent() ---> Child Agent (独立短期上下文)
       |                                   |
       +<--- 阻塞等待 / 最终结果单向返回 <----+ (短命容器，无横向通信，无法长驻协同)

[演化历程 3: DSH v0.2.1 原生 Agent Teams (隐式根星型/网状拓扑)]
  +--------------------------------------------------------------------------+
  | Session Context (Shared Team Canvas)                                     |
  |                                                                          |
  |  +--------------------+         send_message / wait_agent                |
  |  | Team Lead (唯一角色) | <===================================>+          |
  |  | (当前会话隐式根主体)  |                                      |          |
  |  +---------+----------+                                      |          |
  |            |                                                 |          |
  |            | CAS 并发驱动                                     |          |
  |            v                                                 v          |
  |  +--------------------+  blocked_by DAG 解算  +-----------------------+  |
  |  | Shared Task Board  | <-------------------> | Teammates (对等长驻成员) |  |
  |  | (team_task_* 体系) |                       | (worker-1, worker-2)  |  |
  |  +--------------------+                       +-----------------------+  |
  |            ^                                                 |          |
  |            +=================================================+          |
  |                           claim / complete / update                      |
  +--------------------------------------------------------------------------+
```

### 1.1 单 Agent 与单向 Subagent 的架构瓶颈
1. **单 Agent 上下文泥球 (Context Blob)**：当单会话经历多轮深层文件读写、调试与重构后，Prompt Token 迅速逼近窗口极限，系统注意力被早期冗余工具输出稀释，模型遵循核心指令的精确度断崖式下跌。
2. **单向 Subagent 的生命周期短板**：早期的 `subagent` 与 `subagent_fork` 机制虽然提供了隔离的执行上下文，但其语义为「一次性派发并等待最终返回值」。子代理彼此不可见，无法进行横向直接对话；父代理在子代理执行期间陷入被动阻塞或盲目轮询，缺乏细粒度的动态协作通道。

### 1.2 隐式根 Agent Teams 架构核心原则
DSH v0.2.1-rc.2 引入了原生的多智能体团队协作体系：
- **隐式根 (Implicit Root)**：主会话的主 Agent 天然具备 `Team Lead` 身份，无需额外启动专用的协调进程，即可作为调度中枢负责任务分发与进度统筹。
- **长驻成员对等性 (Long-lived Peer Teammates)**：团队成员 (`teammates`) 拥有独立而持久的上下文与专职角色（如架构师、编码员、测试员、审计员），生命周期与团队协同阶段绑定，非任务执行完毕即刻销毁。
- **控制面与数据面解耦**：成员间的直接通信基于异步消息传递，而协同状态与执行依赖则下沉至共享任务看板（Shared Task DAG），实现状态与通信的完全解耦。

---

## 2. 团队角色与名册状态机

### 2.1 角色定义与唯一性约束
在一个 Agent Team 拓扑中，角色被划分为两类：
- **Team Lead (`lead`)**：全局唯一。负责宏观目标分解、任务创建与指派、依赖拓扑校验、冲突仲裁以及最终成果交付。
- **Teammate (`teammate`)**：对等长驻成员。具备自包含的角色定位（Role Definition）与专用系统指导片段，负责具体任务的认领、实施、单元验证与阶段性报告。

```typescript
export type TeamMemberRole = 'lead' | 'teammate';

export interface TeamMember {
  /** 成员唯一标识符 */
  agentId: string;
  /** 成员显示名称 (例如 "worker-architect", "worker-coder") */
  name: string;
  /** 团队角色: 团队中仅允许存在一个 lead */
  role: TeamMemberRole;
  /** 成员当前生命周期状态 */
  status: TeamMemberStatus;
  /** 成员建议性写入范围 (Glob 或前缀路径) */
  writeScopes?: string[];
  /** 成员就绪时间戳 */
  joinedAt: number;
}
```

### 2.2 成员状态机 (Status State Machine)
团队成员遵循明确的四态生命周期转移矩阵：

```
       [ team_member_spawn / 初始化 ]
                     |
                     v
             +---------------+
             | provisioning  |
             +-------+-------+
                     | 运行时就绪 (Handshake Complete)
                     v
             +---------------+  认领任务 / 收到指令   +---------------+
             |   inactive    | --------------------> |    running    |
             |   (就绪等待)   | <-------------------- |   (执行工作中)  |
             +-------+-------+  任务完成 / 空闲挂起   +-------+-------+
                     |                                       |
                     | 发生不可恢复异常 / 强制终止             |
                     +-------------------+-------------------+
                                         |
                                         v
                                 +---------------+
                                 |    failed     |
                                 +---------------+
```

- **`provisioning`**：成员容器/沙箱正在初始化，挂载工作区上下文并加载基础运行时依赖。在此阶段，成员不可接收业务任务。
- **`inactive`**：成员完成就绪握手，处于低功耗空闲等待状态，随时可接收 `send_message` 投递或认领看板中的就绪任务。
- **`running`**：成员正在执行具体工具调用或模型推理轮次。
- **`failed`**：成员遇到运行时崩溃、宿主环境致命异常或超时未响应，状态被标记为终态。Team Lead 接收到活动广播后，可决定重启或转派其遗留任务。

---

## 3. 点对点通信与事件驱动等待

在多 Agent 协同场景中，严禁采用自旋轮询（Busy-polling / Sleep 循环）检测其他成员状态。DSH 提供了非阻塞通信与事件驱动等待三件套。

```
[Agent-A (Lead)]                                         [Agent-B (Teammate)]
       |                                                         |
       | --- 1. tools.send_message({ agent_id, message }) ------>| (投递入队，A 立即返回)
       |                                                         | 执行推理 / 状态变更
       | --- 2. tools.wait_agent({ target_agent_id }) ---------->| (挂起监听 TeamActivity)
       |                                                         |
       |                                                         | 触发状态/任务变更
       |                                                         | emit('team/activity')
       |<=== 3. 唤醒并返回 TeamActivity Payload ===================+
```

### 3.1 点对点异步收发 (`send_message`)
`send_message` 将消息直接追加至目标 Agent 的输入消息队列中。调用是即时返回的，发送方不会阻塞等待目标处理完毕。

```typescript
// 调用示例: Team Lead 向编码员派发上下文说明
await tools.send_message({
  agent_id: "agent-coder-01",
  message: "模块 core/auth 已解构完毕，请阅读看板任务 task-102 并开始执行测试用例编写。"
});
```

### 3.2 非自旋打断机制 (`interrupt_agent`)
当需求变更或检测到潜在死循环时，调用方可通过 `interrupt_agent` 发起非强制终止请求：
- 宿主不会直接 `kill -9` 进程，而是向目标 Agent 发送中止信号，令其在当前原子工具调用步安全结束后退出执行循环；
- 目标 Agent 会将其未提交的脏状态回滚，并向看板归还未完成的任务，最后将自身状态切换为 `inactive`。

```typescript
await tools.interrupt_agent({
  agent_id: "agent-coder-01"
});
```

### 3.3 基于 `TeamActivity` 的事件驱动等待 (`wait_agent`)
为杜绝 `while (true) { sleep(1000); }` 这类高危耗能模式，DSH 提供基于宿主活动事件流的 `wait_agent` 契约：

```typescript
export type TeamActivityKind = 
  | 'message_received'
  | 'status_changed'
  | 'task_created'
  | 'task_claimed'
  | 'task_completed'
  | 'task_blocked';

export interface TeamActivity {
  activityId: string;
  sourceAgentId: string;
  kind: TeamActivityKind;
  payload: Record<string, unknown>;
  timestamp: number;
}

// 契约用法: 挂起当前轮次，直到目标 Agent 产生状态变更或处理完成
const activity = await tools.wait_agent({
  target_agent_id: "agent-coder-01",
  timeout_ms: 120000, // 设防超时，防止永久悬挂
  filter_kinds: ['status_changed', 'task_completed']
});

if (activity.kind === 'task_completed') {
  // 消费任务产出并推进后续拓扑
}
```

---

## 4. 共享任务看板 (Shared Task DAG)

DSH Agent Teams 的中枢是共享任务看板。所有任务组织为有向无环图（Directed Acyclic Graph, DAG），任务的状态变迁严格遵循 CAS 乐观并发控制。

### 4.1 核心数据结构与 CAS 控制模型
为防止并发冲突与状态写覆盖，每个任务均携带严格单调自增的 `revision`。任何状态变迁工具调用（如 `team_task_update`）必须提供 `expected_revision`。如果宿主存储中的最新版本与传入的预期版本不匹配，将直接抛出 `TASK_REVISION_MISMATCH` 并拒绝变更。

```typescript
export type TaskStatus = 
  | 'blocked'      // 存在未满足的前置依赖
  | 'ready'        // 依赖已全部满足，处于可认领状态
  | 'claimed'      // 已被成员认领，正处于开发中
  | 'completed'    // 已成功完成
  | 'failed';      // 执行失败或异常终止

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee?: string;
  /** 前置依赖的任务 ID 列表 */
  blockedBy: string[];
  /** 建议性写入文件作用域 */
  writeScopes: string[];
  /** CAS 并发版本号，自增正整数 */
  revision: number;
  createdAt: number;
  updatedAt: number;
}
```

### 4.2 任务操作动作集 (Action Matrix)
通过 `team_task_update` 统一派发具体动作，不同动作对状态与字段有严格校验：

| 动作 (`action`) | 触发前置状态 | 变迁后状态 | 核心参数与语义 |
| :--- | :--- | :--- | :--- |
| **`claim`** | `ready` | `claimed` | 认领任务，原子写入 `assignee` 为当前 Agent ID |
| **`release`** | `claimed` | `ready` | 放弃认领，清空 `assignee`，将任务释放回就绪池 |
| **`edit`** | 任意非终态 | 保持现状 | 修改 `title`、`description` 或 `writeScopes` |
| **`set_dependencies`**| 任意非终态 | `blocked` / `ready` | 重新设置 `blockedBy` 拓扑依赖，触发拓扑重算 |
| **`complete`** | `claimed` | `completed`| 标记完成，触发下游依赖解算与就绪唤醒 |
| **`reopen`** | `completed` | `ready` | 重开任务，下游已完成的任务将级联反转为 `blocked` |
| **`reassign`** | `ready` / `claimed` | `claimed` | Team Lead 强制转派给指定 `assignee` |
| **`delete`** | `ready` / `failed` | (物理移除) | 校验无下游任务依赖后安全删除 |

### 4.3 依赖拓扑图解算与 Ready 判定算法
任务看板维护着严格的拓扑解算器。当下游任务的 `blockedBy` 依赖集全量达到 `completed` 时，解算器会自动将下游任务由 `blocked` 升格为 `ready`。

```typescript
/**
 * 拓扑解算核心判决逻辑 (伪代码实现)
 */
export function reconcileTaskDAG(tasks: Map<string, TeamTask>): DAGReconcileResult {
  // 1. 环路死锁检测 (Cycle Detection)
  if (hasCycle(tasks)) {
    throw new Error("[错误] 任务看板存在循环依赖，拒绝更新！");
  }

  const updatedTasks: TeamTask[] = [];

  for (const task of tasks.values()) {
    if (task.status === 'blocked') {
      const allDepsMet = task.blockedBy.every(depId => {
        const dep = tasks.get(depId);
        return dep && dep.status === 'completed';
      });

      if (allDepsMet) {
        task.status = 'ready';
        task.revision += 1;
        task.updatedAt = Date.now();
        updatedTasks.push(task);
      }
    } else if (task.status === 'ready') {
      // 逆向防漂移: 若前置任务被 reopen，则回退为 blocked
      const anyDepIncomplete = task.blockedBy.some(depId => {
        const dep = tasks.get(depId);
        return !dep || dep.status !== 'completed';
      });
      if (anyDepIncomplete) {
        task.status = 'blocked';
        task.revision += 1;
        task.updatedAt = Date.now();
        updatedTasks.push(task);
      }
    }
  }

  return { updatedTasks };
}
```

---

## 5. 写入范围隔离与版本防穿透

在多 Agent 并发写入工作区文件的场景下，最严峻的工程隐患是「代码交叉覆盖（File Write Trampling）」以及「基于陈旧基线的静默改写」。DSH 建立了建议性作用域与底层版本防穿透双重防线。

### 5.1 建议性写入作用域 (`write_scopes`)
在任务定义及成员认领时，必须声明该任务预期的文件操作范围。这是一种**应用层建议性隔离契约 (Advisory File Scopes)**：
- 格式采用规范化路径前缀或 Glob 表达式，如 `["src/auth/**", "tests/auth/**"]`；
- 成员认领任务时，看板服务将比对当前所有 `claimed` 任务的 `write_scopes`；
- 若检测到潜在路径交叠，系统会在看板工具返回中注入警告提示，或由 Team Lead 仲裁调整依赖顺序，使其由并发执行降级为串行 DAG 执行。

### 5.2 `FS_STALE_VERSION` 冲突与重基 (Rebase) 范式
尽管存在建议性范围，当多个工具调用或外部变动导致写入冲突时，DSH 底层文件系统驱动将直接拒绝写入，并抛出错误码 `FS_STALE_VERSION`。

```
[Agent 内存状态]                   [DSH Host 文件系统]                 [磁盘物理文件]
     |                                   |                                |
  1. 读取基线 (v1) --------------------->| (记录当前读取 revision: 1) ------->|
     |                                   |                                |
  2. 离线思考并生成补丁                     |                                |
     |                                   | <--- 外部/并发 Agent 写入新版 (v2) -|
     |                                   |                                |
  3. tools.edit / write ---------------->| 校验 expected_version: 1 vs 2  |
     |                                   | [拒绝] 抛出 FS_STALE_VERSION    |
     |<=== 4. 捕获 FS_STALE_VERSION ======+                                |
     |                                                                    |
  5. [标准重基序列]                                                         |
     a. tools.read(重新拉取 v2 最新内容)                                    |
     b. AST / 三方语义合并 (Local Diff + Upstream v2)                       |
     c. tools.edit(携带 revision: 2 再次提交)                              |
     +---------------------------------->| [批准] 写入成功 (v3) ------------->|
```

### 5.3 生产级代码重试范式
团队成员在进行代码修改时，必须封装标准的重基重试循环，严禁在未重新读取磁盘最新状态的情况下暴力覆写文件：

```typescript
/**
 * 具备 FS_STALE_VERSION 自动重基能力的健壮文件编辑函数
 */
export async function safeEditWithRebase(
  filePath: string,
  applyTransformation: (currentContent: string) => string,
  maxRetries = 3
): Promise<void> {
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    // 1. 读取最新磁盘基线
    const readRes = await tools.read({ file_path: filePath });
    const originalText = readRes.lines.map(l => l.text).join('
');

    // 2. 在最新基线上执行逻辑补丁运算
    const transformedText = applyTransformation(originalText);
    if (transformedText === originalText) {
      // 内容无需变动，提前返回
      return;
    }

    try {
      // 3. 提交编辑操作
      await tools.write({
        file_path: filePath,
        content: transformedText
      });
      // 写入成功，顺利退出
      return;
    } catch (err: any) {
      if (err.message && err.message.includes('FS_STALE_VERSION')) {
        // [警告] 触发并发版本过期，让出时间片并进行重基尝试
        await new Promise(resolve => setTimeout(resolve, 50 * attempt));
        continue;
      }
      // 非并发版本错误，直接向上抛出
      throw err;
    }
  }

  throw new Error(`[错误] 超过最大重试次数 (${maxRetries})，文件 ${filePath} 并发冲突重基失败！`);
}
```

---

## 6. 完整团队协作落地实践示例

以下代码展示了 Team Lead 如何通过 DSH 原生工具链启动协同、编排 DAG、分派任务并进行事件驱动收拢：

```typescript
export async function runArchitectureTeamWorkflow(): Promise<void> {
  // 1. 创建共享任务看板任务
  const taskArch = await tools.team_task_create({
    title: "系统核心接口契约设计",
    description: "编写 src/types/core.ts 核心接口规范",
    write_scopes: ["src/types/**"]
  });

  const taskImpl = await tools.team_task_create({
    title: "核心接口实现与单元测试",
    description: "实现接口并编写完整单测",
    write_scopes: ["src/core/**", "tests/core/**"],
    blocked_by: [taskArch.task.id] // 依赖架构任务完成
  });

  // 2. 指派架构师认领并执行
  await tools.team_task_update({
    task_id: taskArch.task.id,
    action: "claim",
    expected_revision: taskArch.task.revision,
    assignee: "agent-architect"
  });

  await tools.send_message({
    agent_id: "agent-architect",
    message: `请开始执行任务: ${taskArch.task.id}，完成后通过 team_task_update 标记 complete。`
  });

  // 3. 事件驱动等待架构师完成，杜绝轮询
  const activity = await tools.wait_agent({
    target_agent_id: "agent-architect",
    filter_kinds: ["task_completed"],
    timeout_ms: 180000
  });

  // 4. 看板 DAG 自动解算后，检查下游任务状态
  const implTaskStatus = await tools.team_task_get({ task_id: taskImpl.task.id });
  if (implTaskStatus.task.status === "ready") {
    // 唤醒编码员认领实现任务
    await tools.team_task_update({
      task_id: taskImpl.task.id,
      action: "claim",
      expected_revision: implTaskStatus.task.revision,
      assignee: "agent-coder"
    });
    await tools.send_message({
      agent_id: "agent-coder",
      message: "前置契约已就绪，请认领并开始实现业务逻辑。"
    });
  }
}
```

---

## 相关 DSH 源码

```text
packages/experimental/agent-team       <-  @deepseek-ai/dsh-experimental-agent-team@0.2.1-rc.2
packages/experimental/tool-agent-team  <-  @deepseek-ai/dsh-experimental-tool-agent-team@0.2.1-rc.2
packages/experimental/client-ui-agent-team  <-  @deepseek-ai/dsh-experimental-client-ui-agent-team@0.2.1-rc.2
```
