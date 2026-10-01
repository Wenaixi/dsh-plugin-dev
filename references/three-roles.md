# 三角色架构模型与 Client-UI 插件开发标准

DeepSeek Harness (DSH 0.2.0-rc.2) 采用清晰的物理分层与进程隔离架构。系统由三大物理角色构成：**Browser 界面端**、**Host 核心宿主** 与 **Worker 沙箱隔离区**。

同时，DSH 遵循“Everything is a Plugin”哲学，前端 Web GUI 同样是运行在浏览器中的 Cordis 运行时，所有含界面的插件均采用“双面插件”（Dual-Face Architecture）规范。

```
┌────────────────────────────────────────────────────────┐
│               Browser 角色 (Web GUI 前端)               │
│  - React 18 渲染层 + 浏览器端 Cordis 微内核              │
│  - SlotRegistry 插槽系统 + ctx.connection 通信网络      │
└───────────────────────────▲────────────────────────────┘
                            │
              HTTP POST (一元 RPC) + WebSocket (/api/remote.mux)
                            │
┌───────────────────────────▼────────────────────────────┐
│              Host 角色 (服务端 Node.js 宿主)             │
│  - 核心 Cordis 运行时 (ctx.sessions / ctx.tools /       │
│    ctx.agents / ctx.llm / ctx.settings 等核心大动脉)    │
│  - WebServer、静态 Bundle Combo 服务与 HMR SSE 推送     │
└───────────────────────────▲────────────────────────────┘
                            │
           专用控制管道 (SUBPROCESS_CONTROL_FD / stdio IPC)
           Windows Job Object / Linux cgroup 沙箱限制
                            │
┌───────────────────────────▼────────────────────────────┐
│              Worker 角色 (工作进程 / 沙箱隔离区)          │
│  - 独立运行的 Subprocess / Native Runner               │
│  - PowerShell / Bash / Python / 重计算任务沙箱          │
└────────────────────────────────────────────────────────┘
```

## 三大角色的物理边界与职责

| 角色 | 运行环境 | 核心职责 | 权限与安全边界 |
| --- | --- | --- | --- |
| **Browser** | Chrome / Edge 等浏览器或桌面内嵌 Webview | 用户界面渲染、流式 Markdown 显示、用户输入捕获、本地快捷键与语言切换 | 零本地文件系统与系统调用权限，所有交互受浏览器安全沙箱与 Host API 约束 |
| **Host** | 操作系统常驻 Node.js 进程 | 运行核心 Cordis 总线（`ctx.sessions`、`ctx.tools`、`ctx.agents`、`ctx.llm` 等）、调度工具执行、持久化存储、Web 服务器 | 具备完整的服务端宿主权限，受操作系统用户权限与凭据保护策略约束 |
| **Worker** | 隔离子进程（Native Runner） | 执行高风险外部命令（PowerShell、Bash）、计算密集型数据处理、脚本沙箱 | 受 Windows Job Object / 隔离 Token 或 Linux cgroup 限制，崩溃不影响 Host |

## 前端插件的双面架构 (Dual-Face Architecture)

所有涉及 Web UI 界面的插件必须同时提供 Node 宿主半侧与 Browser 界面半侧：

- **Node 宿主半侧 (`lib/index.js`)**：导出 `apply(ctx: Context): void`。即使该插件无服务端逻辑，空实现的 `apply()` 也必须存在，以确保插件能正常注册进宿主 Loader 条目树。
- **Browser 界面半侧 (`lib/client.js`)**：导出浏览器端 `apply(ctx: ClientContext): void`。在浏览器加载该模块时物化并运行。

### package.json 声明规范

```json
{
  "name": "@my-scope/dsh-client-ui-example",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    }
  },
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-connection"
      ]
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.2.0-rc.1",
    "react": "^18.2.0"
  }
}
```

## 浏览器端插件加载、Slot 插槽与样式管理

### 1. 启动图注入与 Combo 资源加载

- 服务端启动时，通过 HTML `<head>` 注入预装配的启动图 `window.__DSH_BOOT__`。
- 宿主提供 Combo 资源合并接口（`/plugins/??<pkg1>&<pkg2>&rev=<hash>`），将启用的客户端代码以惰性工厂函数（`window.__ModuleLoader__.load()`）形式交付浏览器。
- 仅当模块被显式 import 或依赖时才执行工厂函数（惰性物化），降低首屏内存占用。

### 2. SlotRegistry 插槽扩展规范

DSH Web GUI 禁止插件随意直接操作外部 DOM，所有组件注入必须通过 `@deepseek-ai/dsh-client-ui-slots` 提供的 `ctx.slots` 服务：

```tsx
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import React from 'react'

const MyFeatureChip: React.FC = () => {
  return <div className="my-feature-chip">Extra Action</div>
}

export function apply(ctx: ClientContext) {
  // 向 conversation.input.dock 插槽注入扩展组件
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'my-feature-chip',
        order: 50,
        inject: () => ({ /* 向组件注入的 hooks 依赖 */ }),
      },
      MyFeatureChip
    )
  )
}
```

#### 标准 Slot 插槽矩阵

| 插槽标识符 | 类型 | 说明与所在区域 |
| --- | --- | --- |
| `root` | keyed | 应用根挂载点（由 AppFrame 占据） |
| `sidebar.brand.mark` | single | 侧边栏品牌区域 |
| `sidebar.workspaces` | list | 侧边栏工作区列表区域 |
| `sidebar.settings` | single | 侧边栏底部设置入口 |
| `conversation.input.dock` | list | 对话输入框底部操作栏插槽 |
| `conversation.input.selector.context` | list | 输入框上方上下文标签区域 |
| `settings.general.item` | list | 通用设置面板中的配置行项 |
| `settings.plugins.tab` | list | 独立插件配置标签页 |

### 3. 样式管理与自动回收

- 组件样式由打包工具编译并内嵌。
- 插入 DOM 的 `<style>` 标签必须携带归属属性：`<style data-plugin="@my-scope/pkg-name">`。
- 当插件被禁用、卸载或由 HMR 热替换时，`removeOwnedStyles()` 会根据包名精准移除所有相关样式标签，避免样式污染和内存泄漏。

## 进程间通信 (IPC) 协议

### 1. Browser ↔ Host IPC
由 `@deepseek-ai/dsh-client-connection` 提供双通道网络：
- **HTTP POST（一元 RPC）**：地址为 `/api/*`，传输结构化 JSON-RPC 请求与响应。大型二进制载荷采用 multipart 分块，前端自动拼装为 `ArrayBuffer`。
- **WebSocket（多路复用通道）**：地址为 `/api/remote.mux`，承载长生命周期实时数据流：LLM 生成思考分片（`StreamChunk`）、会话日志增量推送、终端实时输出与环境事件广播。

### 2. Host ↔ Worker IPC
由 `@deepseek-ai/dsh-subprocess-local` 管理：
- **专属控制管道 (Control FD)**：除了标准 stdio，Host 与 Worker 之间建立独立管道 `SUBPROCESS_CONTROL_FD`，用于传递启动握手请求（`LaunchRequest`）、运行时中断命令（`TerminateRequest`）与退出结算状态。
- **输出流溢出保护 (Spill Buffer)**：当命令产生大量输出时，Worker 自动激活 `spillPath` 磁盘暂存机制，防止海量字符撑爆进程管道内存。
