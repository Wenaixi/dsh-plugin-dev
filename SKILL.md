---
name: dsh-plugin-dev
description: 开发 DeepSeek Harness (DSH 0.2.0-rc.2) 插件的标准与权威参考：编写、修改、审查、调试 DSH / Cordis 插件、核心大动脉服务总线、Cordis 五大事件系统、全量替换配置补丁、ToolRuntime 16 阶段流水线与单调守卫、LLM 适配器 Seam、Dual-Face 浏览器双面 UI 插件与 Slots 插槽、Agent Teams 多智能体团队编排、Schedule 挂钟定时任务、三角色沙箱架构、组合包打包与安装时使用；提到 DSH 插件、Cordis、plugin、服务、事件、工具、适配器、双面插件即触发。 The authoritative standard for developing DeepSeek Harness (DSH) plugins — create, modify, review or debug DSH/Cordis plugins, services, events, config patches, tool execution pipelines, LLM adapters, dual-face client-ui plugins, Agent Teams, Schedule, three-role architecture, and bundle packaging.
---

# dsh-plugin-dev

开发 DeepSeek Harness (DSH 0.2.0-rc.2) 插件的标准与权威参考 Skill。

---

## 一、核心原则与架构真相 (Architectural Invariants)

1. **微内核设计 (Zero-Privilege Microkernel)**：DSH 没有特权核心，所有能力均以 Cordis 插件形式装配于共享 `Context`。
2. **核心大动脉服务单复数绝对铁律 (The Core Spine)**：
   - `ctx.sessions`（**复数!** `@deepseek-ai/dsh-session`）：仅追加 SessionEvent 日志与会话状态唯一真源；
   - `ctx.agents`（**复数!** `@deepseek-ai/dsh-agent`）：活动 Agent 实例句柄注册表；
   - `ctx.agentTeams`（**复数!** `@deepseek-ai/dsh-experimental-agent-team`）：多 Agent 团队编排大动脉；
   - `ctx.tools`（**复数!** `@deepseek-ai/dsh-tools`）：工具注册、单调守卫与执行运行时；
   - `ctx.settings`（**复数!** `@deepseek-ai/dsh-settings`）：动态表单视图投影；
   - `ctx.clientModules`（**复数!** `@deepseek-ai/dsh-client-modules`）：双面插件模块图与 HMR（Browser 侧为 `ctx.modules`）；
   - `ctx.systemPrompt`（**单数!** `@deepseek-ai/dsh-system-prompt`）：系统提示词组装与工具 Schema 生成；
   - `ctx.configEditor`（**单数!** `@deepseek-ai/dsh-config-editor`）：文件锁与 HMR 下的补丁持久化；
   - `ctx.schedule`（**单数!** `@deepseek-ai/dsh-schedule`）：宿主持久化挂钟提醒与调度；
   - `ctx.planMode`（**单数!** `@deepseek-ai/dsh-plan-mode`）：计划模式软性控制器；
   - `ctx.workspaceRegistry`（**单数!** `@deepseek-ai/dsh-workspace`）：工作区实体注册表；
   - `ctx.llm`（**单数 Seam!** `@deepseek-ai/dsh-llm`）：提供方无关流式协议；
   - `ctx.agentLoop`（**Bundle!** `@deepseek-ai/dsh-agent-loop`）：唯一具体循环包（外部插件绝不直接依赖此包）；
   - `@deepseek-ai/dsh-scope`：**纯函数库**（`createScope`/`scopeOf`），**不挂载任何服务**。
3. **Cordis 五大事件派发模式**：
   - `emit`：同步顺序广播，返回 `void`；
   - `waterfall`：**同步环绕中间件**（监听器接收 `(...args, next)`，调 `next()` 驱动下游，不调即短路，可整体替换最终返回值，**绝非普通传值链**）；
   - `parallel`：`Promise.allSettled` 并发等待**全部 settle**，返回 `Promise<void>`（**绝非结果数组**），失败项汇总抛出 `AggregateError`；
   - `serial`：依次 `await` 直到首个 bail 值（非 null/false/undefined），返回该 bail 值（**绝非结果数组**）；
   - `bail`：同步调用直到首个 bail 值，返回该 bail 值。
4. **配置补丁四层生效与全量替换语义**：
   - 生效顺序：bundles 自带 patch -> profile patch -> 用户全局 patch -> CLI `--patch` overlays（后层胜出）；
   - 补丁中的 `config` 采用**全量替换，绝不进行深合并 (Wholesale replacement, not deep-merged)**；
   - **绝对严禁教导用户修改 `settings.yaml`**（已彻底废弃，启动时自动重命名为 `settings.yaml.imported`）。
5. **官方严格 16 阶段工具执行流水线**：
   `tool/call` 记录 -> `presentCall` -> `pre-execute` -> **`approval` (serviceAsk 审批裁决)** -> **单调 guard (终极一票否决权)** -> `execute` -> FS Gate -> 工具自有事件 -> **`projectContent` (denied 依然触发)** -> `post-execute` -> 规范化 -> `finalizeContent` -> `tools/result` (同步) -> `tool/result` (持久化) -> `presentResult`。

---

## 二、场景决策与开发导引矩阵

