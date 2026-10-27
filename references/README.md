# DSH 插件开发技术参考目录

## 通用经验优先

新插件先读以下通用专题；它们只描述跨版本可迁移的机制和验证判据，不承载特定版本的包名、路径或单次事故叙述。

### 核心架构专项指南
- [agent-teams-architecture.md](./agent-teams-architecture.md)：多智能体团队协作架构、成员状态机、点对点通信、任务看板 DAG 编排与写作用域冲突回读。
- [plan-mode-and-user-review-gate.md](./plan-mode-and-user-review-gate.md)：计划模式与用户审批闸门、探索期只读执行纪律与单一交付工具交互契约。
- [goal-driven-system.md](./goal-driven-system.md)：自主长程目标驱动系统、生命周期状态机、跨轮次自动推进与持久阻塞判定准则。
- [session-format-v4-and-migration.md](./session-format-v4-and-migration.md)：会话格式演进与确定性迁移管道、Prompt Cache 前缀一致性保全与全文索引接缝。
- [persistent-shells-and-observation-policy.md](./persistent-shells-and-observation-policy.md)：持续终端 (PTY) 会话保全、资源对称清理与强一致文件观察策略守卫。

**动手前的第一道门**：本目录所有正文均属线索级材料，任何 API、字段与默认行为都必须回到目标运行时的真实源码核对。详见 [source-verification-and-caches.md](./source-verification-and-caches.md)。

**交付前的最后一道门**：功能写完不等于可用，必须在隔离新实例上完成冷启动、热加载、配置热更新、卸载四态验收。详见 [isolated-instance-acceptance.md](./isolated-instance-acceptance.md)。

**改完必查的环境常见陷阱**：
1. 声明缺失排查：确认类型声明与符号链接路径完整（详见 [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)）。
2. 残留进程干扰：端口联调异常优先核验后台残留进程的启动时间与真实加载产物（详见 [api-truth-read-back-without-browser.md](./api-truth-read-back-without-browser.md)）。
3. 官方源发布真值：验证发布状态直查官方源，规避本地缓存与镜像时延假阴性（详见 [publish-npm-verification.md](./publish-npm-verification.md)）。
4. 约束模式表达：数字与非负整数配置字段严格核对验证器定义（详见 [config.md](./config.md)）。

---

## 核心架构与分类专题索引

### 一、源码核验与上游依据
- [source-verification-and-caches.md](./source-verification-and-caches.md)：三层源码核验路径（本机安装 -> 运行时解包 -> 官方仓库）、契约速查与缓存约定。
- [official-upstream-and-docs.md](./official-upstream-and-docs.md)：上游包清单、模块依赖树、类型声明阅读法与事实核验优先级。
- [runtime-truth-and-external-contracts.md](./runtime-truth-and-external-contracts.md)：假来源辨识、运行时真值取证位置与跨端数据契约。
- [shared-contract-capability-boundaries.md](./shared-contract-capability-boundaries.md)：上游数据模型能力边界收敛、覆写代价与判定门禁。

### 二、微内核、依赖注入与生命周期
- [cordis-context-internals.md](./cordis-context-internals.md)：微内核作用域物理隔离槽、动态拦截代理与跨 Realm 符号校验。
- [dependency-injection.md](./dependency-injection.md)：显式依赖声明、服务契约、缺失依赖快速失败。
- [services.md](./services.md)：核心服务单复数命名铁律、注入契约与生命周期对齐。
- [lifecycle.md](./lifecycle.md)：深度可逆生命周期、副作用 Disposer 栈管理、异步取消与卸载时序。
- [deep-lifecycle-overlay-and-coordinator-patterns.md](./deep-lifecycle-overlay-and-coordinator-patterns.md)：深度安全猴补、交互浮层解耦与 Coordinator 调度规范。
- [discovery-cache-invalidation.md](./discovery-cache-invalidation.md)：动态插件发现、缓存分层结构与失效传播链。

