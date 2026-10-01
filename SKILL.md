---
name: dsh-plugin-dev
description: 开发 DeepSeek Harness (DSH) 插件的标准与权威参考：编写/修改/审查/调试 DSH/Cordis 插件、核心服务、事件系统、插件配置、模型工具、LLM 适配器、双面 UI 插件、三角色拆分、打包安装、workspace 多包工程、cordis.patch.yml 组合时使用；提到 DSH 插件、Cordis、plugin、服务、事件、工具、适配器即触发。 The authoritative standard for developing DeepSeek Harness (DSH) plugins — create, modify, review or debug DSH/Cordis plugins, services, events, config, model tools, LLM adapters, dual-face client-ui plugins, three-role architecture, packaging, and cordis.patch.yml composition.
license: MIT
compatibility: 适用于任何支持 Agent Skills 规范的环境；代码遵循 ECMAScript 2022+ / TypeScript 5+；运行于 DSH 0.2.0-rc.2+ 生产基线。
metadata:
  framework: cordis
  target: deepseek-harness
  baseline: 0.2.0-rc.2
---

# DSH 插件开发权威指南

DeepSeek Harness (DSH) 是基于 Cordis 微内核构建的可拔插 Agent Harness。在 DSH 中，**一切皆为插件 (Everything is a Plugin)**：会话日志、工具注册表、提示词生成器、LLM 适配器、UI 界面以及执行循环本身均为可替换的插件。

本文档是开发、审查、调试 DSH 插件的核心速查与操作指南。深入的类型定义与架构机理参见 `references/` 目录下的专项技术文档。

---

## 核心架构原则速查

1. **零特权内核**：不存在固化的特权逻辑。所有能力通过向共享 `Context` 挂载服务或监听事件提供。
2. **核心服务大动脉 (The Core Spine)**：
   - `ctx.sessions` (`@deepseek-ai/dsh-session`)：仅追加事件日志与唯一真源（注意为复数）。
   - `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`)：系统提示词组装与工具 Schema 生成。
   - `ctx.tools` (`@deepseek-ai/dsh-tools`)：工具注册、单调守卫、PTC 投影与多模态渲染。
   - `ctx.agents` (`@deepseek-ai/dsh-agent`)：活跃 Agent 注册表与发起者作用域（注意为复数）。
   - `ctx.agentLoop` (`@deepseek-ai/dsh-agent-loop`)：实现 `AgentFactory` 的默认执行循环驱动器。
   - `ctx.llm` (`@deepseek-ai/dsh-llm`)：提供方无关消息流式协议与适配器接入。
   - `ctx.settings` (`@deepseek-ai/dsh-settings`)：配置表单与补丁持久化服务。
3. **五大事件派发模式**：
   - `emit`: 同步通知，无返回值；
   - `waterfall`: 同步串行链式加工，返回最终结果；
   - `parallel`: `Promise.all` 并发等待，返回结果数组；
   - `serial`: 顺序 `await` 等待，返回结果数组；
   - `bail`: 短路阻断，首个非 `undefined` 返回值立即终止后续监听。
4. **配置落点与全量替换规约**：
   - **废弃警告**：`$DSH_HOME/settings.yaml` 已完全废弃，修改无效。
   - **唯一落点**：`$DSH_HOME/profiles/<profile>/cordis.patch.yml`。
   - **全量替换 (Wholesale Replacement)**：对条目的 `config` 覆盖是整块替换，不做深合并。修改既有条目必须写全全部保留字段。
5. **可逆副作用 (Reversible Effects)**：所有通过 `ctx.on()`、`ctx.effect()`、`ctx.tools.register()` 注册的资源受所属上下文生命周期管理，插件卸载时自动回滚。

---

## 场景速查与代码模板

### 场景 A：创建最小函数插件

适用于无状态逻辑、事件监听与轻量扩展。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-minimal-plugin'
export const inject = ['sessions']

export interface Config {
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  ctx.on('agent/turn-start', (turn) => {
    if (config.verbose) {
      console.log('Turn started for session:', turn.session.id)
    }
  })
}
```

详细规范参见 [references/plugin-anatomy.md](./references/plugin-anatomy.md)。

---

### 场景 B：开发面向模型的工具 (Tool)

通过 `defineTool` 注册强类型工具，支持参数校验、单调安全守卫与多模态渲染。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-calculator-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  // 1. 注册工具
  ctx.tools.register(defineTool({
    name: 'calculate',
    description: 'Perform a basic mathematical calculation.',
    parameters: {
      expression: {
        type: 'string',
        required: true,
        description: 'Mathematical expression to evaluate',
      },
    },
    output: {
      schema: { type: 'number' },
      render: (_args, value) => [
        { type: 'text', text: `Result: ${value}` }
      ],
    },
    async execute(args) {
      // 执行计算逻辑
      return Number(eval(args.expression))
    },
  }))

  // 2. 注册安全把关守卫（单调安全法则：任何守卫返回 string 均阻断）
  ctx.tools.guard((call) => {
    if (call.toolName === 'calculate' && call.args.expression.includes('process')) {
      return 'Security violation: Process access is forbidden in calculate.'
    }
  })
}
```

