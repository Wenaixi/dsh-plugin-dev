# DSH 子智能体引擎 (Subagents)、文件观察策略与 ACP 协议权威指南 (DSH 0.2.0-rc.2)
---

## 一、子智能体能力切面架构 (`ctx.subagents`)

在 DSH 中，智能体不仅能独立执行任务，还能将聚焦的子任务委托给独立的子智能体（Subagent）在独立的上下文环境中运行，避免主会话上下文被海量中间检索污染。

官方核心包 `@deepseek-ai/dsh-subagent` 提供了标准能力切面服务 `ctx.subagents`：

### 1. 三大服务提供方 (Service Providers)
系统支持多种并存的子智能体运行提供方，调用方按名称选择：
- **`spawn`（插件 `@deepseek-ai/dsh-subagent-spawn-in-process`）**：在当前进程中拉起全新的独立子智能体，完全不继承父会话历史，用于全新无污染的独立任务（如全网背景调研）；
- **`fork`（插件 `@deepseek-ai/dsh-subagent-fork-in-process`）**：分叉继承父会话当前已完成的全部轮次历史，用于需要上下文背景的后续分析与审查；
- 以上两个插件的注册名均可通过各自 `Config.providerName` 覆盖（默认 `spawn` / `fork`）；
- **ACP（`@deepseek-ai/dsh-acp` + `dsh-acp-app`）**：基于 `@agentclientprotocol/sdk` 的 Agent Client Protocol **服务端适配层**（JSON-RPC stdio，启动入口 `dsh --profile acp`，由 `dsh-acp-app` 解析），**不注册为 `ctx.subagents` 的 provider**。注意：客户端包 `@deepseek-ai/dsh-subagent-acp` 未随 0.2.0-rc.2 发布集安装（asar 289 包中不存在），因此注册表中没有 ACP 提供方。

### 2. 单次运行 (One-Shot) vs 可持续会话 (Continuable)
`ctx.subagents` 明确区分了两种调用者意图：
1. **`start(name, request)`**：单次任务，返回**调用方持有的 run 句柄**（`{ id, result, dispose() }`）；`dispose()` 幂等，**由调用方在结果结算后显式调用**（工具层 `dsh-tool-subagent` 就是在结果收集完成后 dispose），不是立即自动释放；
2. **`startContinuable(spec)`**：建立可多次持续通信的长寿命子智能体句柄，主智能体可以通过 `send_message` 追加信件，或调用 `interrupt_agent` 进行紧急中断控制。

模型侧的 `send_message` 与 `interrupt_agent` 由 `@deepseek-ai/dsh-tool-subagent-control` 注册；`list_agents` 属于 Agent Teams 的 `@deepseek-ai/dsh-experimental-tool-agent-team`（配合 `wait_agent`、`team_task_*`、`spawn_teammate`），不在 `dsh-tool-subagent-control` 中。

---

## 二、文件系统防覆盖观察策略 (`fs-observation-policy`)

许多开发者在开发自动化写文件工具时，经常遇到模型写入文件被系统拦截报错。**这是 DSH 极具前瞻性的核心安全设计**！注意：**并不存在 `stale observation` 这个错误码**，实际拦截分为三个稳定码：`FS_NOT_OBSERVED`（未先 read 就 write/edit）、`FS_STALE_VERSION`（读后文件版本变化，或文件已消失）、`FS_SANDBOX_DENIED`（沙箱围栏拒绝）。

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

### 1. 核心铁律：编辑前必须先读 (Read-Before-Write)
- 插件或模型在修改文件之前，**必须先通过合法工具（如 `read`）建立对目标文件的权威观察记录**；
- 如果文件从未被观察过，或其版本自上次观察后发生了改变，网关会坚决阻断写入，彻底杜绝多智能体并发或外部进程修改时的“盲目覆写覆盖（Clobber）”灾难；
- **版本指纹是复合值** `dev:ino:size:mtimeNs:ctimeNs`（设备号、inode、大小、纳秒级 mtime 与 ctime），不是纯 mtime，因此同秒内的内容改写也能被识别；
- **观察状态只存在内存 WeakMap**（按 owner 弱引用，owner 通常是 agent.session），进程重启或会话恢复后必须重新 `read` 才能获得写权限；
- 未观察过的**缺失路径**允许授权创建（`writeIntent` 返回 `createIfAbsent`），已确认缺失的目标 edit 则报 `FS_NOT_FOUND`。

---

## 三、Agent Client Protocol (ACP) 协议

对于需要由外部自动化系统或程序化客户端驱动 DSH 会话的场景，`@deepseek-ai/dsh-acp` 提供了基于 JSON-RPC stdio 的官方服务端实现：

### 1. 协议边界与分工
- **承载内容**：标准化配置协商、MCP 工具动态挂载、提示词内容传递、已提交语义更新的流式推送、任务取消、以及一次性权限审批决策；
- **隔离边界**：图形界面的富交互呈现保留在 Web 模块中，ACP 纯粹专注于轻量、稳定、低开销的跨进程自动化对等通信。
