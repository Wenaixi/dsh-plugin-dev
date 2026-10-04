---
name: dsh-plugin-dev
description: "Use when creating, modifying, reviewing, or debugging DeepSeek Harness (DSH) / Cordis plugins. REQUIRED for any DSH plugin development task. Trigger on: DSH 插件、Cordis、plugin、服务注入、事件监听、模型工具 (defineTool)、单调守卫 (guard)、LLM 适配器、双面插件 (Dual-Face)、Slots 插槽、Agent Teams 团队协作、Schedule 挂钟定时、cordis.patch.yml 补丁配置、三角色架构、或组合包打包安装。"
---

# dsh-plugin-dev

> **【核心定位】** 本文件是辅助开发者和 AI 助手开发、审查、调试 DSH (DeepSeek Harness) 插件的权威参考技能（Skill），**不是 DSH 插件自身**。
>
> **【必须调用要求与事实核验指引】**
> - **必须调用**：进行任何 DeepSeek Harness (DSH) 插件开发、调试、审查或配置任务时，**必须调用本 Skill**；API、服务挂载属性与配置字段一律以本技能文档与官方类型声明为准，不要凭印象推断；
> - **参考路由**：进行具体插件设计与编码前，先通过第六节【场景决策与开发导引矩阵】路由到对应专题文档（[`references/*.md`](./references/README.md)），全景主题导航见 [`references/README.md`](./references/README.md)；
> - **鼓励并要求核验真实细节**：涉及具体服务契约、参数类型、Schema 结构或版本行为时，**强烈鼓励并要求查验真实细节**（官方上游仓库 `deepseek-ai/deepseek-harness`、本地已安装官方包的 `lib/*.js` 实现（含 JSDoc）与 `package.json` 声明、以及运行时 `ctx.tools.schemas()` 等真源，详见 [`references/official-upstream-and-docs.md`](./references/official-upstream-and-docs.md)），拒绝盲目断言。

---

开发 DeepSeek Harness（DSH）插件的参考 Skill；具体契约以目标版本的源码、发布物和运行时为准。

---

## 一、核心原则与架构真相 (Architectural Invariants)

1. **微内核设计 (Zero-Privilege Microkernel)**：DSH 没有特权核心，所有能力均以 Cordis 插件形式装配于共享 `Context`。
2. **核心大动脉服务单复数铁律 (The Core Spine)**——写错单复数是最常见的低级错误：
   - **复数**（注册表 / 多成员服务）：`ctx.sessions`、`ctx.agents`、`ctx.agentTeams`、`ctx.tools`、`ctx.settings`、`ctx.clientModules`；
   - **单数**（引擎 / 运行时 / 控制器）：`ctx.systemPrompt`、`ctx.configEditor`、`ctx.schedule`、`ctx.planMode`、`ctx.workspaceRegistry`、`ctx.llm`；
   - `ctx.agentLoop` 由 `@deepseek-ai/dsh-agent-loop` 挂载的 Service（`super(ctx, "agentLoop")`）提供，扩展插件依赖 `@deepseek-ai/dsh-agent` 的事件与服务即可；
   - `@deepseek-ai/dsh-scope` 是纯函数库，不在 Context 上挂载服务。
   完整角色矩阵（core / seam / bundle）、所属包与提供方见 [services.md](./references/services.md)。
3. **事件派发模式必须分别核对**：`emit`、`waterfall`、`parallel`、`serial`、`bail` 的等待、短路和返回值语义不同，不能按名称推断。源码级调度算法、`isBailed` 边界与 `EventOptions` 见 [events.md](./references/events.md)。
4. **配置补丁四层生效与全量替换语义**：
   - 生效顺序：bundles 自带 patch -> profile patch -> 用户全局 patch -> CLI `--patch` overlays（后层按行胜出）；
   - 补丁中的 `config` **整体替换，不做深合并**；
   - **绝对严禁教导用户修改 `settings.yaml`**（已彻底废弃，启动时自动重命名为 `settings.yaml.imported`）。
   落点路径、`- insert:` 语法、`- id:` 覆盖、`!!js` 动态求值与两种写入语义见 [config.md](./references/config.md)。
5. **官方工具执行流水线**（讲解拆为带编号的环节序列；真实调度器环节 12-13 个，`presentCall`/`presentResult` 是工具可选展示声明、不在调度器调用链上；完整逐条与源码行号见 [tools.md](./references/tools.md)）：
   `tool/call` 记录 -> `pre-execute` -> **`approval` (serviceAsk 审批裁决)** -> **单调 guard (终极一票否决权)** -> `execute`(环绕分派) -> 工具 `execute`(主体) -> FS Gate -> 工具自有事件 -> **`projectContent` (denied 依然触发)** -> `post-execute` -> 规范化 -> `finalizeContent` -> `tools/result` (同步) -> `tool/result` (持久化)。
   **审批先于守卫**：用户点了「允许」之后，单调 guard 仍可否决，详见 tools.md 第 4、5 阶段。
