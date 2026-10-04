# DSH 插件开发技术参考目录

> **⚠️ 核心定位声明**  
> **本目录是用于【辅助开发 DeepSeek Harness (DSH) 插件】的权威架构规范与知识库（Agent Skill 参考集）。**  
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 核心架构分类与参考指南导航

### 一、官方上游源码与官方文档核验指引 (Upstream & Docs)
- [official-upstream-and-docs.md](./official-upstream-and-docs.md)：
  官方一手资料索引——上游仓库 (`deepseek-ai/deepseek-harness`) 包清单与模块依赖图、本地已安装官方包的目录结构与类型声明速读法、官方文档站页面索引（中英双语入口）、事实核验三级证据强度与版本升级回溯流程。
  **任何架构结论与官方源码冲突时，一律以源码为准。**

### 二、微内核与服务架构 (Microkernel & Spine)
- **[cordis-context-internals.md](./cordis-context-internals.md)**：
  Cordis 微内核底层的三个隔离原语——`ctx.isolate(key)` 服务作用域物理隔离槽、`ctx.intercept(key, config)` 动态拦截代理、`Context.is(value)` 全局 Symbol 品牌跨 Realm 检验。
- **[skill-provider.md](./skill-provider.md)**：
  自定义技能发现 (SkillProvider) 权威指南——`registerProvider` 注册契约与同步工厂语义、`list`/`get` 两方法与 `locator` 往返句柄、`rank` 取值与重名裁决规则、`complete: false` 的"发现未完成"表达、AbortSignal 贯穿规范与吞 abort 造成的卡顿，以及生产侧 SKILL.md 发现器的 BOM/CRLF/闭栏/目录名四坑、frontmatter 解析的性能陷阱与失效链路。
- **[services.md](./services.md)**：
  The Core Spine 核心大动脉服务单复数绝对铁律（`ctx.sessions`、`ctx.agents`、`ctx.agentTeams`、`ctx.tools` 为复数；`ctx.schedule`、`ctx.planMode`、`ctx.workspaceRegistry` 为单数；`ctx.llm` 为 Seam）、终端服务挂载键是复数 `ctx.terminals`、不存在 `dsh-approval` 包（审批是 `dsh-user-approval`）、Service 类定义规范与依赖注入契约。
- **[plugin-anatomy.md](./plugin-anatomy.md)**：
  插件解剖学——三种插件形态、Context Proxy 与 `extend`/`isolate`/`intercept`、可逆副作用生命周期管理（`ctx.effect`）、五大派发模式、四角色模型、设置表单与配置持久化契约。

### 三、配置系统与补丁机制 (Configuration & Patches)
- **[config.md](./config.md)**：
  Schemastery 强类型配置规范、代码级四层补丁生效落点（bundles -> profile -> global -> `--patch` overlays）、全量替换（Wholesale Replacement）语义、`- insert:` 分组插入机制、`!!js` 动态表达式求值沙盒、`--dump-config` 假阳性避坑与三步真实启动验证。

### 四、事件总线与工具流水线 (Events & Tool Execution)
- **[events.md](./events.md)**：
  Cordis 五大派发模式源码剖析（`emit` 同步广播、`waterfall` 同步环绕中间件与 `next()` 拦截、`parallel` 并发与 `AggregateError`、`serial` 串行短路与 bail 判定、`bail` 同步短路）、宿主运行事件族、Persistence Catalog 事件与 SurfaceEventType 兼容性、5 类 SurfaceEventType 与 `ignorable` 契约。
- **[tools.md](./tools.md)**：
  ToolRuntime 架构、工具执行时序（六段官方管线）、单调安全守卫法则、全量官方工具归属包对照表与 `defineTool` 编写规范。

