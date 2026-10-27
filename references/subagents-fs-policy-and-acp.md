# DSH 子智能体引擎 (Subagents)、文件观察策略与 ACP 协议权威指南
---

## 一、子智能体能力切面架构 (ctx.subagents)

在 DSH 中，智能体不仅能独立执行任务，还能将聚焦的子任务委托给独立的子智能体（Subagent）在独立的上下文环境中运行，避免主会话上下文被海量中间检索污染。

官方核心包 `@deepseek-ai/dsh-subagent` 提供了标准能力切面服务 `ctx.subagents`：

### 1. 三大服务提供方 (Service Providers)
系统支持多种并存的子智能体运行提供方，调用方按名称选择：
- **`spawn`（插件 `@deepseek-ai/dsh-subagent-spawn-in-process`）**：在当前进程中拉起全新的独立子智能体，完全不继承父会话历史，用于全新无污染的独立任务（如全网背景调研）；
- **`fork`（插件 `@deepseek-ai/dsh-subagent-fork-in-process`）**：分叉继承父会话当前已完成的全部轮次历史，用于需要上下文背景的后续分析与审查；
- 以上两个插件的注册名均可通过各自 `Config.providerName` 覆盖（默认 `spawn` / `fork`）；
- **ACP（`@deepseek-ai/dsh-acp` + `dsh-acp-app`）**：基于 `@agentclientprotocol/sdk` 的 Agent Client Protocol **服务端适配层**（JSON-RPC stdio，启动入口 `dsh --profile acp`，由 `dsh-acp-app` 解析），**不注册为 `ctx.subagents` 的 provider**：`dsh-acp` 未实现 SubagentProvider 接口，仅经 `drainContinuableDescendants` 消费既有 continuable 子代理。

### 2. 单次运行 (One-Shot) vs 可持续会话 (Continuable)
`ctx.subagents` 明确区分了两种调用者意图：
1. **`start(name, request)`**：单次任务，返回**调用方持有的 run 句柄**（`{ id, result, dispose() }`）；`dispose()` 幂等，**由调用方在结果结算后显式调用**，不是立即自动释放；
2. **`startContinuable(spec)`**：建立可多次持续通信的长寿命子智能体句柄，主智能体可以通过 `send_message` 追加信件，或调用 `interrupt_agent` 进行紧急中断控制。

模型侧的 `send_message` 与 `interrupt_agent` 由 `@deepseek-ai/dsh-tool-subagent-control` 注册；`list_agents` 属于 Agent Teams 的 `@deepseek-ai/dsh-experimental-tool-agent-team`（配合 `wait_agent`、`team_task_*`、`spawn_teammate`）。

---

## 二、Agent Teams 与传统 Subagent 的本质边界对比

在 DSH v0.2.1 中，团队协作模式实现了从“单向父子委托”到“网状团队协作”的架构演进。开发者必须清晰理解二者的本质边界：

| 比较维度 | 传统子智能体 (dsh-subagent) | 团队协作体系 (Agent Teams) |
| :--- | :--- | :--- |
| **组织拓扑** | 严格的父子层级树 (Parent-Child Tree) | 扁平对等网络 (Peer-to-Peer Mesh)，Lead 隐式作为队长 |
| **生命周期** | 由调用者单向持有句柄，调用 `run.dispose()` 销毁 | 成员常驻于同一会话团队中，支持休眠冷态与自动唤醒 |
| **通信拓扑** | 单向委派与汇总结果，不支持同级跨分支对讲 | 任意队友之间拥有持久化对等收件箱 (Peer Mailbox) |
| **协同介质** | 提示词注入或上下文历史前缀 | 共享持久化任务有向无环图 (Task DAG)，强校验 CAS 版本 |
| **写入作用域** | 默认共享全局工作区，并发修改容易引发写冲突 | 严格划分物理写入作用域 (`write_scopes`)，物理隔离写冲突 |
| **核心包归属** | `@deepseek-ai/dsh-subagent` | `@deepseek-ai/dsh-experimental-agent-team` |

---

## 三、文件系统防覆盖观察策略 (fs-observation-policy) 与 ObservedStateGate

许多开发者在开发自动化写文件工具时，经常遇到模型写入文件被系统拦截报错。**这是 DSH 极具前瞻性的核心安全设计**！
注意：**并不存在 `stale observation` 这个错误码**，实际拦截分为三个稳定码：`FS_NOT_OBSERVED`（未先 read 就 write/edit）、`FS_STALE_VERSION`（读后文件版本变化，或文件已消失）、`FS_SANDBOX_DENIED`（沙箱围栏拒绝）。

