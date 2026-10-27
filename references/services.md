# DSH 核心服务与扩展服务架构参考指南

本文件整理服务挂载、依赖注入和扩展边界。服务清单与挂载键随版本和 profile 变化，使用前必须按目标发布物与运行时复核。

---

## 一、核心大动脉服务矩阵 (The Core Spine)

DSH 采用微内核架构，没有特权核心，所有核心能力均以 Cordis 服务形式挂载于共享 Context。
核心包分为三类角色：
- **core**：不可替代的平台骨干服务；
- **seam**：契约与实现分离的抽象边界，支持多提供方替换；
- **bundle**：唯一的具体实现组合包。

| 服务名称 | 挂载属性 | 角色 | 所属核心包 | 职责与官方权威规范 |
| --- | --- | --- | --- | --- |
| SessionStore | `ctx.sessions` (复数!) | core | `@deepseek-ai/dsh-session` | 仅追加的 SessionEvent 日志与会话状态唯一真源，严禁误写为单数 session。 |
| SystemPrompt | `ctx.systemPrompt` | core | `@deepseek-ai/dsh-system-prompt` | 提示词片段组装、优先级排序与工具 Schema 排序（Schema 由 provider 提供，本包只消费与排序）。方法名为 `section()`，非 `addSection()`。 |
| ToolRuntime | `ctx.tools` | core | `@deepseek-ai/dsh-tools` | 工具注册表、单调卫士 (guard)、PTC 传输、固定执行管线（官方规范为 pre-execute → guards → execute → post-execute → finalizeContent → result 六段）。 |
| AgentRegistry | `ctx.agents` (复数!) | core | `@deepseek-ai/dsh-agent` | 活动 Agent 实例句柄注册表、发起者作用域与 `agent/*` 生命周期事件。 |
| ConfigEditor | `ctx.configEditor` | core | `@deepseek-ai/dsh-config-editor` | 在应用文件锁与 HMR 队列保护下持久化 profile 补丁，协调 Loader 动态条目。 |
| Settings | `ctx.settings` | core | `@deepseek-ai/dsh-settings` | 将 profile 动态条目投影为表单视图，校验输入并委托 configEditor 落盘。 |
| ClientModules | `ctx.clientModules` | core | `@deepseek-ai/dsh-client-modules` | Host 侧挂载 `ctx.clientModules`，Browser 侧挂载 `ctx.modules`。掌管 Dual-Face 插件引导图、Combo 资源路由与 HMR 热重载。 |
| AgentLoop | `ctx.agentLoop` | **bundle** | `@deepseek-ai/dsh-agent-loop` | 唯一的具体循环实现包；外部扩展插件依赖 `dsh-agent` 事件与服务，严禁直接依赖此包。 |
| LlmRuntime | `ctx.llm` | **seam** | `@deepseek-ai/dsh-llm` | 提供方无关的统一流式协议 Chunk 派发与适配器注册（如 llm-deepseek、llm-pi-ai）。 |

---

## 二、当前版本新增的核心与扩展服务

### 1. 跨轮次持久化目标系统 (GoalService)
- **挂载属性**：`ctx.goals` (复数!)
- **所属包**：`@deepseek-ai/dsh-goal`
- **职责**：管理长周期跨轮次单一完成目标，支持跨轮次、会话恢复 (resume)、分叉 (fork) 与进程重启持久化。
- **核心契约与 CAS 机制**：
  - 仅接受在当前 ID 下注册的活动 `Agent` 实例；
  - `ctx.goals.get(agent)` 返回深拷贝隔离的 `GoalView`；
  - 所有状态流转（`create`, `edit`, `pause`, `resume`, `complete`, `blocked`, `clear`）均强制要求传入 `GoalRef { id, revision }`，底层执行原子级 CAS (Compare-And-Set) 校验，拒绝过期视图；
  - 阻塞状态（`blocked`）必须保留稳定策略码与人类可读原因。
- **进程级激活态安全隔离**：
  - `armed` 与 `disarmed` 状态只存在于会话内存缓存中，**绝不持久化**；
  - 进程重启、会话反序列化或每次 `agent/created` 触发时，目标即使处于 active 阶段也默认处于 `disarmed` 状态，防止未经用户确认的自动死循环；只有用户显式发送继续指令才会被 rearm。
