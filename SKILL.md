---
name: dsh-plugin-dev
description: 开发 DeepSeek Harness (DSH) 插件的标准与权威参考：编写/修改/审查/调试 DSH/Cordis 插件、核心服务、事件系统、插件配置、模型工具、LLM 适配器、双面 UI 插件、三角色拆分、打包安装、workspace 多包工程、cordis.patch.yml 组合时使用；提到 DSH 插件、Cordis、plugin、服务、事件、工具、适配器即触发。 The authoritative standard for developing DeepSeek Harness (DSH) plugins — create, modify, review or debug DSH/Cordis plugins, services, events, config, model tools, LLM adapters, dual-face client-ui plugins, three-role architecture, packaging, and cordis.patch.yml composition.
---

# DSH 插件开发权威指南

DeepSeek Harness (DSH) 是基于 Cordis 微内核构建的可拔插 Agent Harness。在 DSH 中，**一切皆为插件 (Everything is a Plugin)**：会话日志、工具注册表、提示词生成器、LLM 适配器、UI 界面以及执行循环本身均为可替换的插件。基线版本 DSH 0.2.0-rc.2 / Cordis 4.0.4 / Schemastery 3.18.4。

本文档是开发、审查、调试 DSH 插件的核心速查与操作指南。深入的类型定义与架构机理参见 `references/` 目录下的专项技术文档。

---

## 核心架构原则速查

1. **零特权内核**：不存在固化的特权逻辑。所有能力通过向共享 `Context` 挂载服务或监听事件提供。
2. **核心服务大动脉 (The Core Spine)**：
   - `ctx.sessions` (`@deepseek-ai/dsh-session`)：仅追加事件日志与唯一真源（注意为复数）。
   - `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`)：系统提示词组装与工具 Schema 生成。
   - `ctx.tools` (`@deepseek-ai/dsh-tools`)：工具注册、单调守卫、PTC 投影与多模态渲染。
   - `ctx.agents` (`@deepseek-ai/dsh-agent`)：活跃 Agent 注册表与发起者作用域（注意为复数）。
   - `ctx.agentLoop` (`@deepseek-ai/dsh-agent-loop`)：**bundle 角色**——唯一的具体循环插件；扩展包依赖 dsh-agent 的事件与服务，**绝不直接依赖此包**。
   - `ctx.llm` (`@deepseek-ai/dsh-llm`)：**seam 角色**——提供方无关消息流式协议与适配器接入（实现：llm-deepseek / llm-pi-ai / llm-replay）。
   - `ctx.settings` (`@deepseek-ai/dsh-settings`) + `ctx.configEditor` (`@deepseek-ai/dsh-config-editor`)：配置表单投影、校验与补丁持久化。
3. **五大事件派发模式**（每个事件必须明确模式，只能由对应方法派发）：
   - `emit`: 同步通知，无返回值；
   - `waterfall`: **同步环绕中间件**，监听器接收 `(...args, next)`，调 `next()` 执行下游、不调即短路，返回最终加工值（不是简单传值链）；
   - `parallel`: `Promise.all` 并发等待全部 settle，无返回值；
   - `serial`: 按注册顺序依次 `await`，返回结果数组；
   - `bail`: 按序观察直到某监听器返回 bail 值，返回该值。
4. **配置落点与全量替换规约**：
   - **废弃警告**：`$DSH_HOME/settings.yaml` 已完全废弃，修改无效。
   - **三层落点（+ overlay）**：组合包自带 patch → `$DSH_HOME/profiles/<profile>/cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 每个 `--patch` overlay（按 argv 顺序）。后层按行胜出。
   - **全量替换 (Wholesale Replacement)**：对条目的 `config` 覆盖是整块替换，不做深合并。修改既有条目必须写全全部保留字段。
5. **可逆副作用 (Reversible Effects)**：所有通过 `ctx.on()`、`ctx.effect()`、`ctx.tools.register()` 注册的资源受所属上下文（fiber）生命周期管理，插件卸载时自动回滚；清理顺序为逆序。

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
  // 轮次/步骤边界是持久会话事件（turn/start 等），经 session/event 广播
  ctx.on('session/event', ({ type, data }) => {
    if (type === 'turn/start' && config.verbose) {
      console.log('Turn started:', data.sessionId)
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
  // 1. 注册工具（注册借用只读定义，注册后勿改 schema）
  ctx.tools.register(defineTool({
    name: 'calculate',
    description: 'Perform a basic mathematical calculation.',
    parameters: {
      expression: { type: 'string', required: true, description: 'Mathematical expression to evaluate' },
    },
    output: {
      schema: { type: 'number' },
      render: (_args, value) => [{ type: 'text', text: `Result: ${value}` }],
    },
    async execute(args) {
      return Number(eval(args.expression)) // execute 返回 output.schema 声明的规范值
    },
  }))

  // 2. 单调守卫：任何守卫返回 string 即拒绝；guard 无 allow 结果，后注册者不能撤销
  ctx.tools.guard((call) => {
    if (call.toolName === 'calculate' && call.args.expression.includes('process')) {
      return 'Security violation: Process access is forbidden in calculate.'
    }
  })
}
```