### 三、插件形态、扩展能力与集成
- [plugin-anatomy.md](./plugin-anatomy.md)：插件标准骨架、模块导出规范与形态选型。
- [desktop-vs-cli-runtime.md](./desktop-vs-cli-runtime.md)：桌面版与 CLI 运行时环境差异、能力边界与条件适配。
- [tools.md](./tools.md)：工具函数定义、参数严格 Codec、返回值规范与错误捕获。
- [slash-commands-and-input-triggers.md](./slash-commands-and-input-triggers.md)：快捷指令注册、输入前缀解析与触发时序。
- [builtin-enhancements-and-middleware.md](./builtin-enhancements-and-middleware.md)：内置能力增强、中间件管道设计与无侵入切面。
- [skill-provider.md](./skill-provider.md)：技能提供者注册、动态目录刷新与生命周期对接。
- [provider-catalog-invalidation.md](./provider-catalog-invalidation.md)：技能目录动态失效、重入屏障与零磁盘 I/O 刷新机制。
- [mcp-and-tools-bridge.md](./mcp-and-tools-bridge.md)：MCP 协议集成、外部工具桥接与上下文注入。
- [llm-adapter.md](./llm-adapter.md)：大模型适配层、请求信封构建与流式事件转换。
- [multimodal-and-deliverables.md](./multimodal-and-deliverables.md)：多模态资源呈现、交付物卡片展示与文件打开能力。
- [webhook-headless-and-workflows.md](./webhook-headless-and-workflows.md)：无头工作流调度、Webhook 监听触发与脱机执行。

### 四、双面 UI 与跨进程通信
- [three-roles.md](./three-roles.md)：Host、Browser 与隔离进程三角色物理拓扑及安全边界。
- [dual-face-ui.md](./dual-face-ui.md)：双面插件通信流、前后端数据同步与真实界面验收。
- [remote-rpc-guide.md](./remote-rpc-guide.md)：远程调用协议规范、报文信封结构与超时重试策略。
- [web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)：前端界面插槽注册、样式作用域隔离与暗色模式适配。
- [input-overlay-and-keyboard-gestures.md](./input-overlay-and-keyboard-gestures.md)：纯 DOM 交互浮层、键盘手势拦截与宿主状态协调。
- [client-controller-architecture-and-headless-testing.md](./client-controller-architecture-and-headless-testing.md)：客户端状态机解耦、原子状态更新与轻量单测实践。
- [client-bundle-loading-and-artifact-trace.md](./client-bundle-loading-and-artifact-trace.md)：客户端产物动态加载、资源溯源与构建分块。
- [client-ui-placement-and-verification.md](./client-ui-placement-and-verification.md)：UI 挂载锚点选择、生命周期渲染门禁与挂载失败自愈。
- [client-i18n-pitfalls.md](./client-i18n-pitfalls.md)：多语言国际化字典构建、动态刷新与边界兜底。

### 五、配置管理、持久化与弹性
- [config.md](./config.md)：配置 Schema 声明、类型约束、动态表单生成与默认值防护。
- [official-settings-form-pattern.md](./official-settings-form-pattern.md)：官方设置表单接入、动态校验与受控组件最佳实践。
- [plugin-config-card-architecture.md](./plugin-config-card-architecture.md)：独立插件配置卡片布局、组件解耦与持久层桥接。
- [plugin-config-ui-decision.md](./plugin-config-ui-decision.md)：配置界面架构选型（内置表单 vs 扩展插槽）。
- [settings-and-plugin-ui.md](./settings-and-plugin-ui.md)：全局设置中心与插件专属面板的数据流动与隔离。
- [config-field-lifecycle.md](./config-field-lifecycle.md)：字段演进周期、平滑废弃策略与多版本迁移。
- [config-field-migration-selfcheck.md](./config-field-migration-selfcheck.md)：配置迁移逻辑自检规范、双向映射断言与幂等验证。
- [config-resilience-and-atomic-self-healing.md](./config-resilience-and-atomic-self-healing.md)：原子写盘防损坏、启发式配置抢救与内存自愈闭环。
- [storage-terminals-and-checkpoints.md](./storage-terminals-and-checkpoints.md)：持久化存储端点、检查点快照与落盘真值校验。

