# 服务与依赖注入

服务是 Cordis 插件向其他插件暴露的核心能力抽象。插件通过 `inject` 声明所需服务，通过 `ctx.<serviceKey>` 使用服务，或通过继承 `Service` 类提供新服务。

## 核心服务脊梁 (The Core Spine)

在 DeepSeek Harness (DSH 0.2.0-rc.2) 中，运行时能力由核心包挂载到 `ctx` 上的服务提供。服务名称具有严格的单复数与大小写约定：

| 服务名称 | 挂载属性 | 所属核心包 | 核心职责 |
| --- | --- | --- | --- |
| SessionLog | `ctx.sessions` | `@deepseek-ai/dsh-session` | 仅追加的 `SessionEvent` 事件源日志与状态唯一真源（注意为复数） |
| SystemPrompt | `ctx.systemPrompt` | `@deepseek-ai/dsh-system-prompt` | 系统提示词组装、片段收集与工具 Schema 呈现 |
| ToolRuntime | `ctx.tools` | `@deepseek-ai/dsh-tools` | 作用域化工具注册表、保护执行管线与展示投影 |
| AgentRegistry | `ctx.agents` | `@deepseek-ai/dsh-agent` | 活跃 Agent 句柄注册表、发起者作用域与 `agent/*` 事件（注意为复数） |
| AgentLoop | `ctx.agentLoop` | `@deepseek-ai/dsh-agent-loop` | 实现 `AgentFactory` 的默认执行循环驱动器 |
| LlmRuntime | `ctx.llm` | `@deepseek-ai/dsh-llm` | 提供方无关消息协议、流式分发、重试策略与适配器注册 |
| ConfigEditor / Settings | `ctx.settings` | `@deepseek-ai/dsh-settings` | 配置表单、补丁持久化与设置描述符管理 |
| Credentials | `ctx.credentials` | `@deepseek-ai/dsh-credentials` | 用户凭证、环境变量与安全认证存储管理 |
| AgentDefaultModel | `ctx.agentDefaultModel` | `@deepseek-ai/dsh-agent-default-model` | 全局与 Profile 默认模型路由配置解析 |
| AgentPresets | `ctx.agentPresets` | `@deepseek-ai/dsh-agent-presets` | 预设 Agent 模板与执行策略注册表 |

注意：`@deepseek-ai/dsh-scope` 是纯函数库（提供 `createScope`、`scopeOf`、`scopeTarget`），不挂载服务。

## 消费服务

插件必须通过静态属性 `inject` 显式声明依赖。框架保证：只有当 `inject` 中声明的所有必需服务均已就绪（READY）时，插件的 `apply()` 或构造函数才会执行。

### 数组形式（必需依赖）

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-consumer'
export const inject = ['tools', 'sessions']

export function apply(ctx: Context) {
  // apply 执行时，ctx.tools 与 ctx.sessions 保证已就绪
  ctx.tools.register({
    /* ... */
  })
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
  // ctx.tools 必定可用
  ctx.tools.register({
    /* ... */
  })

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
  // 声明自身依赖的其他服务
  static inject = ['settings']

  constructor(ctx: Context) {
    // 第一个参数是绑定的 Context，第二个参数是挂载到 ctx 上的服务键名
    super(ctx, 'database', true)
  }

  protected override start(): void | Promise<void> {
    // 服务就绪时的启动逻辑，例如建立连接池
  }

  protected override stop(): void | Promise<void> {
    // 插件卸载或服务销毁时的清理逻辑，例如关闭连接
  }

  public query(sql: string) {
    return [/* 查询结果 */]
  }
}

export const name = 'database-service'

export function apply(ctx: Context) {
  ctx.plugin(DatabaseService)
}
```

`super(ctx, 'database', true)` 的第三个参数表示服务是否为单例/立即生效服务（immediate）。设置为 `true` 时，该服务实例将直接挂载到当前上下文树根节点，供全局可见。

### 2. 服务生命周期与就绪契约

- **构造阶段**：当服务类被实例化时，`ctx.database` 立即被赋值。
- **start() 钩子**：所有依赖就绪后调用。若返回 Promise，下游依赖该服务的插件会保持等待，直到 Promise 兑现。
- **stop() 钩子**：服务所属插件被卸载或环境退出时触发，执行优雅停机与资源释放。
- **可逆效果**：服务内部通过 `this.ctx.on()` 监听的事件、通过 `this.ctx.effect()` 注册的资源，均与当前上下文生命周期绑定，卸载时自动注销。

## 声明合并与类型安全

在 TypeScript 开发中，必须通过 `declare module '@deepseek-ai/cordis'` 扩展 `Context` 接口，以确保在整个项目中访问 `ctx.<serviceKey>` 时获得完整的代码提示与静态类型检查：

```ts
import type { DatabaseService } from './database'

declare module '@deepseek-ai/cordis' {
  interface Context {
    database: DatabaseService
  }
}
```

## 循环依赖与加载顺序规则

- **启动并发**：配置清单（`cordis.patch.yml`）中的各个插件条目是并发激活的，列表的前后物理顺序不代表插件的加载执行顺序。
- **依赖决序**：插件加载顺序完全由 `inject` 拓扑关系决定。
- **死锁防护**：严禁在两个插件之间出现相互必需的循环依赖（A 必需 B，B 必需 A），否则两个插件将均处于永久 PENDING 状态。如需双向交互，其中一方必须将依赖声明为 `optional`，或通过事件解耦。