- **事件协同**：持久化写入 `goal/change` 会话事件，运行时派发 `goal/changed` 与 `goal/activation-changed`。

### 2. 团队协作大动脉 (AgentTeamService)
- **挂载属性**：`ctx.agentTeams` (复数!)
- **所属包**：`@deepseek-ai/dsh-experimental-agent-team`（配套组合包：`@deepseek-ai/dsh-experimental-agent-team-profile`）
- **职责**：同会话多 Agent 团队编排。当前会话 Agent 隐式成为 Lead，管理命名队友（Teammates）、持久化对等收件箱（Peer Mailbox）与共享任务有向无环图（Task DAG）。
- **工具支持**：挂载配套包 `@deepseek-ai/dsh-experimental-tool-agent-team` 后暴露 `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`。

### 3. 计划模式控制器 (PlanModeController)
- **挂载属性**：`ctx.planMode` (单数)
- **所属包**：`@deepseek-ai/dsh-plan-mode`
- **职责**：控制规划探索与用户审核流程。激活时向模型注入引导提示，通过 `exit_plan_mode` 呈现完成的计划供用户确认；用户可通过 `/plan` 开启，`/plan off` 直接退出。
- **软性指引设计**：planMode 属于软性提示工程指引，不硬性剥夺模型工具调用权。若需强制阻断高危操作，必须通过沙箱模式（`ctx.sandbox`）与审批机制（`ctx.approval`）实现。
- **持久化语义**：通过 `plan/mode` 事件写入持久化日志，推导 `{ active, pending }` 视图，保证会话恢复或分叉后状态不丢失。

### 4. 统一会话历史查询大动脉 (SessionQueryService)
- **挂载属性**：`ctx.sessionQuery` (单数)
- **抽象 Seam**：`@deepseek-ai/dsh-session-query`
- **官方默认实现包**：`@deepseek-ai/dsh-session-query-sqlite`
- **职责**：为上层应用和工具提供统一的会话历史读取、过滤、事件追踪与全文检索。
- **核心架构原则**：
  - **内存优先统一逻辑语料**：读取时优先使用内存中活跃的 `ctx.sessions`，持久化层（`ctx.sessionPersistence`，如 JSONL）填补剩余历史，冲突的不可变头直接报错拒绝合并；
  - **结果完全解耦隔离**：返回的所有事件、头部和上下文均进行深拷贝解耦，不泄露活动引用；
  - **SQLite FTS5 引擎**：在 SQLite 存储后端建立倒排索引，支持高性能分词全文检索、相关度计算与事件范围上下文展开。

### 5. 语义检查点持久化策略 (SessionCheckpointPolicy)
- **挂载服务 / 守卫网关**：`ctx.sessionCheckpointPolicy`
- **所属包**：`@deepseek-ai/dsh-session-checkpoint-policy`
- **职责**：在崩溃易失窗口建立三道严格的语义检查点防线：
  1. 向外部大模型适配器发起 HTTP 流式请求前；
  2. 顶级工具执行体（带有外部副作用的操作）执行前；
  3. 每个 Agent 步骤（pre-step）开始前。
- **Fail-Closed 保障**：检查点持久化写入失败时直接熔断阻断后续执行；系统崩溃重启时通过截断 torn tail 并重放 recovered tail 实现零数据损坏。

### 6. 文件系统防覆写观察网关 (FsObservationPolicy)
- **机制形态**：**纯事件网关 (Event Gate)**，不注册 `ctx.fsPolicy` 公开服务方法，避免耦合工具注入。
- **所属包**：`@deepseek-ai/dsh-fs-observation-policy`
- **职责**：拦截 `fs/*` 事件（如 `fs/write-intent`, `fs/edit-intent`, `fs/observe`），通过进程内 WeakMap 记录调用者的前置观察记录。未读先写抛出 `FS_NOT_OBSERVED`，版本过期抛出 `FS_STALE_VERSION`，确保 Read-Before-Write 铁律落地。