6. **反例与误诊**：以上铁律都有一批「看起来合理但不存在」的 API 和「听起来顺理成章但方向错」的归因（改 `settings.yaml`、`registerTool`、`registerTab`、`did not activate` 等），逐条附可执行判定动作，见 [debugging-and-troubleshooting.md](./references/debugging-and-troubleshooting.md) 的「伪 API 与伪归因黑名单」。

---

## 二、DSH 插件开发标准五步工作流 (5-Step Standard Workflow)

无论开发哪种形态的插件，均推荐遵循以下严格的工程化闭环步骤：

```
[步骤 1: 架构选型] ──► [步骤 2: 生成骨架] ──► [步骤 3: 核心实现] ──► [步骤 4: 极速联调] ──► [步骤 5: 验收交付]
   确定形态与依赖         按专题文档建立最小骨架       生命周期与插槽/服务     --patch 临时叠加       批量校验与死链检测
```

1. **步骤 1：架构选型与依赖规划**
   - **输入**：业务需求描述；
   - **执行**：查阅下方【快速分流路由图】，确定插件形态（纯函数、面向模型工具、服务提供方、LLM适配器、双面UI等），确定所需注入的服务（`inject: ['tools', ...]`）；
   - **输出**：确定的插件形态、所需服务清单、包名（如 `dsh-my-plugin`）。
2. **步骤 2：生成工程骨架与依赖声明**
   - **输入**：目标目录路径；
   - **执行**：按 [three-roles.md](./references/three-roles.md) 的 `package.json` 声明规范与 [config.md](./references/config.md) 的补丁语法，手工建立四件套：`package.json`（含 `dsh.bundle.patch` 与 `dsh.client.platform`/`exports["./client"]`）、`cordis.patch.yml`、Host 半侧入口、Client 半侧入口（如需 UI）；
   - **输出**：包含规范 `package.json`、`cordis.patch.yml`、入口 `index.js` 的工程骨架。
3. **步骤 3：编写核心业务逻辑与生命周期**
   - **输入**：业务逻辑与 API 接口；
   - **执行**：编写功能代码。遵循核心铁律：所有副作用进入 `ctx.effect`、工具执行经官方固定管线（13 调度器 + 3 非调度器环节）、React 组件绝不传 `ctx`、敏感密钥使用 `ctx.credentials` 引用模式；
   - **输出**：完整实现的业务代码。
4. **步骤 4：本地极速联调与排错验证**
   - **输入**：未发布的本地插件代码；
   - **执行**：使用 `dsh --profile <profile> --patch ./my-plugin/cordis.patch.yml` 0 侵入启动测试；检查控制台 `window.__DSH_BOOT__` 与宿主启动日志（`$DSH_HOME/logs/`，profile 目录下没有 `cfg.err`/`cfg.log` 这类通用产物）；
   - **输出**：在 Web GUI 或终端中正常激活并生效的插件功能。
5. **步骤 5：自动化验收与合规校验**
   - **输入**：完成测试的插件目录；
   - **执行**：逐项自检本项目 [CONTRIBUTING.md](./CONTRIBUTING.md) 第四节的五条硬性规范；对外发布前用 `dsh --profile <profile> --dump-config` 确认补丁被解析（注意它不加载插件代码，阳性不等于能启动）；
   - **输出**：全部绿色通过的交付物。

---

## 三、关键安全决策检查点 (Safety Checkpoints)

在进行自动化开发或自主推进时，遇到以下情况**必须触发暂停确认**，防止破坏宿主生产环境：

- **⚠️ 检查点 1（修改全局 Profile 配置前）**：
  在向当前活跃 profile 的 `cordis.patch.yml` 写入永久改动前，必须确认备份原文件（如 `cordis.patch.yml.bak`），防止配置错误导致整个 Web 宿主无法启动；
- **⚠️ 检查点 2（执行高危系统调用与写文件前）**：
  在调用 `ctx.subprocess.spawn` 执行破坏性文件删除或外部安装时，必须明确参数为扁平数组（严格零 Shell 解释），并提示用户确认当前沙箱模式（`read-only` / `workspace-write`）；
- **⚠️ 检查点 3（添加带有未适配 peerDependencies 的插件时）**：
  若遇到第三方包报 peer 不兼容，必须暂停提示用户并明确告知风险，再执行 `allow-version ... --accept-risk` 豁免。

---

