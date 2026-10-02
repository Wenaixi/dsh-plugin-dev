# DSH 插件开发技术参考目录 (DSH 0.2.0-rc.2)

本目录包含 DeepSeek Harness (DSH 0.2.0-rc.2) 插件开发的官方权威规范、API 契约与底层架构指南。内容依据官方 44 页文档站与本地权威源码包（260+ 官方包）逐项对账建立。

---

## 核心架构分类与参考导引

### 一、微内核与服务架构 (Microkernel & Spine)
- **[services.md](./services.md)**：
  The Core Spine 核心大动脉服务矩阵（`ctx.sessions`、`ctx.systemPrompt`、`ctx.tools`、`ctx.agents`、`ctx.settings`、`ctx.configEditor`、`ctx.clientModules` 为 core；`ctx.schedule`、`ctx.agentTeams`、`ctx.llm` 为 seam；`ctx.agentLoop` 为 bundle）、0.2.0-rc.2 新增服务、Service 类定义与依赖注入规范。
- **[plugin-anatomy.md](./plugin-anatomy.md)**：
  插件解剖学——三种插件形态、Context Proxy 与 `extend`/`isolate`/`intercept`、`ctx.plugin`/`ctx.inject`/`ctx.effect` 可逆副作用、五大派发模式、四角色模型、`@deepseek-ai/dsh-scope` 作用域纯函数库、设置表单与配置持久化契约。

### 二、配置系统与补丁机制 (Configuration & Patches)
- **[config.md](./config.md)**：
  Schemastery 强类型配置规范、代码级四层补丁生效落点（bundles -> profile -> global -> `--patch` overlays）、全量替换（Wholesale Replacement）语义、`- insert:` 分组插入机制、`!!js` 动态表达式求值沙盒、`--dump-config` 假阳性避坑与三步真实启动验证、Web Profile 14 个 Bundles 清单与生成器目录规则。

### 三、事件总线与工具流水线 (Events & Tool Execution)
- **[events.md](./events.md)**：
  Cordis 五大派发模式源码解析（`emit` 同步广播、`waterfall` 同步环绕中间件与 `next()` 拦截、`parallel` 并发与 `AggregateError`、`serial` 串行短路与 bail 判定、`bail` 同步短路）、宿主运行事件族、60 个持久化会话事件体系（Persistence Catalog）、5 大表面事件族（`SurfaceEventType`）、`surfaceOp`（append / replace）与 `ignorable` 兼容性规范。
- **[tools.md](./tools.md)**：
  ToolRuntime 核心设计、官方严格 16 阶段工具执行流水线（`tool/call` -> `presentCall` -> `pre-execute` -> `approval` -> `monotonic guard` -> `execute` -> `FS Gate` -> 工具自有事件 -> `projectContent` -> `post-execute` -> 规范化 -> `finalizeContent` -> `tools/result` -> `tool/result` -> `presentResult`）、单调安全守卫法则、全量官方工具归属包对照表与 `defineTool` 编写规范。

### 四、设置窗口与插件管理中心 UI (Settings & Plugin Manager UI)
- **[settings-and-plugin-ui.md](./settings-and-plugin-ui.md)**：
  全局设置窗口 (Settings) 与插件管理中心 UI 深度开发指南——`settings.section` 插槽机制、源码级解密三大明星插件（终端输入、侧边卡片、壁纸引擎）的真实注入代码、导航图标 (Nav Glyph) 替换技法、React 设置面板的本地 vs 补丁持久化、以及左侧“插件”管理中心官方/已安装卡片呈现与配置开关联动。

### 五、三角色架构、跨端通信与双面 UI (Three Roles, IPC & UI)
- **[three-roles.md](./three-roles.md)**：
  三角色物理隔离（Browser 前端、Host 宿主、Worker 沙箱进程）、Typert Remote RPC API 网关契约（`@Remote` 与 `@RemoteScope` 约束、禁止解构/默认值、尾参协作式 signal、流式通道）、不存在 Client Runtime/HostFrame 红线警告、子进程生成原语（`ctx.subprocess.spawn` 与 `spawnTerminal`）、`SandboxMode`（仅限文件效果）与沙箱故障隔离。
- **[plugin-anatomy.md: 双面插件与 Slots](./plugin-anatomy.md#5-双面插件规范-dual-face-architecture)**：
  Dual-Face 架构、Host 侧 `ctx.clientModules` 与 Browser 侧 `ctx.modules`、Combo 静态资源路由（`/plugins/??...&rev=...`）、浏览器 Cordis 运行时惰性物化、HMR 热重载、Slots 插槽树层级、`ctx.slots.inject` 规范与组件绝不传 ctx 原则。

### 五、模型适配与打包分发 (LLM Adapters & Packaging)
- **[llm-adapter.md](./llm-adapter.md)**：
  `ctx.llm`（LlmRuntime Seam）抽象协议、`LlmAdapter` 继承与 `stream()` 实现、统一 `StreamChunk` 映射、不搞库级重试原则。
- **[packaging.md](./packaging.md)**：
  Bundle 与 Profile 互斥模型、`package.json` 的 `dsh.bundle` 声明、`npm install --legacy-peer-deps` 规避 OOM 实战、`allow-version` 风险豁免机制、多包 Monorepo 工作区联调。
