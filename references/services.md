# DSH 核心服务与扩展服务架构参考指南

本文件整理服务挂载、依赖注入和扩展边界。服务清单与挂载键随版本和 profile 变化，使用前必须按目标发布物与运行时复核。

---

## 一、核心大动脉服务矩阵 (The Core Spine)

DSH 采用微内核架构，没有特权核心，所有核心能力均以 Cordis 服务形式挂载于共享 `Context`。
核心包分为三类角色：
- **core**：不可替代的平台骨干服务；
- **seam**：契约与实现分离的抽象边界，支持多提供方替换；
- **bundle**：唯一的具体实现组合包。

| 服务名称 | 挂载属性 | 角色 | 所属核心包 | 职责与官方权威规范 |
| --- | --- | --- | --- | --- |
| SessionStore | `ctx.sessions` (复数!) | core | `@deepseek-ai/dsh-session` | 仅追加的 SessionEvent 日志与会话状态唯一真源，严禁误写为单数 session。 |
| SystemPrompt | `ctx.systemPrompt` | core | `@deepseek-ai/dsh-system-prompt` | 提示词片段组装、优先级排序与工具 Schema 排序（Schema 由 provider 提供，本包只消费与排序）。方法名为 `section()`，非 `addSection()`。 |
| ToolRuntime | `ctx.tools` | core | `@deepseek-ai/dsh-tools` | 工具注册表、单调卫士 (guard)、PTC 传输、固定执行管线（官方 README 表述为 pre-execute → guards → execute → post-execute → finalizeContent → result 六段；tools.md 的「16 环节」是文档展开编号，非源码枚举）。 |
| AgentRegistry | `ctx.agents` (复数!) | core | `@deepseek-ai/dsh-agent` | 活动 Agent 实例句柄注册表、发起者作用域与 `agent/*` 生命周期事件。 |
| ConfigEditor | `ctx.configEditor` | core | `@deepseek-ai/dsh-config-editor` | 在应用文件锁与 HMR 队列保护下持久化 profile 补丁，协调 Loader 动态条目。 |
| Settings | `ctx.settings` | core | `@deepseek-ai/dsh-settings` | 将 profile 动态条目投影为表单视图，校验输入并委托 configEditor 落盘。 |
| ClientModules | `ctx.clientModules` | core | `@deepseek-ai/dsh-client-modules` | Host 侧挂载 `ctx.clientModules`，Browser 侧挂载 `ctx.modules`。掌管 Dual-Face 插件引导图、Combo 资源路由与 HMR 热重载。 |
| AgentLoop | `ctx.agentLoop` | **bundle** | `@deepseek-ai/dsh-agent-loop` | 唯一的具体循环实现包；外部扩展插件依赖 `dsh-agent` 事件与服务，**严禁直接依赖此包**。 |
| LlmRuntime | `ctx.llm` | **seam** | `@deepseek-ai/dsh-llm` | 提供方无关的统一流式协议 Chunk 派发与适配器注册（如 llm-deepseek、llm-pi-ai）。 |

---

## 二、当前版本新增的核心与扩展服务

### 1. 定时任务系统 (ScheduleService)
- **挂载属性**：`ctx.schedule`（单数）
- **所属包**：`@deepseek-ai/dsh-schedule`（是否有独立配套组合包需按目标版本核对）
- **职责**：宿主范围内的持久化挂钟提醒与原始会话投递。
- **配置项**：
  - `deliveryHistoryDays`：保留交付记录的天数（默认 30）；
  - `deliveryHistoryRecords`：保留交付记录的条数（默认 200）。
- **投递保证**：交付承诺必须在会话确认 `session/flush` 后提交；冷会话在到期时由宿主自动拉起。
- **暴露工具**：`schedule_create`, `schedule_list`, `schedule_delete`, `schedule_update`。

### 2. 团队协作大动脉 (TeamService)
- **挂载属性**：`ctx.agentTeams`（复数!）
- **所属包**：`@deepseek-ai/dsh-experimental-agent-team`（配套组合包：`@deepseek-ai/dsh-experimental-agent-team-profile`）
- **职责**：同会话多 Agent 团队编排。当前会话 Agent 隐式成为 Lead，管理命名队友（Teammates）、持久化对等收件箱（Peer Mailbox）与共享任务有向无环图（Task DAG）。
- **工具支持**：挂载配套包 `@deepseek-ai/dsh-experimental-tool-agent-team` 后暴露 `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`。