### 五、前端双面 UI 插件与全量插槽体系 (Client UI & Slots)
- **[settings-and-plugin-ui.md](./settings-and-plugin-ui.md)**：
  全局设置窗口 (Settings) 与插件管理中心 UI 深度指南——`settings.section` 与 `plugins.bundle.config` 插槽机制、源码级解密三大明星插件（终端输入、侧边卡片、壁纸引擎）的真实注入代码、导航图标 (Nav Glyph) 替换技法、React 设置面板的本地 vs 补丁持久化、左侧“插件”管理中心卡片呈现、**`readPluginMeta` 的 exports 白名单契约（卡片空白根因与修法）**、图标 256 KiB 上限与路径约束、**改完必跑的两道验证（`npm pack --dry-run` + 直接调 `readPluginMeta`）**与开发决策树。
- **[web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)**：
  Web GUI 全量插槽树实战——右侧边栏（`sidebar.right.pane.tab`）、会话顶部工具栏（`conversation.session.header.utilities`）、输入框挂件（`conversation.input.right`）、消息流拦截（`conversation.chat.node`）、全局外壳（`shell.*`）；官方主题 CSS 变量（以当前主题包导出为准，含常见误写对照）；样式安全注入与 HMR 回收铁律；**官方 primitives 组件族优先策略**（SegmentedControl / Switch / StateDot / Tag / Button）与「客户端产物单一来源」纪律；多语言国际化（`ctx.locale` 双语注册、声明 `locale:` 注入 t 席位、缺词静默返回 key）；语言边界契约（静态文案进词典、内容数据保持单语）。

- **[client-ui-placement-and-verification.md](./client-ui-placement-and-verification.md)**：
  客户端 UI **落点选择与真机取证**——「界面语义 → 插槽」完整映射表（设置窗口各级 Tab / 插件页分组条目 / 卡片内联配置区 / 右侧栏 Tab / 侧边栏底部 / 全局浮层）；**铁律「一个功能一个入口」**（多落点冗余 = UI 污染，实测需回滚）；插槽三个必知机制（spec 由父条目 `children` 表声明、四种 kind 与注册参数对应关系、**`slots.inject` 在 spec 不存在时静默不执行且零报错**）；`plugins.bundle.config` 的 **`configured` 渲染门（匹配键是包名）**；「UI 不显示」三分法（模块没进图 / apply 没跑 / 落点或渲染门不匹配）；客户端产物 **`immutable` 长缓存与「版本号先于界面更新」的假象**（桌面端必须完全重启）；**无浏览器验证法（Node 直跑 CJS factory 探针）**；CDP / browser-harness 真机取证的环境坑；**解析 Electron `app.asar` 做桌面版与 CLI 版差异比对**。

### 六、跨端通信与三角色物理隔离 (IPC & Remote)
- **[remote-rpc-guide.md](./remote-rpc-guide.md)**：
  Typert Remote RPC 跨端通信开发指南——Browser 前端 ↔ Host Node.js 服务端通信规范、方法签名四大硬约束（禁止解构、禁止默认值、禁止 rest、末位 signal 协作取消）、一元 RPC 与流式 mux 通道、端到端可运行范本。
- **[three-roles.md](./three-roles.md)**：
  Browser / Host / 隔离进程三角色物理隔离模型（源码中 Worker 专指 worker_threads，教学上避免用 Worker 指代第三角色）、子进程生成原语（`ctx.subprocess.spawn` 与 `spawnTerminal` 零 Shell 解释）、`SandboxMode`（仅限文件系统效果）与沙箱隔离。

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
  插件安装版本解析三大陷阱的权威排查手册——pnpm 自身的发布冷却期配置（v11 起默认 `minimumReleaseAge: 1440`，属包管理器行为，非 DSH 代码实现；DSH 侧兼容闸门是 peer 预检 + allow-version 豁免）、semver 预发布排序（`-tag.N` 后缀被范围解析默认排除，`maxSatisfying(vers,'*')` 返回旧正式版）、DSH 兼容性闸门两段式预检与后检语义与精确版本豁免机制、profile 目录结构与 `minimumReleaseAge: 0` 配置落点、desktop profile 的 Electron 独占守卫。附可复现的参数实验、时间指纹判定法与排障决策表；并覆盖**全新 profile 首次安装的三大坑**：`dsh plugin add` 不写 `dsh.profile.bundles` 需手动补、原生依赖的 `ERR_PNPM_IGNORED_BUILDS` 需在 `pnpm-workspace.yaml` 里加 `allowBuilds` 放行、以及从零到可跑的五步落地顺序。

