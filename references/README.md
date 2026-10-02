# DSH 插件开发权威技术参考目录 (DSH 0.2.0-rc.2)

> **⚠️ 核心定位声明**  
> **本目录是用于【辅助开发 DeepSeek Harness (DSH) 插件】的权威架构规范与知识库（Agent Skill 参考集）。**  
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 核心架构分类与参考指南导航

### 一、官方上游源码与官方文档核验指引 (Upstream & Docs)
- [official-upstream-and-docs.md](./official-upstream-and-docs.md)：
  官方一手资料权威索引——上游仓库 (`deepseek-ai/deepseek-harness`) 包清单与模块依赖图、本地已安装官方包的目录结构与类型声明速读法、官方文档站全部权威页面清单（中英双语入口）、事实核验三级证据强度与版本升级回溯流程。
  **任何架构结论与官方源码冲突时，一律以源码为准。**

### 二、微内核与服务架构 (Microkernel & Spine)
- **[cordis-context-internals.md](./cordis-context-internals.md)**：
  Cordis 微内核底层的三个隔离原语——`ctx.isolate(key)` 服务作用域物理隔离槽、`ctx.intercept(key, config)` 动态拦截代理、`Context.is(value)` 全局 Symbol 品牌跨 Realm 检验。
- **[services.md](./services.md)**：
  The Core Spine 核心大动脉服务单复数绝对铁律（`ctx.sessions`、`ctx.agents`、`ctx.agentTeams`、`ctx.tools` 为复数；`ctx.schedule`、`ctx.planMode`、`ctx.workspaceRegistry` 为单数；`ctx.llm` 为 Seam）、Service 类定义规范与依赖注入契约。
- **[plugin-anatomy.md](./plugin-anatomy.md)**：
  插件解剖学——三种插件形态、Context Proxy 与 `extend`/`isolate`/`intercept`、可逆副作用生命周期管理（`ctx.effect`）、五大派发模式、四角色模型、设置表单与配置持久化契约。

### 三、配置系统与补丁机制 (Configuration & Patches)
- **[config.md](./config.md)**：
  Schemastery 强类型配置规范、代码级四层补丁生效落点（bundles -> profile -> global -> `--patch` overlays）、全量替换（Wholesale Replacement）语义、`- insert:` 分组插入机制、`!!js` 动态表达式求值沙盒、`--dump-config` 假阳性避坑与三步真实启动验证。

### 四、事件总线与工具流水线 (Events & Tool Execution)
- **[events.md](./events.md)**：
  Cordis 五大派发模式源码剖析（`emit` 同步广播、`waterfall` 同步环绕中间件与 `next()` 拦截、`parallel` 并发与 `AggregateError`、`serial` 串行短路与 bail 判定、`bail` 同步短路）、宿主运行事件族、60 个 Persistence Catalog 事件、5 类 SurfaceEventType 与 `ignorable` 契约。
- **[tools.md](./tools.md)**：
  ToolRuntime 架构、官方严格 16 阶段流水线（pre-execute -> approval -> monotonic guard -> execute -> projectContent -> post-execute -> finalizeContent -> result）、单调安全守卫法则、全量官方工具归属包对照表与 `defineTool` 编写规范。

### 五、前端双面 UI 插件与全量插槽体系 (Client UI & Slots)
- **[settings-and-plugin-ui.md](./settings-and-plugin-ui.md)**：
  全局设置窗口 (Settings) 与插件管理中心 UI 深度指南——`settings.section` 与 `plugins.bundle.config` 插槽机制、源码级解密三大明星插件（终端输入、侧边卡片、壁纸引擎）的真实注入代码、导航图标 (Nav Glyph) 替换技法、React 设置面板的本地 vs 补丁持久化、左侧“插件”管理中心卡片呈现、**`readPluginMeta` 的 exports 白名单契约（卡片空白根因与修法）**、图标 256 KiB 上限与路径约束、**改完必跑的两道验证（`npm pack --dry-run` + 直接调 `readPluginMeta`）**与开发决策树。