### 7. 定时任务系统 (ScheduleService)
- **挂载属性**：`ctx.schedule`（单数）
- **所属包**：`@deepseek-ai/dsh-schedule`
- **职责**：宿主范围内的持久化挂钟提醒与原始会话投递。
- **配置项**：
  - `deliveryHistoryDays`：保留交付记录的天数（默认 30）；
  - `deliveryHistoryRecords`：保留交付记录的条数（默认 200）。
- **投递保证**：交付承诺必须在会话确认 `session/flush` 后提交；冷会话在到期时由宿主自动拉起。
- **暴露工具**：`schedule_create`, `schedule_list`, `schedule_delete`, `schedule_update`。

### 8. 工作区实体注册表 (WorkspaceRegistry)
- **挂载属性**：`ctx.workspaceRegistry`（单数）
- **所属包**：`@deepseek-ai/dsh-workspace`
- **职责**：管理工作区实体元数据与稳定排序。
- **注意**：不对模型直接暴露工具；删除工作区实体保留其目录与每条会话日志。

### 9. 会话压缩策略 Seam (Compaction)
- **抽象 Seam**：`@deepseek-ai/dsh-compaction`
- **官方实现包**：
  - `@deepseek-ai/dsh-compaction-basic`：基础多轮上下文剪枝；
  - `@deepseek-ai/dsh-compaction-image-offload`：多模态图像外部转储；
  - `@deepseek-ai/dsh-compaction-tool-result-pruner`：过期历史工具调用大结果裁剪。

### 10. 作用域纯函数库 (ScopeLib)
- **所属包**：`@deepseek-ai/dsh-scope`
- **规范说明**：纯函数库，导出 `createScope`, `scopeOf`, `scopeTarget`，以直接导入调用；它不在 Context 上挂载任何服务（不存在 `ctx.scope`）。其 peerDependencies 含 `@deepseek-ai/dsh-invariants` 与 `cordis`，不是零依赖包。

### 11. 外部信息桥接 (Modsearch Bridge)
- **所属包**：`@liustack/modsearch`（第三方桥，替代旧版 Exa Filter）
- **职责**：为会话提供多引擎网络搜索与抓取桥接（`web_search`/`read_page`/`x_search` 由运行时注入）。具体提供方以运行时为准。

---

## 三、常用 Seam 契约与提供方包对照

| 抽象 Seam 领域 | 契约包 | 官方默认实现包 | 挂载属性 / 备注 |
| --- | --- | --- | --- |
| 子进程生成 | `@deepseek-ai/dsh-subprocess` | `@deepseek-ai/dsh-subprocess-local` | `ctx.subprocess` |
| 终端管理 | `@deepseek-ai/dsh-terminal` | `@deepseek-ai/dsh-terminal-bash`（同一包承载 bash/pwsh 双方言） | `ctx.terminals`（复数!） |
| 文件系统 | `@deepseek-ai/dsh-fs` | `@deepseek-ai/dsh-fs-local` | `ctx.fs` |
| 凭证存储 | `@deepseek-ai/dsh-credentials` | `@deepseek-ai/dsh-credentials-local` | `ctx.credentials` |
| 会话持久化 | `@deepseek-ai/dsh-session-persistence` | `@deepseek-ai/dsh-session-persistence-jsonl` | 仅追加 JSONL 落盘 |
| 会话查询 | `@deepseek-ai/dsh-session-query` | `@deepseek-ai/dsh-session-query-sqlite` | `ctx.sessionQuery`，SQLite FTS5 查询索引 |
| 沙箱策略 | `@deepseek-ai/dsh-sandbox` | `@deepseek-ai/dsh-sandbox-local` | `ctx.sandbox` |
| 用户审批 | `@deepseek-ai/dsh-user-approval` | 同左（自闭环实现） | `ctx.approval` |
| Agent 预设注册 | `@deepseek-ai/dsh-agent-preset-registry` | `@deepseek-ai/dsh-agent-preset` | `ctx.agentPresets` |
| 技能系统 | `@deepseek-ai/dsh-skill` | `@deepseek-ai/dsh-skill-filesystem` | `ctx.skills` (六级排序 100-600) |
| 领域存储 | `@deepseek-ai/dsh-storage` | `@deepseek-ai/dsh-storage-json` | `ctx.storage` / `ctx.storageDomain` |
| 目标系统 | `@deepseek-ai/dsh-goal` | 同左 | `ctx.goals` (复数!) |
| 团队协作 | `@deepseek-ai/dsh-experimental-agent-team` | 同左 | `ctx.agentTeams` (复数!) |
| 计划模式 | `@deepseek-ai/dsh-plan-mode` | 同左 | `ctx.planMode` (单数) |