## 四、异常边界与状态快速回滚指南 (Rollback & Recovery)

若插件联调过程中出现系统异常，请按以下预案秒级恢复：

1. **Web 宿主启动崩溃 (required plugin did not activate)**：
   - 立即检查宿主启动日志（`~/.dsh/logs/startup-*.log`，profile 目录下没有 `cfg.err`）；
   - 撤销最近一次在 `cordis.patch.yml` 中插入的条目，或将该条目置为 `disabled: true` 即可秒级恢复启动。
2. **插件卡在 PENDING 状态无法就绪**：
   - 检查该插件的 `inject` 列表，定位缺失的服务名称；将其从 `inject` 移除，改用代码内部 `ctx.get('service')` 动态降级容错。
3. **前端页面白屏或样式错乱**：
   - 检查浏览器控制台 Network 是否有 Combo 路由 404；
   - 在控制台运行 `localStorage.clear()` 清理脏配置，或在宿主执行硬重启刷新 HMR 缓存。

---

## 五、官方一手资料核验指引 (Upstream Verification)

本技能库包含源码核验结论、工程归纳和社区案例。使用具体 API 前必须回到目标环境的运行时与实际发布物核验；与源码冲突时以运行时和源码为准。

| 证据强度 | 来源 | 用途 |
| :--- | :--- | :--- |
| 最弱 | 官方文档站散文 | 了解整体设计意图 |
| 中等 | 官方仓库 `packages/<包名>/README.md` | 组合规则、配置语义、设计理由 |
| 最强 | 本地 `lib/*.js` 实现（含 JSDoc）与 `package.json` | 真实契约：`inject`、`Config`、`declare module` 挂载名（`lib/types/*.d.ts` 多数不存在，types 字段可能指向缺失文件） |
| 运行时 | `ctx.tools.schemas()`、`ctx.get('<服务>')`、启动日志 | 最终判据，一切以宿主实际行为为准 |

- 官方上游仓库：https://github.com/deepseek-ai/deepseek-harness 
- 官方文档站（英文）：https://deepseek-harness.github.io/deepseek-harness/en/ 
- 官方文档站（中文，去掉 `/en/` 即为中文版）：https://deepseek-harness.github.io/deepseek-harness/ 
- 本地官方包目录：`<npm全局根>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` 与 `$DSH_HOME/profiles/<profile>/node_modules/`

完整页面清单、单包结构速查与版本升级回溯流程见 [references/official-upstream-and-docs.md](./references/official-upstream-and-docs.md)。

---

## 六、场景决策与开发导引矩阵

```text
┌─ 插件开发需求快速分流路由 ────────────────────────────────────────────────────────┐
│ 需要在全局设置窗口左侧加专属 Tab / 插件页展示卡片？► 场景 I: 设置与插件 UI (Settings) │
│ 需要在右侧栏/输入框/会话顶部加挂件或支持深浅色主题？► 场景 J: Web 全量插槽与主题 (Slots) │
│ 想要向用户呈递最终交付物卡片(打开/预览)或弹窗提问？► 场景 O: 多模态与交付物 (Deliverables)│
│ 多智能体多轮持续通信、文件防覆盖锁或 ACP 自动化？ ─► 场景 U: 子智能体与文件策略 (Subagent) │
│ 用户在输入框打字想要斜杠补全(/)或自定义人类命令？ ─► 场景 S: 斜杠命令与输入触发 (Commands) │
│ 深入沙箱底层限制权限、多模态图片溢出或配置出站代理？► 场景 T: 沙箱内核隔离与代理 (Sandbox) │
│ 插件需要服务端强校验存储数据或管理持续 PTY 伪终端？► 场景 R: 领域存储与持续终端 (Storage)│
│ 防止模型反复重试相同命令死循环或注入当前物理时钟？─► 场景 Q: 死循环防护与中间件 (Middleware)│
│ 外部系统 Webhook 自动触发唤醒或纯命令行无头批处理？ ─► 场景 P: Webhook 与无头 (Headless) │
│ 想要桥接连接外部 MCP Server (HTTP 或 StdIO 工具)？ ─► 场景 M: MCP 客户端桥接 (MCP Client)│
│ 动态向模型注入提示词段落或计算会话事件流投影？ ────► 场景 N: 提示词与事件投影 (Prompt)  │
│ 浏览器前端需要调用 Node 宿主做高危或系统操作？ ────► 场景 K: 跨端通信 (Remote RPC)    │
│ 装插件解析到旧版本/被 incompatible 拒绝？ ─────────► 场景 V: 安装解析陷阱 (Resolution)│
│ 插件装载失败/卡在 PENDING/排查报错疑难杂症？ ───────► 场景 L: 极速联调与排错 (Debug)  │
│ 接入第三方大模型厂商 API？ ────────────────────────► 场景 D: LLM 适配器 (LlmAdapter) │
│ 多 Agent 团队协作与共享看板？ ──────────────────────► 场景 H: Agent Teams 架构       │
│ 挂钟定时提醒与周期计划任务？ ───────────────────────► 场景 G: 定时调度系统 (Schedule)  │
│ 面向模型暴露能力或安全拦截？ ───────────────────────► 场景 B: 模型工具插件 (Tool & Guard)│
│ 提供跨插件共享的有状态能力？ ───────────────────────► 场景 C: 服务提供方 (Service 继承) │
│ 轻量生命周期、事件监听、日志？ ─────────────────────► 场景 A: 基础函数插件 (ctx.effect) │
│ 打包发布、Profile 组合配置？ ───────────────────────► 场景 F: 组合包工程 (Bundle/Patch) │
│ 想要把自研资源变成原生技能，或自定义技能发现？ ───────────────► 场景 W: 技能发现 (Skill) │
│ 界面注册了却不出现/改完没效果/疑似旧缓存？ ───────────► 场景 Y: UI 落点与取证 (Placement)│
│ 桌面版与 CLI 行为不一致/要跨运行时迁移插件与配置？ ────► 场景 Z: 跨运行时差异 (Runtime)  │
└───────────────────────────────────────────────────────────────────────────────────┘
```