### 九之二、静默失效防线与可失败门禁 (Silent Failures & Verifiable Gates)
- **[silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)**：
  把「代码写全了、门禁全绿、运行时毫无作用」这类零报错缺陷归纳成三类根因（代码从未被执行、契约被吞掉、解析到了别的东西），每类配可执行的判定动作；并给出**门禁设计方法论**——先按「错了会不会报错」分类，再决定写运行时回读、源码形态正则还是产物断言，**每条新断言必须做破坏实测证明它会红**；另含真机浏览器验收的环境坑速查（遮罩吞点击、导航等待超时、写入期间控件禁用）、收敛判定的「两帧相同加目标谓词」纪律、发布前后的双重复验与 manifest 自动规范化坑。

### 九之三、跨运行时差异与迁移 (Desktop vs CLI Runtime)
- **[desktop-vs-cli-runtime.md](./desktop-vs-cli-runtime.md)**：
  桌面版 (Electron) 与 CLI Web 两种运行时的**差异、共性与跨运行时工程实践**——物理形态对照（本体在 `resources/app.asar` vs npm 全局包、profile 目录一致、依赖布局 isolated vs hoisted）；**桌面版 profile 被 Electron 独占管理**的边界与仍可用的 CLI 操作（`plugin list/add/remove`）、两个 `dsh` 命令的 PATH 冲突与参数形式坑；**客户端产物长缓存导致桌面版必须完全重启**与「版本号先于界面更新」的假象；**官方包由运行时提供、profile 不应重复安装**（但官方插件的配置仍必须写在 `cordis.patch.yml`）；配置迁移方法论（追加不覆盖、保留更完整实现、分界注释、双重复验）；**凭据全局共享**（`.credentials.yaml` / `.env`）与"配置引用的 key 是否存在"的前置检查；**解析 `app.asar` 做桌面版与 CLI 版逐字对比**；**装了 ≠ 挂载**（`dependencies` vs `dsh.profile.bundles`）；**pnpm 不检测文件缺失**导致的"目录在、文件没了"故障与三条修复路径。

### 十、多模态附件、人机交互与最终交付物呈递 (Multimodal & Deliverables)
- **[multimodal-and-deliverables.md](./multimodal-and-deliverables.md)**：
  多模态与人机交互权威指南——最终交付物卡片 (`present` 工具与前端 Deliverables 原生打开/预览)、人机协同结构化提问 (`ask_user_question` 与 `ctx.userQuestions` 挂起/恢复)、多模态图像附件规范化存储 (`dsh-attachment-local`)、以及长上下文工具结果智能剪枝 (`compaction-tool-result-pruner`)。

### 十一、Webhook 外部集成、无头模式与长工作流 (Webhook, Headless & Workflows)
- **[webhook-headless-and-workflows.md](./webhook-headless-and-workflows.md)**：
  企业级自动化与无头运行权威指南——Webhook 外部触发与会话拉起 (`ctx.webhookRuntime`、`WebhookRule`、GitHub 集成)、Headless 纯无头命令行与 CI/CD 自动化批处理 (`dsh-headless`、`--json` ndjson 事件流)、以及 PTC 长任务工作流沙箱编排 (`dsh-workflow-ptc`、进程配额 maxOldGenerationSizeMb/maxOutputBytes)。

