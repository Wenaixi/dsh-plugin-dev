# 服务与依赖注入

服务是 Cordis 插件向其他插件暴露的核心能力抽象。插件通过 `inject` 声明所需服务，通过 `ctx.<serviceKey>` 使用服务，或通过继承 `Service` 类提供新服务。

## 核心服务脊梁 (The Core Spine)

在 DSH 中，运行时能力由核心包挂载到 `ctx` 上。官方 capability-seams 口径用四种**角色**描述每个服务键：

| 角色 | 语义 |
| --- | --- |
| **core** | 每个组合必启动的主干服务 |
| **seam** | 可替换能力缝：契约与实现分离，实现以不同名称注册提供方 |
| **bundle** | 具体组合包（如 `dsh-base`、`dsh-sdk-minimal`），不是服务 |
| **service** | 独立服务 |

**关键误区纠正**：

- `ctx.llm` 的官方角色是 **seam**（契约 `@deepseek-ai/dsh-llm`，实现 `llm-deepseek` / `llm-pi-ai` / `llm-replay`），不是 core。
- `ctx.agentLoop` 是 **bundle**：官方原文"唯一的具体循环插件；扩展包依赖 dsh-agent 的事件和服务，而不依赖此包"。扩展插件**绝不直接依赖** `@deepseek-ai/dsh-agent-loop`。
- 服务键的单复数有严格约定：`ctx.sessions`（复数）、`ctx.agents`（复数）是 registry；单数键（如 `ctx.llm`）用于引擎/运行时/策略等。

### 官方核心服务矩阵（capability-seams）