- **[web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)**：
  Web GUI 全量插槽树实战——右侧边栏（`sidebar.right.pane.tab`）、会话顶部工具栏（`conversation.session.header.utilities`）、输入框挂件（`conversation.input.right`）、消息流拦截（`conversation.chat.node`）、全局外壳（`shell.*`）；官方主题 CSS 变量（415 个 `--dsw-*`，含四组常见误写对照）；样式安全注入与 HMR 回收铁律；**官方 primitives 组件族优先策略**（SegmentedControl / Switch / StateDot / Tag / Button）与「客户端产物单一来源」纪律；多语言国际化（i18n: `ctx.locale`）。

### 六、跨端通信与三角色物理隔离 (IPC & Remote)
- **[remote-rpc-guide.md](./remote-rpc-guide.md)**：
  Typert Remote RPC 跨端通信开发指南——Browser 前端 ↔ Host Node.js 服务端通信规范、方法签名四大硬约束（禁止解构、禁止默认值、禁止 rest、末位 signal 协作取消）、一元 RPC 与流式 mux 通道、端到端可运行范本。
- **[three-roles.md](./three-roles.md)**：
  Browser / Host / Worker 三角色物理隔离模型、子进程生成原语（`ctx.subprocess.spawn` 与 `spawnTerminal` 零 Shell 解释）、`SandboxMode`（仅限文件系统效果）与沙箱隔离。

### 七、模型适配、MCP 外部工具桥接与打包分发 (LLM, MCP & Packaging)
- **[mcp-and-tools-bridge.md](./mcp-and-tools-bridge.md)**：
  DSH MCP 客户端集成与外部工具桥接指南——`@deepseek-ai/dsh-mcp-client` 协议桥、Streamable-HTTP 与 StdIO 双传输协议、`mcp__<serverName>__<rawName>` 命名空间强规范、生产环境启动容错（`failOnStartupError`）与单调守卫权限拦截。
- **[llm-adapter.md](./llm-adapter.md)**：
  `ctx.llm`（LlmRuntime Seam）抽象协议、`LlmAdapter` 继承与 `stream()` 实现、7 种 `StreamChunk` 封闭判别联合完整定义代码。
- **[packaging.md](./packaging.md)**：
  Bundle 与 Profile 互斥模型、`package.json` 规约、npm `--legacy-peer-deps` 规避 OOM 实战、`allow-version` 风险豁免机制、多包 Monorepo 工作区联调。

### 八、系统提示词注入、会话事件流与状态投影 (Prompt & Projections)
- **[system-prompt-and-projections.md](./system-prompt-and-projections.md)**：
  系统提示词动态编排与会话状态投影——`ctx.systemPrompt` 有序段落（Sections）收集与 `system-prompt/assemble` 环绕中间件、会话事件流（SessionEvent）仅追加哲学、`ctx.sessionProjections` 事件溯源与纯函数折叠（Pure Folds）状态机、以及 `workspace-changes` 工作区代码变更自动化审计。

### 九、本地联调与故障排查 (Debugging & Troubleshooting)
- **[debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)**：
  本地开发调试三大极速回路（`--patch` 覆盖、本地路径添加、临时沙盒）、双面插件前端排查技巧（`__DSH_BOOT__`、`__ModuleLoader__`、Combo 404）、Top 9 高频故障排查速查表（PENDING 挂起、配置冲掉、组件传 ctx 报错、安装解析到旧版本等）、安装失败排障六步路径、**免启动反证法（直接调宿主公开函数问真值，附 Windows `pathToFileURL` 坑与可跑对照探针、`npm pack --dry-run` 打包清单核对）**、插件管理器目录结构与黑匣子日志分析。
- **[install-resolution-traps.md](./install-resolution-traps.md)**：
  插件安装版本解析三大陷阱的权威排查手册——pnpm 发布冷却期 `minimumReleaseAge: 1440`（24 小时，只装发布满 24h 的版本，新版本被排除后解析回退到最老合格版本）、semver 预发布排序（`-tag.N` 后缀被范围解析默认排除，`maxSatisfying(vers,'*')` 返回旧正式版）、DSH 兼容性闸门两段式预检与后检语义与精确版本豁免机制、profile 目录结构与 `minimumReleaseAge: 0` 配置落点、desktop profile 的 Electron 独占守卫。附可复现的参数实验、时间指纹判定法与排障决策表；并覆盖**全新 profile 首次安装的三大坑**：`dsh plugin add` 不写 `dsh.profile.bundles` 需手动补、原生依赖的 `ERR_PNPM_IGNORED_BUILDS` 需在 `pnpm-workspace.yaml` 里加 `allowBuilds` 放行、以及从零到可跑的五步落地顺序。