官方核心包 `@deepseek-ai/dsh-fs-observation-policy` 实现了纯事件驱动的安全网关：

```
  模型试图调用 edit('file.txt', ...) 写入磁盘
                   │
                   ▼
  fs-observation-policy 拦截并在弱引用表匹配该文件的观察历史
                   │
     ┌─────────────┴─────────────┐
     │ 存在有效前置 read 记录    │ 未读取过该文件，或自上次 read 后已被外部改动
     ▼                           ▼
  放行写入，更新观察时间戳      拒绝写入！报错拦截
  原子级保证不覆盖外部变动      未读为 FS_NOT_OBSERVED；读后变化为
                                FS_STALE_VERSION，强制先 read 再修改
```

### 1. ObservedStateGate 弱引用存储结构与三元状态
观察网关内部维护了一个按调用方所有者隔离的弱引用哈希表：
```ts
type ObservedStateMap = WeakMap<AgentSession, Map<NormalizedPath, ObservedState>>
```
每个文件的观察状态严格划分为三种：
1. **`unseen`**：从未被当前会话读取过。此时尝试 `edit` 或覆写 `write` 坚决拦截，抛出 `FS_NOT_OBSERVED`；
2. **`confirmed-absent`**：已执行读取并物理确认目标文件不存在。此时允许模型执行受保护的新建操作（`writeIntent` 授权 `createIfAbsent`）；
3. **`present`**：已成功读取，记录包含操作系统底层纳秒精度的复合版本指纹：
   ```ts
   type FileVersionFingerprint = `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`
   ```
   该指纹融合了设备号、inode、文件大小、纳秒级修改时间与状态变更时间，同秒内的内容变动同样能够敏锐感知并捕获。

### 2. 多智能体并发下的弱引用协同与写冲突自愈
- **所有者隔离机制**：WeakMap 的键是各个 Agent 的活动会话句柄（`AgentSession`）。这意味着父智能体、子智能体以及各个团队队友之间的观察记录是**相互独立隔离的**。队友 A 读取了文件，不代表队友 B 拥有写授权，每个智能体必须在自己的上下文中完成权威读取；
- **内存零泄漏保障**：当子智能体运行结束并被销毁后，其对应的 `AgentSession` 引用失效，观察记录随 GC 自动回收，彻底杜绝长时间运行任务中的隐式内存泄漏；
- **并发写冲突自愈规范**：当队友 A 修改了文件导致底层纳秒指纹改变后，队友 B 尝试写入会立刻被网关拦截并抛出 `FS_STALE_VERSION`。队友 B 必须严格遵循：
  1. **回读 (Read)**：重新读取最新文件内容，刷新自身观察记录；
  2. **重基 (Rebase)**：基于最新内容重新计算编辑差异；
  3. **原子重试 (Retry)**：发起带有最新版本守卫的原子提交。

---

## 四、Agent Client Protocol (ACP) 协议

对于需要由外部自动化系统或程序化客户端驱动 DSH 会话的场景，`@deepseek-ai/dsh-acp` 提供了基于 JSON-RPC stdio 的官方服务端实现：

### 1. 协议边界与分工
- **承载内容**：标准化配置协商、MCP 工具动态挂载、提示词内容传递、已提交语义更新的流式推送、任务取消、以及一次性权限审批决策；
- **隔离边界**：图形界面的富交互呈现保留在 Web 模块中，ACP 纯粹专注于轻量、稳定、低开销的跨进程自动化对等通信。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.5
packages/acp/acp  <-  @deepseek-ai/dsh-acp@<version>
packages/bundle/acp-app  <-  @deepseek-ai/dsh-acp-app@<version>
packages/experimental/agent-team  <-  @deepseek-ai/dsh-experimental-agent-team@<version>
packages/experimental/tool-agent-team  <-  @deepseek-ai/dsh-experimental-tool-agent-team@<version>
packages/fs/fs-local  <-  @deepseek-ai/dsh-fs-local@<version>
packages/fs/fs-observation-policy  <-  @deepseek-ai/dsh-fs-observation-policy@<version>
packages/subagent/subagent  <-  @deepseek-ai/dsh-subagent@<version>
packages/subagent/subagent-fork-in-process  <-  @deepseek-ai/dsh-subagent-fork-in-process@<version>
packages/subagent/subagent-spawn-in-process  <-  @deepseek-ai/dsh-subagent-spawn-in-process@<version>
packages/subagent/tool-subagent  <-  @deepseek-ai/dsh-tool-subagent@<version>
packages/subagent/tool-subagent-control  <-  @deepseek-ai/dsh-tool-subagent-control@<version>
```
