# DSH 插件开发技术参考目录

本目录包含 DeepSeek Harness (DSH 0.2.0-rc.2) 插件开发的权威规范、API 契约与底层设计文档。全部内容依据官方文档站（reference/subsystems 与 reference/cordis-api 共 44 页）逐页核对后重写，凡与旧版记忆冲突处一律以官方原文为准。

## 文档架构分类

### 一、微内核与服务架构 (Microkernel & Spine)
- [plugin-anatomy.md](./plugin-anatomy.md)：插件解剖学深模块——三种插件形态、Context Proxy 与 `extend`/`isolate`/`intercept`、`ctx.plugin`/`ctx.inject`/`ctx.effect` 可逆副作用、五大派发模式、core/seam/bundle/service 四角色矩阵、`@deepseek-ai/dsh-scope` 作用域库、依赖倒置律、设置表单与配置编辑器。
- [services.md](./services.md)：官方核心服务矩阵（`ctx.sessions`、`ctx.systemPrompt`、`ctx.tools`、`ctx.agents`、`ctx.settings`、`ctx.configEditor` 为 core；`ctx.llm`、`ctx.subprocess`、`ctx.sandbox` 等为 seam；`ctx.agentLoop` 为 bundle）、`inject` 依赖声明、Service 生命周期与命名规则。

### 二、配置系统与补丁机制 (Configuration & Patches)
- [config.md](./config.md)：Schemastery 强类型 Schema、三层 `cordis.patch.yml` 落点（bundle → profile → `$DSH_HOME`）+ `--patch` overlay、生效层顺序、全量替换（Wholesale Replacement）语义与 `settings.yaml` 废弃说明。

### 三、事件总线与执行管线 (Events & Execution)
- [events.md](./events.md)：五大派发模式权威表格与 waterfall 环绕中间件语义（`next()` 短路/整体替换）、按子系统的官方事件清单（agent/*、tools/*、session/*、llm/*、system-prompt/*、internal/*、loader/*）。
- [tools.md](./tools.md)：`ToolDefinition` 字段契约、固定执行流水线（pre-execute → 单调 guard → execute → projectContent → post-execute → finalizeContent → result）、`schemas()` 白名单、PTC 模式与 `ToolCallError`、展示词汇纯函数与 Web Client 边界。
- [llm-adapter.md](./llm-adapter.md)：`LlmAdapter` 契约、`ctx.llm.registerAdapter(providers, adapter)` 签名与路由原子性、`StreamChunk` 分片协议、`TokenUsage` 互斥计量、两条错误路径、`ReplayEnvelope` 同实例规则。

### 四、打包、工作区与多端角色 (Packaging & Multi-Role)
- [packaging.md](./packaging.md)：Bundle 与 Profile 互斥清单、`package.json` 不变式、生效层顺序、git 安装的 prepare 与 allowBuilds 授权、`dsh plugin` CLI、pnpm workspace 多包联调与开发态 HMR。
- [three-roles.md](./three-roles.md)：Browser / Host / Worker 三角色边界、双面插件规范、Slots 四基数与三作用域及官方 slot 层级树、Typert Remote IPC、`ctx.subprocess` 与 `ctx.sandbox`（`SandboxMode` 只管文件效果）。

## 阅读顺序建议

1. 先读 `SKILL.md` 的场景速查获得可运行模板；
2. 再按 `plugin-anatomy.md` → `services.md` → `events.md` 建立 Cordis 心智模型；
3. 需要写工具 / 适配器时读 `tools.md` 与 `llm-adapter.md`；
4. 需要交付与安装时读 `packaging.md`；
5. 需要写界面时读 `three-roles.md`。