### 六、系统提示词、会话与多智能体
- [system-prompt-and-projections.md](./system-prompt-and-projections.md)：系统提示词动态投影、切片注入与角色分发。
- [session-prompt-cache-and-catalog-update.md](./session-prompt-cache-and-catalog-update.md)：增量消息注入、Prompt Cache 命中优化与前缀保全。
- [subagents-fs-policy-and-acp.md](./subagents-fs-policy-and-acp.md)：子智能体上下文管理、文件访问策略约束与权限收敛。
- [events.md](./events.md)：事件生命周期、派发时序保证与跨模块总线解耦。

### 七、沙箱安全与系统级约束
- [sandbox-internals-and-proxy.md](./sandbox-internals-and-proxy.md)：沙箱隔离机制、文件系统策略拦截与代理安全防护。
- [sandbox-process-and-pipe-traps.md](./sandbox-process-and-pipe-traps.md)：沙箱环境进程受限排查与脱机安全执行。
- [host-semantic-gates.md](./host-semantic-gates.md)：宿主语义门禁、插件元信息与静态不可测特征真机验收。

### 八、调试诊断与故障排查
- [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)：综合排查工作流、环境诊断与状态机追踪。
- [silent-failure-debugging.md](./silent-failure-debugging.md)：零报错异常定位、调用链路断点与边界判定。
- [silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)：静默失败防御性设计、断言门禁与自动上报机制。
- [reproduction-experiment-design.md](./reproduction-experiment-design.md)：故障复现实验设计、单一变量对照与事故提炼四段式。
- [field-experience-extraction.md](./field-experience-extraction.md)：实战通用经验深挖、写接口防御、只读选择语义与惰性创建、路径层级陷阱、客户端状态闭环与装配真值判据。

### 九、打包、分发与验收交付
- [packaging.md](./packaging.md)：插件规范打包、目录布局约束与最小发布集。
- [install-resolution-traps.md](./install-resolution-traps.md)：包依赖解析策略、版本兼容性区间判定与热安装避坑。
- [patch-packaging-release.md](./patch-packaging-release.md)：补丁生成、动态组装、发布链路与环境适配。
- [ci-release-workflow.md](./ci-release-workflow.md)：自动化 CI 检查、构建发布流水线与质量守卫。
- [publish-npm-verification.md](./publish-npm-verification.md)：发布真值校验、标签强绑定与分发时延轮询。
- [isolated-instance-acceptance.md](./isolated-instance-acceptance.md)：独立 profile 实例隔离验收、四态安装测试与环境复现。
- [browser-automation-acceptance.md](./browser-automation-acceptance.md)：真实浏览器交互回读、自动化脚本验收与 UI 状态断言。
- [api-truth-read-back-without-browser.md](./api-truth-read-back-without-browser.md)：脱机接口真值回读、通信握手与原子操作校验。

### 十、工程治理与通用实践
- [architecture-refactor-experience.md](./architecture-refactor-experience.md)：状态跃迁事务设计、依赖消环与原子归一化消除。
- [deep-refactor-and-governance-hardening.md](./deep-refactor-and-governance-hardening.md)：工程重构规范、构建时序验证与 YAGNI 简化治理。
- [cross-cutting-engineering-practices.md](./cross-cutting-engineering-practices.md)：横切工程准则、深模块化原则与长期维护纪律。
- [community-patterns.md](./community-patterns.md)：生态社区优秀插件模式提炼与反模式借鉴。

---
*注：通用专题与目标运行时冲突时，一律以目标环境源码与真实探针为准。详细源码核验流程见各专题篇末。*