---

## 四、自定义服务的编写与生命周期规范

### 1. 服务类定义规范
```js
import { Context, Service } from '@deepseek-ai/cordis'

export class CustomMemoryCache extends Service {
  // 声明在 Context 上的挂载属性名
  constructor(ctx) {
    // 第二个参数即为挂载属性 ctx.memoryCache（官方 Service 构造器只有 (ctx, name?) 两个参数）
    super(ctx, 'memoryCache')
    this.store = new Map()
    // 清理逻辑在构造期用 ctx.effect 注册，随所属 fiber 卸载自动执行
    ctx.effect(() => () => this.store.clear())
  }

  get(key) {
    return this.store.get(key)
  }

  set(key, val) {
    this.store.set(key, val)
  }
}

export function apply(ctx) {
  ctx.plugin(CustomMemoryCache)
}
```

### 2. 消费方依赖注入规则
消费方在声明依赖时，必须通过 `inject` 属性声明所需服务，确保 Cordis 加载器按依赖拓扑完成装载：
```js
export const inject = ['memoryCache', 'tools']

export function apply(ctx) {
  // 此时 ctx.memoryCache 与 ctx.tools 必定已可用
  const cached = ctx.memoryCache.get('my-key')
}
```

### 3. Context 类型定义扩展规范 (TypeScript declare module)
编写 TypeScript 插件时，通过声明合并扩展 `@deepseek-ai/cordis` 的 `Context` 接口，获得完美的代码补全与静态类型保护：