执行流水线顺序：`tools/pre-execute` → 单调 guard → `tools/execute` → `projectContent` → `tools/post-execute` → `finalizeContent` → `tools/result`。`schemas()` 白名单只含 name/description/parameters，其余字段绝不泄漏到模型请求。详细规范参见 [references/tools.md](./references/tools.md)。

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
    // super(ctx, name) 后服务立即注册到 ctx.<name>，随所属 fiber 自动移除
    super(ctx, 'kvStorage', true)
  }

  public get(key: string) { return this.store.get(key) }
  public set(key: string, val: any) { this.store.set(key, val) }

  protected override start() { /* 所有依赖就绪后调用 */ }
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
    // 1. 发起网络流式调用（适配器绝不自行重试；遵守 options.signal）
    // 2. 分片协议：block-start → delta → block-end → usage → finish
    //    每个 block-start 必须有配对 block-end；index 从 0 递增
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Hello from custom adapter!' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello from custom adapter!' } }

    // 3. usage 必须在 finish 之前，且只发一次
    yield {
      type: 'usage',
      usage: {
        inputTokens: 100,   // 仅未命中缓存的输入
        cacheRead: 50,      // 命中缓存单独报告
        outputTokens: 20,   // 已含 reasoningTokens
      },
    }

    // 4. finish 必须是最后一个分片
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'my-custom-llm'
export const inject = ['llm']

export function apply(ctx: Context) {
  // 注意参数顺序：第一个参数是提供方路由列表，第二个是适配器实例
  ctx.llm.registerAdapter(['my-provider'], new MyCustomLlmAdapter())
}
```

详细规范参见 [references/llm-adapter.md](./references/llm-adapter.md)。

---

### 场景 E：开发 Web Client-UI 双面插件

前端界面必须遵循双面架构（Dual-Face），通过 Slots 注入组件，由打包器编译并管理样式生命周期。浏览器半侧**只挂在说明符恰为裸包名的那一行上**（子路径行永不带半侧）。

1. **`package.json`** 声明 `dsh.client`:
```json
{
  "name": "dsh-client-my-widget",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings"] }
  }
}
```

2. **`lib/index.js`** (Host 端):
```ts
import type { Context } from '@deepseek-ai/cordis'
export const name = 'dsh-client-my-widget'
export function apply(ctx: Context) { /* 供宿主扫描与配置管线注册 */ }
```

3. **`lib/client.js`** (Browser 端，lazy-CJS factory):
```tsx
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import React from 'react'

const ActionButton: React.FC = () => <button className="my-btn">Action</button>

export function apply(ctx: ClientContext) {
  // conversation.input.* 是官方 slot 树中的输入区注入点
  ctx.slots.inject('conversation.input.actions', () =>
    ctx.slots.register({
      name: 'conversation.input.actions',
      id: 'my-action-btn',
      order: 10,
    }, ActionButton)
  )
}
```

组件绝不收到 `ctx`；跨包 UI 一律 `inject + register`，严禁 import 他包组件运行时。详细规范参见 [references/three-roles.md](./references/three-roles.md)。

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
# 安装进默认 web profile 并激活
dsh plugin add ./path/to/my-plugin

# 验证配置树解析无误
dsh --profile web --dump-config
```

3. **生效层顺序**：组合包 patch（按 bundles 列表序）→ profile 自身 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlay。后层按行胜出、config 整块替换。git 安装拉取源码：需自包含 prepare 脚本 + profile 的 pnpm-workspace.yaml `allowBuilds` 授权。详细规范参见 [references/packaging.md](./references/packaging.md)。

4. **开发辅助脚本（零依赖）**：
   - `node scripts/scaffold_plugin.mjs <dir> [--client]`：生成合规 bundle 骨架（package.json + cordis.patch.yml + index.js，`--client` 追加双面入口）。
   - `node scripts/validate_plugin.mjs <dir>`：离线校验 package.json 必填字段、`dsh.bundle` 声明、patch 存在性与入口文件。

---

## 技术参考文档索引

- [references/plugin-anatomy.md](./references/plugin-anatomy.md)：插件解剖学——三种形态、Context API、作用域、生命周期与设置表单（深模块，含原 seams/context-api/plugin-forms 内容）
- [references/services.md](./references/services.md)：核心服务矩阵（core/seam/bundle 角色）与依赖注入
- [references/config.md](./references/config.md)：Schemastery 校验、三层补丁落点与全量替换规约
- [references/events.md](./references/events.md)：五大派发模式（waterfall=环绕中间件）与官方事件清单
- [references/tools.md](./references/tools.md)：执行流水线、单调守卫、PTC 模式与 UI 展示边界
- [references/llm-adapter.md](./references/llm-adapter.md)：LLM 适配器注册、StreamChunk 协议与错误契约
- [references/three-roles.md](./references/three-roles.md)：三角色架构、Slots 层级树、IPC 与沙箱
- [references/packaging.md](./references/packaging.md)：Bundle/Profile 打包、层顺序、工作区联调（深模块，含原 workspace-package 内容）