| 场景 | 目标需求 | 推荐形态与核心服务 | 关键参考文档 |
| --- | --- | --- | --- |
| **A** | 轻量生命周期、事件监听、日志记录 | 函数插件：导出 `apply(ctx)`，使用 `ctx.effect` 管理可逆副作用 | [plugin-anatomy.md](./references/plugin-anatomy.md) |
| **B** | 面向模型暴露能力、安全拦截、参数校验 | 工具插件：`defineTool`，`inject: ['tools']`，配合单调 `guard` | [tools.md](./references/tools.md) |
| **C** | 跨插件业务共享、领域逻辑封装 | 服务插件：继承 `Service` 类，指定挂载属性名，`[Service.tracker]()` | [services.md](./references/services.md) |
| **D** | 接入第三方大模型厂商 API | LLM 适配器：继承 `LlmAdapter`，实现 `stream()`，注册至 `ctx.llm` | [llm-adapter.md](./references/llm-adapter.md) |
| **E** | 浏览器 UI 扩展、卡片定制、设置页面板 | 双面插件 (Dual-Face)：`lib/index.js` + `lib/client.js`，`ctx.slots` | [three-roles.md](./references/three-roles.md) |
| **F** | 打包发布、Profile 组合、依赖规整 | 组合包 (Bundle)：配置 `dsh.bundle`，携带 `cordis.patch.yml` | [packaging.md](./references/packaging.md) |
| **G** | 定时提醒、挂钟计划任务调度 | 定时调度系统：消费 `ctx.schedule`，注册 schedule 系列工具 | [services.md](./references/services.md) |
| **H** | 多智能体协同、分布式团队、共享任务看板 | Agent Teams 架构：消费 `ctx.agentTeams`，使用 agent_team 系列工具 | [services.md](./references/services.md) |

---

## 三、快速开始与代码范例

### 场景 A：轻量生命周期插件
```js
export const name = 'my-lifecycle-plugin'

export function apply(ctx) {
  ctx.logger('lifecycle').info('插件已加载')

  // 使用 ctx.effect 管理自动可逆生命周期
  ctx.effect(() => {
    const timer = setInterval(() => {
      ctx.logger('lifecycle').debug('心跳检测')
    }, 30000)
    return () => clearInterval(timer)
  })
}
```

### 场景 B：面向模型的结构化工具插件
```js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']

export function apply(ctx) {
  // 1. 注册模型工具
  ctx.tools.register(
    defineTool({
      name: 'get_system_time',
      description: '获取宿主当前系统时间戳与时区信息',
      parameters: { type: 'object', properties: {} },
      output: {
        type: 'object',
        properties: { timestamp: { type: 'number' }, iso: { type: 'string' } }
      },
      async execute(_args, exec) {
        if (exec.signal.aborted) throw new Error('执行已被取消')
        const now = new Date()
        return { timestamp: now.getTime(), iso: now.toISOString() }
      }
    })
  )

  // 2. 注册单调安全守卫（返回 string 立即阻断，不可逆转）
  ctx.tools.guard((exec) => {
    if (exec.toolName === 'dangerous_tool') {
      return '安全策略阻断：当前环境禁止调用 dangerous_tool'
    }
  })
}
```

### 场景 E：Web 双面 UI 插件 (Dual-Face)
`package.json`：
```json
{
  "name": "dsh-custom-ui",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "bundle": { "id": "custom-ui" },
    "client": { "platform": "web", "module": "./lib/client.js" }
  }
}
```
Browser 侧 `lib/client.js`：
```jsx
import React from 'react'

export const name = 'dsh-custom-ui/client'

// 客户端组件严禁直接接收 ctx
function CustomWidget() {
  return <div className="p-4 bg-card rounded shadow">自定义状态面板</div>
}

export function apply(ctx) {
  // 通过 slots 统一注入插槽
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ id: 'custom-panel', title: '扩展面板' }, CustomWidget)
  )
}
```

---

## 四、生产运维与防坑宝典

### 1. `--dump-config` 假阳性避坑
- `dsh --dump-config` 通过仅代表 YAML 配置语法合规，**绝不证明插件能正常启动（不导入模块、不校验 peerDependencies）**；
- 真实启动验证必须通过 3 步：
  ```bash
  # 1. 检查端口
  netstat -ano | findstr "127.0.0.1:3080" | findstr LISTENING
  # 2. 检查启动日志带 token 链接并请求获取 303 + Set-Cookie
  # 3. 带 Cookie 请求根路径必须返回 200 text/html
  ```

### 2. 依赖安装与 OOM 防御
- 规避 `pnpm` 处理 250+ 子包时的内存溢出崩溃，推荐标准命令：
  ```bash
  cd ~/.dsh/profiles/web
  npm install --legacy-peer-deps --no-audit --no-fund
  ```

### 3. 版本兼容性强制豁免
- 第三方包尚未标记适配新版 DSH 时执行：
  ```bash
  dsh plugin --profile <profile> allow-version <pkg>@<ver> --dsh-version <exact> --accept-risk
  ```

---

## 五、工作区辅助脚本

- **多工程合规性批量校验**：
  ```bash
  node scripts/validate_plugin.mjs examples/hello-plugin examples/service-provider examples/configurable-plugin examples/greet-tool examples/event-interceptor
  ```
- **新建标准插件工程骨架**：
  ```bash
  node scripts/scaffold_plugin.mjs my-new-plugin [--dual-face]
  ```