### 3. 计划模式控制器 (PlanModeController)
- **挂载属性**：`ctx.planMode`（单数）
- **所属包**：`@deepseek-ai/dsh-plan-mode`
- **职责**：控制规划探索与用户审核流程。激活时向模型注入引导提示，通过 `exit_plan_mode` 呈现完成的计划供用户确认；用户可通过 `/plan off` 直接退出。
- **软性指引设计**：planMode 属于软性提示工程指引，不硬性剥夺模型工具调用权。若需强制阻断高危操作，必须通过沙箱模式（`ctx.sandbox`）与审批机制（`ctx.approval`）实现。

### 4. 工作区实体注册表 (WorkspaceRegistry)
- **挂载属性**：`ctx.workspaceRegistry`（单数）
- **所属包**：`@deepseek-ai/dsh-workspace`
- **职责**：管理工作区实体元数据与稳定排序。
- **注意**：不对模型直接暴露工具；删除工作区实体**保留**其目录与每条会话日志（`dsh-workspace`：`Delete one workspace registration while retaining its directory and every session log.`）。

### 5. 会话压缩策略 Seam (Compaction)
- **抽象 Seam**：`@deepseek-ai/dsh-compaction`
- **官方实现包**：
  - `@deepseek-ai/dsh-compaction-basic`：基础多轮上下文剪枝；
  - `@deepseek-ai/dsh-compaction-image-offload`：多模态图像外部转储；
  - `@deepseek-ai/dsh-compaction-tool-result-pruner`：过期历史工具调用大结果裁剪。

### 6. 作用域纯函数库 (ScopeLib)
- **所属包**：`@deepseek-ai/dsh-scope`
- **规范说明**：纯函数库，导出 `createScope`, `scopeOf`, `scopeTarget`，以直接导入调用；它不在 Context 上挂载任何服务（不存在 `ctx.scope`）。其 peerDependencies 含 `@deepseek-ai/dsh-invariants` 与 `cordis`，不是零依赖包。

### 7. 外部信息桥接 (Modsearch Bridge)
- **所属包**：`@liustack/modsearch`（第三方桥，替代旧版 Exa Filter）——不在官方发布包内，按宿主运行时版本注入
- **职责**：为会话提供多引擎网络搜索与抓取桥接（`web_search`/`read_page`/`x_search` 由运行时注入）。具体提供方以运行时为准。

---

## 三、常用 Seam 契约与提供方包对照

| 抽象 Seam 领域 | 契约包 | 官方默认实现包 | 挂载属性 / 备注 |
| --- | --- | --- | --- |
| 子进程生成 | `@deepseek-ai/dsh-subprocess` | `@deepseek-ai/dsh-subprocess-local` | `ctx.subprocess` |
| 终端管理 | `@deepseek-ai/dsh-terminal` | `@deepseek-ai/dsh-terminal-bash`（同一包承载 bash/pwsh 双方言，无独立 `dsh-terminal-pwsh`） | `ctx.terminals`（**复数**，见 `TerminalSessionService`） |
| 文件系统 | `@deepseek-ai/dsh-fs` | `@deepseek-ai/dsh-fs-local` | `ctx.fs` |
| 凭证存储 | `@deepseek-ai/dsh-credentials` | `@deepseek-ai/dsh-credentials-local` | `ctx.credentials` |
| 会话持久化 | `@deepseek-ai/dsh-session-persistence` | `@deepseek-ai/dsh-session-persistence-jsonl` | 仅追加 JSONL 落盘 |
| 会话查询 | `@deepseek-ai/dsh-session-query` | `@deepseek-ai/dsh-session-query-sqlite` | SQLite 查询索引 |
| 沙箱策略 | `@deepseek-ai/dsh-sandbox` | `@deepseek-ai/dsh-sandbox-local` | `ctx.sandbox` |
| 用户审批 | `@deepseek-ai/dsh-user-approval`（自身既是契约也是默认实现，不存在 `dsh-approval` 包） | 同左 | `ctx.approval` |
| Agent 预设注册 | `@deepseek-ai/dsh-agent-preset-registry` | `@deepseek-ai/dsh-agent-preset` | `ctx.agentPresets` |
| 技能系统 | `@deepseek-ai/dsh-skill` | `@deepseek-ai/dsh-skill-filesystem` | `ctx.skills` (六级排序 100-600) |

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