| 场景 | 目标需求 | 推荐形态与核心服务 | 关键参考文档 |
| --- | --- | --- | --- |
| **A** | 轻量生命周期、事件监听、日志记录 | 函数插件：导出 `apply(ctx)`，使用 `ctx.effect` 管理可逆副作用 | [plugin-anatomy.md](./references/plugin-anatomy.md) |
| **B** | 面向模型暴露能力、安全拦截、参数校验 | 工具插件：`defineTool`，`inject: ['tools']`，配合单调 `guard` | [tools.md](./references/tools.md) |
| **C** | 跨插件业务共享、领域逻辑封装 | 服务插件：继承 `Service` 类，指定挂载属性名，`[Service.tracker]()` | [services.md](./references/services.md) |
| **D** | 接入第三方大模型厂商 API | LLM 适配器：继承 `LlmAdapter`，实现 `stream()`，注册至 `ctx.llm` | [llm-adapter.md](./references/llm-adapter.md) |
| **E** | 浏览器 UI 扩展、卡片定制、设置页面板 | 双面插件 (Dual-Face)：Host 半侧 `lib/index.js` + Client 半侧 `lib/client.js`，组件经 `ctx.slots` 注入且只接收 props | [three-roles.md](./references/three-roles.md) |
| **F** | 打包发布、Profile 组合、依赖规整 | 组合包 (Bundle)：配置 `dsh.bundle`，携带 `cordis.patch.yml` | [packaging.md](./references/packaging.md) |
| **G** | 定时提醒、挂钟计划任务调度 | 定时调度系统：消费 `ctx.schedule`，注册 schedule 系列工具 | [services.md](./references/services.md) |
| **H** | 多智能体协同、分布式团队、共享任务看板 | Agent Teams 架构：消费 `ctx.agentTeams`，使用 `spawn_teammate` / `send_message` / `team_task_*` 系列工具 | [services.md](./references/services.md) |
| **I** | 在全局设置左侧加专属 Tab、自定义设置面板 | 双面 UI 设置扩展：注入 `settings.section`，编写纯 React 设置面板 | [settings-and-plugin-ui.md](./references/settings-and-plugin-ui.md) |
| **J** | 右侧边栏、输入框挂件、会话工具栏、主题与 i18n | Web 核心插槽扩展：注入 `sidebar.right.*`、`conversation.input.*`、适配 CSS 变量 | [web-ui-slots-and-styling.md](./references/web-ui-slots-and-styling.md) |
| **K** | 浏览器前端调用 Node 宿主文件/系统能力 | 跨端通信网关：编写 `@Remote` 服务，Client 调 `ctx.remote.xxx` | [remote-rpc-guide.md](./references/remote-rpc-guide.md) |
| **L** | 本地极速调试、插件卡死排查、错误诊断 | 本地调试与排错：`--patch` 极速联调、检查 `__DSH_BOOT__`、Top 9 避坑 | [debugging-and-troubleshooting.md](./references/debugging-and-troubleshooting.md) |
| **M** | 接入外部 MCP 工具服务 (HTTP 或 StdIO) | MCP 客户端桥接：配置 `dsh-mcp-client` 插件实例，生成 `mcp__*__*` 工具 | [mcp-and-tools-bridge.md](./references/mcp-and-tools-bridge.md) |
| **N** | 动态改写系统提示词、监听会话事件与状态投影 | 提示词与投影体系：注入 `systemPrompt` 有序段落、注册 `sessionProjections` 折叠器 | [system-prompt-and-projections.md](./references/system-prompt-and-projections.md) |
| **O** | 呈递最终文件交付物卡片、向用户交互式提问 | 多模态与人机交互：调用 `present` 生成文件卡片、调用 `ask_user_question` 挂起提问 | [multimodal-and-deliverables.md](./references/multimodal-and-deliverables.md) |
| **P** | 外部 Webhook 触发、CI/CD 纯命令行无头批处理 | 外部集成与无头驱动：注册 `webhookRuntime` 规则、以 `dsh-headless` 运行自动化测试 | [webhook-headless-and-workflows.md](./references/webhook-headless-and-workflows.md) |
| **Q** | 防范模型工具调用死循环、注入动态时间戳与用户反馈 | 内置增强与中间件：接入 `repeat-tool-reminder` 劝告破局、注入 `time-context` 时钟事实 | [builtin-enhancements-and-middleware.md](./references/builtin-enhancements-and-middleware.md) |
| **R** | 服务端强模式持久化业务数据、管理长任务持续伪终端 | 存储与终端原语：使用 `ctx.storageDomain`/`ctx.storage.domain` 读写强类型表、使用 `ctx.terminals`（复数）管理 PTY | [storage-terminals-and-checkpoints.md](./references/storage-terminals-and-checkpoints.md) |
| **S** | 注册人类斜杠命令、输入框光标补全浮层与快捷键 | 命令与输入触发：使用 `ctx.commands` 注册 `/command`、双面插件注入 input-trigger | [slash-commands-and-input-triggers.md](./references/slash-commands-and-input-triggers.md) |
| **T** | 沙箱内核级隔离、多模态图片压缩转储与网络代理 | 底层安全与基础设施：理解 Windows ACL/Landlock 原理、image-offload 恢复、undici 代理 | [sandbox-internals-and-proxy.md](./references/sandbox-internals-and-proxy.md) |
| **U** | 子智能体持续多轮交互、文件系统防覆盖锁与 ACP 协议 | 委派与文件安全：使用 `ctx.subagents.startContinuable`、理解 fs-observation 读后写规则 | [subagents-fs-policy-and-acp.md](./references/subagents-fs-policy-and-acp.md) |
| **V** | 装插件解析到过时的旧版本、被 incompatible 拒绝、版本选择与预期不符 | 安装解析排障：读 `.plugin-manager/logs/` 确认解析版本，识别 pnpm 冷却期与 semver 预发布排序，配置 `minimumReleaseAge: 0` 或改用精确版本 | [install-resolution-traps.md](./references/install-resolution-traps.md) |
| **W1** | 自定义技能失效不生效、UI 开关后模型目录不刷新、怀疑 skills/change 误用 | 失效链路与 invalidate 正确姿势：`provider-catalog-invalidation.md`（消费方通知缝 vs 提供者直调、registerProvider 捕获实例、反模式两例） | [provider-catalog-invalidation.md](./references/provider-catalog-invalidation.md) |
| **W2** | 双面插件接入 ctx.locale 双语、构建产物内嵌字典、宿侧文案客户端覆盖、发布后 npm 验证假阴性 | i18n 六铁律 + 发布验证：`client-i18n-pitfalls.md` / `publish-npm-verification.md` / `architecture-refactor-experience.md` | [client-i18n-pitfalls.md](./references/client-i18n-pitfalls.md) · [publish-npm-verification.md](./references/publish-npm-verification.md) · [architecture-refactor-experience.md](./references/architecture-refactor-experience.md) |
| **W3** | 长驻缓存/清单比对/正则守卫三类静默失明（快照 mtime 判据、按索引比对、字符类不符） | 多键聚合指纹 + Map 比对 + 数据域正则 + 可失败自检：`silent-failure-and-gate-design.md` / `architecture-refactor-experience.md` | [silent-failure-and-gate-design.md](./references/silent-failure-and-gate-design.md) · [architecture-refactor-experience.md](./references/architecture-refactor-experience.md) |