| ctx 键 | 角色 | 契约包 | 实现/提供方 | 核心职责 |
| --- | --- | --- | --- | --- |
| `ctx.sessions` | core | `@deepseek-ai/dsh-session` | session-memory + persistence-fs | 仅追加的 SessionEvent 唯一真源日志与状态快照（注意为复数） |
| `ctx.systemPrompt` | core | `@deepseek-ai/dsh-system-prompt` | — | 系统提示词组装、片段收集、工具 Schema 呈现 |
| `ctx.tools` | core | `@deepseek-ai/dsh-tools` | — | 注册能力、PTC 传输、调用经 策略前处理→单调守卫→环绕分派→策略后处理→最终结果观测 |
| `ctx.agents` | core | `@deepseek-ai/dsh-agent` | agent-loop（经 setFactory） | 活跃 Agent 注册表、发起者作用域与 agent/* 事件（注意为复数） |
| `ctx.settings` | core | `@deepseek-ai/dsh-settings` | config-editor | 从活动 profile 条目投影 volatile Config 字段成表单，委托 config-editor 持久化 |
| `ctx.configEditor` | core | `@deepseek-ai/dsh-config-editor` | — | 在应用文件锁与 HMR 队列下持久化 profile 配置补丁，协调 Loader 条目 |
| `ctx.agentPresets` | core | `@deepseek-ai/dsh-agent-presets` | — | 立即挂载 YAML 声明的 preset 版本，保留已替换版本直到最后使用者释放 |
| `ctx.llm` | **seam** | `@deepseek-ai/dsh-llm` | llm-deepseek / llm-pi-ai / llm-replay | 提供方无关消息流式协议与适配器注册（消费方：agent-loop、compaction-basic） |
| `ctx.credentials` | seam | `@deepseek-ai/dsh-credentials` | credentials-local | 用户凭证、环境变量与安全认证存储 |
| `ctx.subprocess` | seam | `@deepseek-ai/dsh-subprocess` | subprocess-local | 子进程 spawn、终端原语（bash 执行器、PTY、LSP Host、ACP 后端均经它） |
| `ctx.shell` | seam | `@deepseek-ai/dsh-shell` | bash-local / bash-sandbox / pwsh-local | 终端执行沙箱 |
| `ctx.web` | seam | `@deepseek-ai/dsh-web` | web-search-exa/perplexity/deepseek、web-fetch-http | 网页搜索与抓取（提供方注册能力而非工具） |
| `ctx.jobs` | seam | `@deepseek-ai/dsh-jobs` | jobs-local | 后台任务生命周期 |
| `ctx.fs` | seam | `@deepseek-ai/dsh-fs` | fs-local / fs-sandbox / fs-ssh | 文件系统能力（配套 fs-observation-policy） |
| `ctx.sessionPersistence` | seam | `@deepseek-ai/dsh-session-persistence` | session-persistence-jsonl | 会话持久化存储 |
| `ctx.sessionQuery` | seam | `@deepseek-ai/dsh-session-query` | session-query-sqlite | 会话查询 |
| `ctx.storage` | seam | `@deepseek-ai/dsh-storage` | storage-json / storage-sqlite | 通用键值存储 |
| `ctx.skills` | seam | `@deepseek-ai/dsh-skill` | skill-filesystem / skill-badge / skill-office | 技能注册表与调用策略 |
| `ctx.ptcRuntime` | seam | `@deepseek-ai/dsh-ptc-runtime` | ptc-runtime-local | PTC 模式程序执行运行时 |
| `ctx.sandbox` | seam | `@deepseek-ai/dsh-sandbox` | sandbox-local（bwrap/Landlock、Seatbelt、Windows ACL） | 文件效果策略沙箱（SandboxMode 不管网络/进程可见性） |
| `ctx.approval` | seam | `@deepseek-ai/dsh-approval` | approval-local | 审批请求（approval/request waterfall） |
| `ctx.compaction` | seam | `@deepseek-ai/dsh-compaction` | compaction-basic | 上下文压缩 |

注意：`@deepseek-ai/dsh-scope` 是**纯函数库**（提供 `createScope`、`scopeOf`、`scopeTarget`、`ScopedLayers`），**不挂载任何 ctx 服务**。

**skills 注册表（`ctx.skills`）细节**：

- `SkillProvider{name; list(options)→SkillCandidate[]|SkillProviderObservation; get(candidate,options)}`；`SkillInvocationPolicy{modelInvocable; userInvocable}`（frontmatter 键 `disable-model-invocation`、`user-invocable`，双 false 仅受信 `ctx.skills.get()` 可取）。
- 本地发现优先级 Rank（同层内低 rank 赢重名→提供方顺序→本地顺序）：100 project-dsh（`<projectRoot>/.dsh/skills`）、200 project-agents（`<projectRoot>/.agents/skills`）、300 custom（`Config.customSkillDirs`）、400 user-dsh（`<dshHome>/skills`）、500 user-agents（`<agentsHome>/skills`）、600 bundled（`Config.bundledSkillDir`/DSH_BUNDLED_SKILL_DIR）。项目根=含 .git 的最近祖先（找不到用 cwd）。
- skill 名 `^[a-z0-9]+(?:-[a-z0-9]+)*$`；接受 `<name>/SKILL.md` 目录包或 `<name>.md` 扁平文件；**递归 `/**/SKILL.md` 发现不支持**。
- 模型会话目录只用 name + description（XML 转义），**绝不使用正文/绝对路径/来源/提供方**；`catalogDescriptionMaxLength` 默认 500、最小 3；目录消息属于会话历史而非 World State；仅改正文只影响后续工具调用。
- 注册表不缓存完整定义（`get()` 每次重读正文）；提供方代次变化→发现重试一次、再变→标不完整不缓存；事件 `skills/change`（emit，无 diff 失效通知）。

**宿主侧可选能力（不进 seam 矩阵，按需加载）**：

- `ctx.planMode`（`@deepseek-ai/dsh-plan-mode`）：`PlanModeController`——记入日志的逐 agent 协作状态，激活期间每个模型请求带 `plan:policy` 提示词段落（order 50 渲染）；`PlanModeConfig{ section }` 非法（缺失/空白/非字符串/未知键）→ 插件加载时失败；`set(agent, active)` 返回 `'committed'|'queued'|'cancelled'|'noop'`（重复选择幂等）。计划模式是**软性指引**：沙箱模式与审批策略分别强制限制且都不读写计划状态；该包可选、agent loop 不依赖它。
- `ctx.workspaceRegistry`（`@deepseek-ai/dsh-workspace`）：用户工作目录的持久记录（`Workspace{id, path, title, sessionIds,...}`）。成员资格双条件：账本有 id 且 header 规范 `cwd === workspace path`；所有权真源是有序 `sessionIds`，绝不从 cwd 派生。宿主侧可选能力、**不对模型可见**（无工具/无提示词/无会话事件）。
- `dsh-agent-instructions` **不是** workspace 消费方：它在 agent 自己 cwd 下发现 AGENTS.md 风格指令文件，从不触碰 `ctx.workspaceRegistry`。

## 消费服务

插件必须通过静态属性 `inject` 显式声明依赖。框架保证：只有当 `inject` 中声明的所有必需服务均已就绪（READY）时，插件的 `apply()` 或构造函数才会执行。

### 数组形式（必需依赖）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-consumer'
export const inject = ['tools', 'sessions']

export function apply(ctx: Context) {
  // apply 执行时，ctx.tools 与 ctx.sessions 保证已就绪
  ctx.tools.register({ /* ... */ })
}
```