详细规范参见 [references/tools.md](./references/tools.md)。

---

### 场景 C：提供自定义服务 (Service Provider)

适用于封装长生命周期资源或向其他插件暴露 API。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    kvStorage: KvStorageService
  }
}

export class KvStorageService extends Service {
  static inject = ['settings']
  private store = new Map<string, any>()

  constructor(ctx: Context) {
    super(ctx, 'kvStorage', true)
  }

  public get(key: string) { return this.store.get(key) }
  public set(key: string, val: any) { this.store.set(key, val) }

  protected override start() { /* 启动就绪 */ }
  protected override stop() { this.store.clear() }
}

export const name = 'kv-storage'
export function apply(ctx: Context) {
  ctx.plugin(KvStorageService)
}
```

详细规范参见 [references/services.md](./references/services.md)。

---

### 场景 D：接入自定义 LLM 适配器 (LlmAdapter)

将第三方模型或本地端侧模型通过流式分发协议无缝接入 DSH。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

export class MyCustomLlmAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. 发起网络流式调用（禁用类库内置重试）
    // 2. 输出可见文本增量
    yield { type: 'text-delta', text: 'Hello from custom adapter!' }

    // 3. 上报精确 Token 统计（inputTokens 与 cachedTokens 互斥，reasoningTokens 已内含在 outputTokens）
    yield {
      type: 'usage',
      inputTokens: 100,
      cachedTokens: 50,
      outputTokens: 20,
    }

    // 4. 终结标记
    yield { type: 'finish', reason: 'stop' }
  }
}

export const name = 'my-custom-llm'
export const inject = ['llm']

export function apply(ctx: Context) {
  const adapter = new MyCustomLlmAdapter()
  ctx.llm.registerAdapter(adapter, {
    providers: ['my-provider'],
  })
}
```

详细规范参见 [references/llm-adapter.md](./references/llm-adapter.md)。

---

### 场景 E：开发 Web Client-UI 双面插件

前端界面必须遵循双面架构（Dual-Face），通过 SlotRegistry 注入组件，由打包器编译并管理样式生命周期。

1. **`package.json`** 声明 `dsh.client`:
```json
{
  "name": "dsh-client-my-widget",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-slots"]
    }
  }
}
```

2. **`lib/index.js`** (Host 端):
```ts
import type { Context } from '@deepseek-ai/cordis'
export const name = 'dsh-client-my-widget'
export function apply(ctx: Context) { /* 供宿主扫描与配置管线注册 */ }
```

3. **`lib/client.js`** (Browser 端):
```tsx
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import React from 'react'

const ActionButton: React.FC = () => <button className="my-btn">Action</button>

export function apply(ctx: ClientContext) {
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'my-action-btn',
      order: 10,
    }, ActionButton)
  )
}
```

详细规范参见 [references/three-roles.md](./references/three-roles.md)。

---

### 场景 F：组合包打包与 Profile 安装

1. **编写 `cordis.patch.yml`**：
```yaml
- insert:
    - id: my-plugin-entry
      name: 'dsh-client-my-widget'
      config:
        enabled: true
```

2. **使用 CLI 安装进 Profile**：
```bash
# 安装进默认 Web profile 并激活
dsh plugin add ./path/to/my-plugin

# 验证配置树解析无误
dsh --profile web --dump-config
```

详细规范参见 [references/packaging.md](./references/packaging.md) 与 [references/workspace-package.md](./references/workspace-package.md)。

---

## 技术参考文档索引

- [references/services.md](./references/services.md)：核心服务大动脉与依赖注入
- [references/config.md](./references/config.md)：Schemastery 校验与补丁全量替换规约
- [references/events.md](./references/events.md)：五大事件派发模式与核心事件清单
- [references/tools.md](./references/tools.md)：ToolRuntime、单调守卫、PTC 模式与多模态输出
- [references/llm-adapter.md](./references/llm-adapter.md)：LLM 适配器接入与流式协议
- [references/three-roles.md](./references/three-roles.md)：Browser/Host/Worker 三角色与双面 UI 插件
- [references/packaging.md](./references/packaging.md)：Bundle 打包与 Profile 安装工作流
- [references/workspace-package.md](./references/workspace-package.md)：Monorepo 工作区多包联调与实时 HMR
- [references/plugin-anatomy.md](./references/plugin-anatomy.md)：插件解剖学与生命周期
- [references/context-api.md](./references/context-api.md)：Context 上下文树与作用域隔离
- [references/seams.md](./references/seams.md)：八大切面架构映射与依赖倒置
- [references/plugin-forms.md](./references/plugin-forms.md)：设置表单与配置持久化