> **通用工程经验（社区图谱）**：开发任何形态插件前，先查
> [community-patterns.md](./references/community-patterns.md)——高星插件共性做法与高频坑
> （patch 整块替换、版本兼容层、信任围栏、客户端纪律、事件词汇表等）已按专题蒸馏完毕。
| **W0** | 想把自研资源（打包资源、远端、动态裁剪）变成原生技能，或替换技能发现逻辑 | 自定义技能发现：实现 `SkillProvider` 的 `list`/`get`，经 `ctx.skills.registerProvider` 接入，取 `rank`（小者胜）裁决重名；`complete: false` 只用于发现未完成（目录缺失返回空数组即可）；`invocation` 的 `modelInvocable`/`userInvocable` 控制模型/用户两侧可见性 | [skill-provider.md](./references/skill-provider.md) |
| **X** | 代码与门禁都写完了，运行时功能却不生效且无任何报错 | 静默失效排查：按「代码从未执行 / 契约被吞 / 解析到别的东西」三类定位；给每条新断言做破坏实测；真机浏览器验收并逐次回读真值 | [silent-failure-and-gate-design.md](./references/silent-failure-and-gate-design.md) |
| **Y** | 界面注册了却不出现、改完看不出效果、分不清「没渲染 / 渲染在别处 / 用的旧缓存」 | 客户端 UI 落点与取证：先查「界面语义 → 插槽」映射表，坚持**一个功能一个入口**；记住 `slots.inject` 在插槽 spec 不存在时**静默不执行**；改完桌面端必须完全重启；用 Node 直跑 factory 与 CDP 真机取证 | [client-ui-placement-and-verification.md](./references/client-ui-placement-and-verification.md) |
| **Z** | 同一插件在桌面版与 CLI Web 上表现不一致；要把插件与配置从一个 profile/运行时迁到另一个 | 跨运行时差异与迁移：桌面版本体在 `app.asar`、profile 被 Electron 独占（部分 CLI 操作仍可用）、依赖多为 hoisted；**官方包由运行时提供不必装**；**装了 ≠ 挂载**（`dependencies` vs `dsh.profile.bundles`）；pnpm **不检测文件缺失**；配置迁移要追加不覆盖 | [desktop-vs-cli-runtime.md](./references/desktop-vs-cli-runtime.md) |