### 对象形式（区分必需与可选依赖）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-hybrid-plugin'
export const inject = {
  required: ['tools'],
  optional: ['llm', 'credentials'],
}

export function apply(ctx: Context) {
  ctx.tools.register({ /* ... */ })
  // 可选服务需在使用前进行存在性判定
  if (ctx.llm) {
    // 接入 LLM 额外能力
  }
}
```

## 提供服务

编写自定义服务时，继承 `Service` 类并提供类型合并声明。

### 1. 服务类实现

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    database: DatabaseService
  }
}

export class DatabaseService extends Service {
  static inject = ['settings']

  constructor(ctx: Context) {
    // 第二个参数是挂载到 ctx 上的服务键名
    super(ctx, 'database', true)
  }

  protected override start(): void | Promise<void> {
    // 服务就绪时的启动逻辑，例如建立连接池
  }

  protected override stop(): void | Promise<void> {
    // 插件卸载或服务销毁时的清理逻辑，例如关闭连接
  }

  public query(sql: string) {
    return []
  }
}

export const name = 'database-service'

export function apply(ctx: Context) {
  ctx.plugin(DatabaseService)
}
```

### 2. 服务生命周期与就绪契约

- **构造阶段**：`super(ctx, name)` 调用后服务**立即注册**到 `ctx.<name>`，并随所属 fiber **自动移除**（无需手动注销）。
- **start() 钩子**：所有依赖就绪后调用。若返回 Promise，下游依赖该服务的插件会保持等待。
- **stop() 钩子**：服务所属插件被卸载或环境退出时触发。
- **可逆效果**：服务内部通过 `this.ctx.on()` 监听的事件、通过 `this.ctx.effect()` 注册的资源，均与当前上下文生命周期绑定，卸载时自动注销。
- **命名规则**：单数 ctx 键用于 engine/runtime/policy/controller/resolver/store/当前配置；复数键用于 registry 或拥有多个具名成员的服务；host 与 client **不得复用同一个 Cordis Context 键**（TS 声明合并会同时看到两种类型）。

## 声明合并与类型安全

必须通过 `declare module '@deepseek-ai/cordis'` 扩展 `Context` 接口，以获得完整的代码提示与静态类型检查：

```ts
import type { DatabaseService } from './database'

declare module '@deepseek-ai/cordis' {
  interface Context {
    database: DatabaseService
  }
}
```

## 循环依赖与加载顺序规则

- **启动并发**：配置清单（`cordis.patch.yml`）中的各个插件条目是并发激活的，列表的前后物理顺序不代表插件加载顺序。
- **依赖决序**：插件加载顺序完全由 `inject` 拓扑关系决定。
- **死锁防护**：严禁两个插件之间出现相互必需的循环依赖（A 必需 B，B 必需 A），否则两个插件均处于永久 PENDING。如需双向交互，一方必须将依赖声明为 `optional`，或通过事件解耦。