```ts
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SystemPromptService } from '@deepseek-ai/dsh-system-prompt'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { ConfigEditorService } from '@deepseek-ai/dsh-config-editor'
import type { SettingsService } from '@deepseek-ai/dsh-settings'
import type { ClientModulesService } from '@deepseek-ai/dsh-client-modules'
import type { AgentLoopService } from '@deepseek-ai/dsh-agent-loop'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ScheduleService } from '@deepseek-ai/dsh-schedule'
import type { AgentTeamService } from '@deepseek-ai/dsh-experimental-agent-team'
import type { PlanModeController } from '@deepseek-ai/dsh-plan-mode'
import type { GoalService } from '@deepseek-ai/dsh-goal'
import type { SessionQueryService } from '@deepseek-ai/dsh-session-query'
import type { SessionCheckpointPolicy } from '@deepseek-ai/dsh-session-checkpoint-policy'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { SubagentService } from '@deepseek-ai/dsh-subagent'
import type { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import type { FsService } from '@deepseek-ai/dsh-fs'
import type { CredentialsService } from '@deepseek-ai/dsh-credentials'
import type { SandboxService } from '@deepseek-ai/dsh-sandbox'
import type { UserApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { StorageHub, DomainFacility } from '@deepseek-ai/dsh-storage'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'

declare module '@deepseek-ai/cordis' {
  interface Context {
    // 核心骨干服务 (The Core Spine)
    sessions: SessionStore
    systemPrompt: SystemPromptService
    tools: ToolRuntime
    agents: AgentRegistry
    configEditor: ConfigEditorService
    settings: SettingsService
    clientModules: ClientModulesService
    agentLoop: AgentLoopService
    llm: LlmRuntime

    // 平台核心与协同服务
    agentTeams: AgentTeamService
    planMode: PlanModeController
    goals: GoalService
    sessionQuery: SessionQueryService
    sessionCheckpointPolicy: SessionCheckpointPolicy
    workspaceRegistry: WorkspaceRegistry
    schedule: ScheduleService

    // 接缝服务抽象 (Seams)
    subagents: SubagentService
    terminals: TerminalSessionService
    fs: FsService
    credentials: CredentialsService
    sandbox: SandboxService
    approval: UserApprovalService
    agentPresets: AgentPresetRegistry
    skills: SkillRegistry
    storage: StorageHub
    storageDomain: DomainFacility
    jobs: JobRegistry
  }
}
```

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.5
packages/core/agent  <-  @deepseek-ai/dsh-agent@<version>
packages/core/agent-loop  <-  @deepseek-ai/dsh-agent-loop@<version>
packages/preset/agent-preset  <-  @deepseek-ai/dsh-agent-preset@<version>
packages/preset/agent-preset-registry  <-  @deepseek-ai/dsh-agent-preset-registry@<version>
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@<version>
packages/compaction/compaction  <-  @deepseek-ai/dsh-compaction@<version>
packages/compaction/compaction-basic  <-  @deepseek-ai/dsh-compaction-basic@<version>
packages/compaction/compaction-image-offload  <-  @deepseek-ai/dsh-compaction-image-offload@<version>
packages/compaction/compaction-tool-result-pruner  <-  @deepseek-ai/dsh-compaction-tool-result-pruner@<version>
packages/boot/config-editor  <-  @deepseek-ai/dsh-config-editor@<version>
packages/credentials/credentials  <-  @deepseek-ai/dsh-credentials@<version>
packages/credentials/credentials-local  <-  @deepseek-ai/dsh-credentials-local@<version>
packages/experimental/agent-team  <-  @deepseek-ai/dsh-experimental-agent-team@<version>
packages/experimental/agent-team-profile  <-  @deepseek-ai/dsh-experimental-agent-team-profile@<version>
packages/experimental/tool-agent-team  <-  @deepseek-ai/dsh-experimental-tool-agent-team@<version>
packages/fs/fs  <-  @deepseek-ai/dsh-fs@<version>
packages/fs/fs-local  <-  @deepseek-ai/dsh-fs-local@<version>
packages/fs/fs-observation-policy  <-  @deepseek-ai/dsh-fs-observation-policy@<version>
packages/goal/goal  <-  @deepseek-ai/dsh-goal@<version>
packages/llm/llm  <-  @deepseek-ai/dsh-llm@<version>
packages/plan/plan-mode  <-  @deepseek-ai/dsh-plan-mode@<version>
packages/sandbox/sandbox  <-  @deepseek-ai/dsh-sandbox@<version>
packages/sandbox/sandbox-local  <-  @deepseek-ai/dsh-sandbox-local@<version>
packages/schedule/schedule  <-  @deepseek-ai/dsh-schedule@<version>
packages/core/scope  <-  @deepseek-ai/dsh-scope@<version>
packages/core/session  <-  @deepseek-ai/dsh-session@<version>
packages/session/session-checkpoint-policy  <-  @deepseek-ai/dsh-session-checkpoint-policy@<version>
packages/session/session-persistence  <-  @deepseek-ai/dsh-session-persistence@<version>
packages/session/session-persistence-jsonl  <-  @deepseek-ai/dsh-session-persistence-jsonl@<version>
packages/session-query/session-query  <-  @deepseek-ai/dsh-session-query@<version>
packages/session-query/session-query-sqlite  <-  @deepseek-ai/dsh-session-query-sqlite@<version>
packages/settings/settings  <-  @deepseek-ai/dsh-settings@<version>
packages/skill/skill  <-  @deepseek-ai/dsh-skill@<version>
packages/skill/skill-filesystem  <-  @deepseek-ai/dsh-skill-filesystem@<version>
packages/subprocess/subprocess  <-  @deepseek-ai/dsh-subprocess@<version>
packages/subprocess/subprocess-local  <-  @deepseek-ai/dsh-subprocess-local@<version>
packages/core/system-prompt  <-  @deepseek-ai/dsh-system-prompt@<version>
packages/terminal/terminal  <-  @deepseek-ai/dsh-terminal@<version>
packages/terminal/terminal-bash  <-  @deepseek-ai/dsh-terminal-bash@<version>
packages/core/tools  <-  @deepseek-ai/dsh-tools@<version>
packages/interaction/user-approval  <-  @deepseek-ai/dsh-user-approval@<version>
packages/workspace/workspace  <-  @deepseek-ai/dsh-workspace@<version>
```