### 十二、官方内置增强插件与实用中间件 (Built-in Enhancements & Middleware)
- **[builtin-enhancements-and-middleware.md](./builtin-enhancements-and-middleware.md)**：
  高阶中间件与死循环防护全景指南——工具调用死循环检测与劝告性上下文注入 (`repeat-tool-reminder`)、动态时钟与物理挂钟环境事实注入 (`time-context`)、定稿消息用户点赞点踩反馈回流 (`message-feedback`)、以及包级架构不变量断言守护网 (`dsh-invariants`)。

### 十三、领域数据存储、持续伪终端与检查点 (Storage, Terminal & Checkpoints)
- **[storage-terminals-and-checkpoints.md](./storage-terminals-and-checkpoints.md)**：
  服务端状态存储与交互式终端权威指南——领域数据存储 (`ctx.storage.domain` Zod 强校验命名空间表、拒绝乱写文件的三层存储分层)、持续交互式伪终端 (`ctx.terminals` 复数；长任务 PTY 会话 `spawn`/`startSend`/`read`/`signal`)、以及会话语义检查点与断电自愈策略 (`session-checkpoint-policy`)。

### 十四、人类斜杠命令、输入触发器与交互扩展 (Commands & Input Triggers)
- **[slash-commands-and-input-triggers.md](./slash-commands-and-input-triggers.md)**：
  人类斜杠命令与输入交互指南——`ctx.commands` 核心注册表、自定义 `/command` 编写实战、输入触发器 (`dsh-client-ui-input-trigger`) 下拉补全浮层、纯前端 UI 双面设计模式、以及全局快捷键 (`dsh-client-shortcuts`) 绑定。

### 十五、沙箱底层物理隔离、图像转储与出站网络代理 (Sandbox, Image Offload & Proxy)
- **[sandbox-internals-and-proxy.md](./sandbox-internals-and-proxy.md)**：
  沙箱内核机制与网络代理指南——Windows WRITE_RESTRICTED 令牌与 DACL 交集检查原理、Linux Landlock LSM 路径封锁、沙箱结果三状态严格判别法 (Policy Denial vs Runner Failure vs Exit Code)、多模态长对话 `image-offload` 图像外置转储与重试自愈、以及 Undici 全局调度器出站网络代理 (`dsh-http-proxy`) 透明支持。

### 十六、子智能体引擎、文件系统安全观察与 ACP 协议 (Subagents, FS Policy & ACP)
- **[subagents-fs-policy-and-acp.md](./subagents-fs-policy-and-acp.md)**：
  子智能体生命周期与文件安全策略指南——`ctx.subagents` 服务切面、三大提供方 (`spawn-in-process` 独立运行 / `fork-in-process` 继承分叉 / `acp` 远程进程)、单次 (`start`) vs 持续通信 (`startContinuable`)、文件系统弱引用观察表与防覆盖锁机制 (`fs-observation-policy`)、以及自动化 Agent Client Protocol (ACP)。

### 十七、社区实践图谱：高星插件共性工程经验 (Community Patterns)
- **[community-patterns.md](./community-patterns.md)**：
  由 GitHub topic:dsh-plugin 高星仓库（最近一次快照）逐一分析蒸馏的
  **跨仓库通用工程经验**——插件形态判定三信号（`dsh.bundle.patch` / `cordis.patch.yml` /
  `@deepseek-ai/*` 依赖）、patch 整块替换与 `!!js` 版本自适应、版本兼容层四种写法
  （能力探测 / Symbol.for / peer 枚举 / 基线门）、webServer 路由与浏览器信任围栏
  （`--trusted-host` 语义、exact 路由赢过 /api fence 的坑）、客户端半区纪律
  （`__ModuleLoader__` 握手、external 白名单、settings.section React 渲染契约、
  globalThis Symbol 防模块状态分裂）、自定义 session 事件类型词汇表注册、
  `sessionProjections` 单元契约、记忆/用量插件挂点三件套、渐进式工具暴露、
  意图工具 + 投影 fold、服务提供方与 Typert RPC 的坑、凭据引用、prepare-before-swap
  热更新、Windows / Electron / DSH_HOME 环境坑、发布与验收纪律。每条经验带出处仓库，
  属"第三级证据"（社区实现），与官方源码冲突时以官方为准。