---

## 七、快速开始与代码范例

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
    if (exec.name === 'dangerous_tool') {
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
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-primitives"] }
  }
}
```
> 注：双面插件声明**不存在** `dsh.bundle.id` / `dsh.client.module` 字段；声明了 `exports` 就必须同时放行 `"./package.json"` 与 `"./locale/*.json"`。

Browser 侧 `lib/client.js`（**必须是 CJS factory 形态**；ESM import / 顶层 return / JSX 三者任一出现都会加载失败）：

```js
window.__ModuleLoader__.load({
  id: '@scope/dsh-custom-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")
    const e = React.createElement

    // React 组件只接收 slots 注入的 props，绝不接收 ctx
    function CustomWidget() {
      return e("div", { className: "p-4 bg-card rounded shadow" }, "自定义状态面板")
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', id: 'custom-panel', title: '扩展面板' }, CustomWidget)
      )
    }

    exports.apply = apply
    exports.inject = ["slots"]
    return module.exports
  }
})
```

「插件 UI 要符合 DSH 风格」的可执行含义是**复用宿主组件**，不是模仿配色。动手前先查官方 `@deepseek-ai/dsh-client-ui-primitives` 的组件目录：`Button` / `Switch` / `SegmentedControl` / `Pill` / `Tag` / `StateDot` / `Input` / `Checkbox` / `Menu` / `Tooltip` / `Modal` / `Toast` / `DisclosureRow` / `SettingsForm` / `MarkdownText` / `CodeBlock` / `DiffBlock` 等全是跨插件共享的原子组件，插件之间不能互相 import 组件，这里是控件唯一的共享点。手写开关或分段控件等于制造第二份必然漂移的实现。确实必须自绘时只抄尺寸（按钮 36/28px、描边 `0.5px`、开关 36x20），颜色圆角一律走 `--dsw-*` token；文案必须由渲染方通过 label prop 提供（组件读不到 locale，省略会类型检查失败）。把配置面板挂到已安装插件卡片详情用 `plugins.bundle.config` 插槽。详见 [web-ui-slots-and-styling.md](./references/web-ui-slots-and-styling.md) 第四、五、六、七节与 [settings-and-plugin-ui.md](./references/settings-and-plugin-ui.md)。

---

## 七之二、真实浏览器验收（UI 插件必做）

Host 侧接口 200 与「面板渲染正常」是两件事。UI 插件交付前必须在**真实浏览器**里点一遍，且每一步都要回读磁盘或接口核对落盘结果。

### 1. 取访问地址

`dsh <profile> --port <port>` 启动后 stdout 打印带 token 的一次性地址：

```
dsh web: http://127.0.0.1:<port>/?token=<launchToken>
```

token 每次重启都变。直接 `GET /api/*` 会 401，必须先换 Cookie：

```js
const auth = await fetch(url, { redirect: 'manual' })
const cookie = (auth.headers.get('set-cookie') || '').split(';')[0]
await fetch('http://127.0.0.1:<port>/api/...', { headers: { Cookie: cookie } })
```

### 2. Playwright 驱动本机 Chrome

DSH 自带的 Playwright 不含浏览器二进制，必须指到本机 Chrome；页面导航用 `domcontentloaded` 而非 `networkidle`（WebSocket 长连接会让后者永远超时）：

```python
b = await p.chromium.launch(
    executable_path=os.environ.get("CHROME_PATH") or r"<本机 Chrome 绝对路径，Windows 常为 C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe>",
    headless=True, args=["--no-sandbox"])
pg = await c.new_page()
pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))   # confirm() 会阻塞脚本
await pg.goto(url, wait_until="domcontentloaded", timeout=20000)
```

**务必注册 dialog 处理器**：面板里的「确认后恢复默认」用的是 `confirm()`（playwright 默认直接 dismiss，会导致恢复默认永远不生效）。

### 3. 全新的遮罩陷阱：`force=True` 不等于点到了元素

Playwright 的 `click(force=True)` 只是把鼠标事件派发到**坐标点**，不做命中测试。若页面上有遮罩层（`role=presentation` 的 mask、引导层、过渡动画），事件会被遮罩吞掉——**DOM 里元素可读，React 的 onClick 却从未执行**，表现为「读操作全对、写操作全部无效」。

这个假象极具迷惑性：截图看着面板好好的，断言也全绿，但配置一个都没落盘。

判定：写操作后回读接口/磁盘，值没变即为命中失败，不是业务 bug。

解法（按优先级）：

```python
# 最优：用 DOM 原生 click，命中元素自身，忽略遮罩；走的仍是同一条 React onClick 链路
await pg.evaluate("""() => {
  const el = [...document.querySelectorAll('button,[role=tab],[role=radio]')]
    .filter(e => e.children.length === 0 && e.textContent.trim() === '激进')[0]
  el.click()
}""")

# 次选：先关掉遮罩（点遮罩内的关闭按钮 / 按 ESC / 读 __DSH_BOOT__ 判断首启引导）
```

### 4. 验收清单（逐条回读，不靠肉眼）

| 项 | 断言方式 |
| :--- | :--- |
| 无「Failed to load plugins」红条 | `inner_text('body')` 不含该串 |
| 面板只渲染一份 | `locator("text=<面板文案>").count() == 1` |
| 每个控件都点得动 | 点后回读接口字段确实变了 |
| 落盘正确 | 直接读磁盘配置文件，不是只看接口 |
| 控制台干净 | `len(errs) == 0` |

---

## 八、生产运维与防坑宝典

### 1. 两条最常见的假阳性信号
- `dsh --dump-config` 退出码为 0 只代表 YAML 语法合规，它不加载插件代码、不校验 peerDependencies。真实启动验收的三步命令（端口监听 + 鉴权跳转 + 首页 200）见 [config.md](./references/config.md) 第四节。
- `pnpm` 报 `Done` 不代表安装成功：DSH 在安装后还有一道兼容性闸门，失败会回滚 `package.json`/`pnpm-lock.yaml`/`node_modules`。判定路径见 [install-resolution-traps.md](./references/install-resolution-traps.md)。

### 2. 版本兼容性强制豁免
- 第三方包尚未标记适配新版 DSH 时执行：
  ```bash
  dsh plugin --profile <profile> allow-version <pkg>@<ver> --dsh-version <exact> --accept-risk
  ```
- **豁免是最后手段**：报错说「版本不兼容」时，版本号往往是包管理器解析出来的陈旧版本，不是人选的。先确认解析版本与根因（pnpm 24 小时发布冷却期、semver 预发布排序），修版本选择优先于申请豁免。完整推导见 [install-resolution-traps.md](./references/install-resolution-traps.md)。

### 3. 六条「看起来对但没生效」的经典陷阱

这六条的共同特征：**没有任何报错**，一切看起来正常，但功能没起作用。分类、判定动作与门禁写法见 [silent-failure-and-gate-design.md](./references/silent-failure-and-gate-design.md)。

| 陷阱 | 表现 | 根因 | 判定动作 |
| :--- | :--- | :--- | :--- |
| 路由属性名写错 | 插件已激活但接口一律 404 | `webServer.register` 的属性是 `handler` 不是 `handle` | 查 `@deepseek-ai/dsh-host-webserver` 类型声明 |
| exports 白名单没收紧 | 加了 `exports` 后卡片标题/描述/图标全空 | `readPluginMeta` 靠 exports 解析 `/package.json` 与 `/locale/en.json`，子路径未放行即抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` 且被吞 | 补 `"./package.json"` 与 `"./locale/*.json"` |
| 产物有两个来源 | 改源码没生效，或改了没反应 | `tsc` 编一份同名产物，构建脚本又覆写一份 | 全仓 grep 该产物名，只应有一处生成 |
| CSS 变量名拼错 | 元素有样式但颜色/圆角是浏览器默认 | `var(--不存在的名字, #fff)` 静默用兜底值 | DevTools Computed Style 查真实变量名 |

| 样式只定义了没注入 | 类名在元素上，computed style 全是浏览器默认值 | 只在 JS 里定义了 CSS 字符串却没把 `<style>` 标签插进 `document.head` | 页面里 `document.querySelectorAll('style[data-plugin-css]')` 看自己的标签在不在，再用 `document.styleSheets` 核对规则条数 |
| helper 改了签名只改一半 | 批量操作生效，单次操作毫无动静 | 多处调用点共用一个 helper，改签名时漏改，实参形态对不上 | 全仓 grep helper 名，逐个核对实参 |

**总原则：静默失败必须靠"回读真值"发现，不能靠看界面。** 每次写操作后回读接口或磁盘，值没变就是没生效。

**门禁原则：一条永远为真的断言等于没有断言。** 每条新断言都要人为破坏一次，确认它会红，再还原。

### 4. 免启动反证：宿主公开函数能直接问真值

DSH 导出大量纯读取函数，不必启 Web GUI、不必拿 token 就能判定「元数据读不读得到」「bundle 从哪解析」。Windows 上 `import()` 必须走 `pathToFileURL`，否则抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。可跑探针与典型入口表见 [debugging-and-troubleshooting.md](./references/debugging-and-troubleshooting.md) 第六节。

**对照反证是最快的定位手段**：把「表现正常的包」和「出问题的包」一起过一遍同一个宿主函数，差异落在哪个字段上，根因边界就在哪。

### 5. 装到旧版本时的两条立即验证
- `pnpm add <pkg> --config.minimum-release-age=0`（关闭 24 小时发布冷却期）或 `pnpm add <pkg>@<exact-version>`（精确版本绕过冷却期）能立刻拿到正确版本，即坐实根因是解析策略而非网络；
- **清缓存对上述根因无效**，用 `npm install <pkg> --dry-run` 与 pnpm 结果横向对比可快速隔离。完整推导、参数实验与决策表见 [install-resolution-traps.md](./references/install-resolution-traps.md)。

---

## 九、交付前自检清单 (Pre-Delivery Checklist)

本技能只提供纯文本规范，不含任何脚本或示例工程。交付前逐项确认：

1. `package.json`：`name`/`version`/`type: module` 齐备；组合包声明 `dsh.bundle.patch`（路径或数组）；双面插件声明 `dsh.client.platform` + `exports["./client"]`（**不存在 `dsh.bundle.id`/`dsh.client.module` 字段**）；**只要声明了 `exports`，就必须同时放行 `"./package.json"` 与 `"./locale/*.json"`，否则插件卡片只剩包名**；有 `icon` 则须为包内相对路径且 <= 256 KiB；
2. `cordis.patch.yml`：含真实 `- insert:` 声明（非注释）；条目的 `id` 为插件补丁行 id、`name` 与 `package.json` 的 `name` 一致；
3. 入口文件存在且导出 `apply`：`node --check index.js`（双面再加 `node --check lib/client.js`）无报错；
4. 双面插件的 Client 半侧经 `ctx.slots.inject/register` 挂载，组件只接收 props；
5. 真实启动验收：端口监听 + 首页 200；`--dump-config` 通过只代表 YAML 可解析。
6. 打包清单核对：`npm pack --dry-run --json` 确认 `locale/`、图标、`lib/` 全部入库——`files` 写错只在发布后暴露；
7. 卡片元数据可读：直接调 `readPluginMeta` 返回非 `undefined` 且 `error` 为空；
8. 图标是真透明底、不自带圆角，且在浅色与 `body[data-ds-dark-theme]` 下都可读；
9. 双面插件的样式确实注入：页面里能查到自己的 `style[data-plugin-css]` 标签且规则条数大于 0；
10. 真机浏览器点过一遍：每个控件点完都回读落盘值，写入期间先等 `aria-disabled` 解除，收敛判定要求连续两帧一致；
11. 每条质量门禁都做过破坏实测（人为破坏后必须变红，再还原）；
12. `repository.url` 已写成 `git+https://...` 形态，避免 npm publish 自动规范化告警。

带条件导出对象的 `exports`（`{ types, default }`）是合法写法，校验时取 `default` 或 `import` 字段。