### 十、多模态附件、人机交互与最终交付物呈递 (Multimodal & Deliverables)
- **[multimodal-and-deliverables.md](./multimodal-and-deliverables.md)**：
  多模态与人机交互权威指南——最终交付物卡片 (`present` 工具与前端 Deliverables 原生打开/预览)、人机协同结构化提问 (`ask_user_question` 与 `ctx.userQuestions` 挂起/恢复)、多模态图像附件规范化存储 (`dsh-attachment-local`)、以及长上下文工具结果智能剪枝 (`compaction-tool-result-pruner`)。

### 十一、Webhook 外部集成、无头模式与长工作流 (Webhook, Headless & Workflows)
- **[webhook-headless-and-workflows.md](./webhook-headless-and-workflows.md)**：
  企业级自动化与无头运行权威指南——Webhook 外部触发与会话拉起 (`ctx.webhookRuntime`、`WebhookRule`、GitHub 集成)、Headless 纯无头命令行与 CI/CD 自动化批处理 (`dsh-headless`、`--json` ndjson 事件流)、以及 PTC 长任务工作流沙箱编排 (`dsh-workflow-ptc`、`WorkerLimits`)。

### 十二、官方内置增强插件与实用中间件 (Built-in Enhancements & Middleware)
- **[builtin-enhancements-and-middleware.md](./builtin-enhancements-and-middleware.md)**：
  高阶中间件与死循环防护全景指南——工具调用死循环检测与劝告性上下文注入 (`repeat-tool-reminder`)、动态时钟与物理挂钟环境事实注入 (`time-context`)、定稿消息用户点赞点踩反馈回流 (`message-feedback`)、以及包级架构不变量断言守护网 (`dsh-invariants`)。

### 十三、领域数据存储、持续伪终端与检查点 (Storage, Terminal & Checkpoints)
- **[storage-terminals-and-checkpoints.md](./storage-terminals-and-checkpoints.md)**：
  服务端状态存储与交互式终端权威指南——领域数据存储 (`ctx.storage.domain` Zod 强校验命名空间表、拒绝乱写文件的三层存储分层)、持续交互式伪终端 (`ctx.terminal` 长任务 PTY 会话、输入流发送与 POSIX 信号打断)、以及会话语义检查点与断电自愈策略 (`session-checkpoint-policy`)。

### 十四、人类斜杠命令、输入触发器与交互扩展 (Commands & Input Triggers)
- **[slash-commands-and-input-triggers.md](./slash-commands-and-input-triggers.md)**：
  人类斜杠命令与输入交互指南——`ctx.commands` 核心注册表、自定义 `/command` 编写实战、输入触发器 (`dsh-client-ui-input-trigger`) 下拉补全浮层、纯前端 UI 双面设计模式、以及全局快捷键 (`dsh-client-shortcuts`) 绑定。

### 十五、沙箱底层物理隔离、图像转储与出站网络代理 (Sandbox, Image Offload & Proxy)
- **[sandbox-internals-and-proxy.md](./sandbox-internals-and-proxy.md)**：
  沙箱内核机制与网络代理指南——Windows WRITE_RESTRICTED 令牌与 DACL 交集检查原理、Linux Landlock LSM 路径封锁、沙箱结果三状态严格判别法 (Policy Denial vs Runner Failure vs Exit Code)、多模态长对话 `image-offload` 图像外置转储与重试自愈、以及 Undici 全局调度器出站网络代理 (`dsh-http-proxy`) 透明支持。

### 十六、子智能体引擎、文件系统安全观察与 ACP 协议 (Subagents, FS Policy & ACP)
- **[subagents-fs-policy-and-acp.md](./subagents-fs-policy-and-acp.md)**：
  子智能体生命周期与文件安全策略指南——`ctx.subagents` 服务切面、三大提供方 (`spawn-in-process` 独立运行 / `fork-in-process` 继承分叉 / `acp` 远程进程)、单次 (`start`) vs 持续通信 (`startContinuable`)、文件系统弱引用观察表与防覆盖锁机制 (`fs-observation-policy`)、以及自动化 Agent Client Protocol (ACP)。