### 十八、实战深挖沉淀：失效链路 / i18n 坑 / 重构经验 / 发布验证 (Field Experience)

- **[provider-catalog-invalidation.md](./provider-catalog-invalidation.md)**：
  技能目录/注册表失效链路的权威操作姿势——`skills/change` 是**消费方通知缝**（官方 `notifyChange()` 源码链路），提供者在其监听器内反向调 `control.invalidate()` 会**同步递归栈溢出**（`invalidateCache` 再次 emit，invalidate 守卫不抑制重入）；`registerProvider` 工厂返回值必须**捕获到闭包变量**否则 `invalidate()` 空转成静默失效；filesystem provider 的观察 roots 与插件包内 skillDir 的关系；正确姿势 = 变更点直调 invalidate；每条断言做破坏实测。
- **[client-i18n-pitfalls.md](./client-i18n-pitfalls.md)**：
  客户端 `ctx.locale` 实战六铁律——双语键必须完全成对、值可相同（刻意单语条目也用同值占位）；字典是纯数据、**不能嵌 `t()` 调用**；构建期 Node 计算、产物只内嵌**字面量**（浏览器端执行 `readdirSync` 会 ReferenceError）；宿侧下发的诊断链中文在客户端按枚举查字典覆盖（宿侧契约零改动）；语言切换刷新用 `ctx.locale.subscribe` 而非 `locale/change` 事件；字典并入 `locale/*.json` 顶层键组与 meta 键共存；反向断言门禁清单。
- **[architecture-refactor-experience.md](./architecture-refactor-experience.md)**：
  「入口大函数 到 深模块」重构通用经验——多实现漂移收成唯一真源 + 反向断言 + 锁定测试；用户可控枚举值写入状态前必须归一化（防垃圾态注入持久化）；HTTP 端点剥离纯工厂 + `Symbol.asyncIterator` 假 req + 普通对象假 res 单测（零为测试造抽象）；配置写盘字段级 merge 保留未知键、非法值拒绝写盘；孤儿函数全仓确认零调用再删并清理导出与记忆库；**Windows CRLF 文件编辑按行号切割替换**；**可失败自检与破坏实测的复用写法（接口即测试表面）**；**正则字符类要按真实数据域写，别抄模板**（`[w-]+` 匹配不到 kebab 名的教训、手写括号配平器零守卫陷阱）。
  2026-10-04 增补：**删除能力要同步所有对外承诺面（SKILL.md/README/客户端文案/locale/注释，CHANGELOG 历史不改）**；**门禁计数随环境（本机 85 / CI 84 类）文档要注明口径或直接不写数字**；**缓存收益要用 performance.now 实测裁决**（能省哪一步、量级、正确性代价三问）；**测试替身缺方法 = 生产防御必需，同一服务不同能力面（describe vs configure）分别探测不要收敛**；**文件级拆分判据 = 第二消费方 + 行为面已覆盖**（否则是纯位移的门禁盲区）。
- **[publish-npm-verification.md](./publish-npm-verification.md)**：
  发布验证通用经验——npm 镜像（npmmirror）会让 `npm view` 假阴性，直查官方 registry API 验 `versions` 与 `dist-tags.latest`；幂等发布「已发布跳过」只跳 npm 不跳 Release，需 `gh release view` 单独验证；tag 指向错误的修正流程（删 tag、补提交、重打、force push）；PowerShell 不支持 `&&` 的拼接坑；发布五步 checklist（bump、CHANGELOG、门禁、commit/tag/push、双真源验证）。
