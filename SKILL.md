---
name: dsh-plugin-dev
description: DeepSeek Harness (DSH) 插件开发通用指南。覆盖插件形态选择、Cordis 依赖注入、生命周期管理、双面 UI（Host/Browser）通信、配置自愈、工具扩展、隔离实例验收与无版本绑定的工程法则。
---

# DeepSeek Harness (DSH) 插件开发通用指南

面向任何 DSH/Cordis 版本的插件开发规范与架构指引。具体 API、服务名、配置项与版本行为必须以目标运行时的真实源码、类型声明及运行探针为准。本指南不替代运行时代码。

## 第一道门：读源码，不读就不能写

任何插件开发或维护，必须先按以下三层顺序查证目标运行时的真实实现，严禁凭记忆猜测：
1. **本机已安装源码**：优先检索全局/本地依赖中的目标包（`lib/types/*.d.ts` 查契约，`lib/index.js` 查实现）；
2. **桌面版运行时解包**：若无源码，通过解包工具分析运行时包体；
3. **官方仓库检出**：仅在本地缺失时拉取对应版本的官方仓库。
**可失败检验**：写下代码前，必须能明确指出所依赖接口出自目标包的哪个文件与具体导出。详见 [references/source-verification-and-caches.md](references/source-verification-and-caches.md)。

## 开工五步法

1. **确立插件形态**：依据职责选择 Service 扩展、Tool 工具、Event 监听器、双面 UI 组件或复合 Bundle。详见 [references/plugin-anatomy.md](references/plugin-anatomy.md)。
2. **声明显式依赖**：严格核对 `inject` 服务列表及其单复数约定，缺失依赖坚决不上线。详见 [references/services.md](references/services.md)。
3. **约束可逆生命周期**：所有副作用（事件监听、DOM 挂载、定时器、全局补丁）必须登记对应的清理回收句柄（Disposer）。详见 [references/lifecycle.md](references/lifecycle.md)。
4. **先行为断言后实现**：为核心逻辑编写可失败的轻量验证脚本，先证明预期状态再投入业务编写。
5. **隔离实例四态验收**：在新 profile 隔离实例下验证冷启动、热加载、配置热更新、完整卸载四种状态。详见 [references/isolated-instance-acceptance.md](references/isolated-instance-acceptance.md)。

## 不可变工程原则

1. **源码至上**：真实运行时代码行为 > 打包产物/JSDoc > 官方文档叙述 > 社区文章 > 本技能库文本。
2. **显式依赖与单复数铁律**：服务的注册名与消费名必须完全匹配，不得混淆单复数。详见 [references/services.md](references/services.md)。
3. **生命周期 100% 深度可逆**：拦截宿主行为必须支持无痕卸载，卸载后宿主环境行为与状态完全还原。详见 [references/lifecycle.md](references/lifecycle.md)。
4. **跨端物理隔离**：严禁在 Browser 端直接调用 Node 原生模块；严禁将 Host Context 泄露给前端组件。详见 [references/three-roles.md](references/three-roles.md)。
5. **事件流严格可观测**：不假设事件派发时序，关键流程必须具备取消信号感知与传递能力。详见 [references/events.md](references/events.md)。
6. **配置渐进兼容与自愈**：Schema 演进严禁引入破坏性必填字段，配置读写必须具备结构自愈与校验能力。详见 [references/config.md](references/config.md)。
7. **先状态后症状**：排查故障前必须先核验进程树、端口占用、真实写盘路径与加载状态。详见 [references/debugging.md](references/debugging.md)。
8. **原子化与幂等操作**：状态修改采用先备份后原子替换，写入后立即回读验证落盘真值。详见 [references/storage-terminals-and-checkpoints.md](references/storage-terminals-and-checkpoints.md)。
9. **深模块设计 (Deep Module)**：对外暴露最简洁的接口，把复杂的平台差异和多版本兼容隐藏在内部。详见 [references/architecture-refactor-experience.md](references/architecture-refactor-experience.md)。
10. **简洁优先 (YAGNI)**：拒绝未被要求的抽象和层级，标准库与平台原生能力优先，消除冗余样板。

## 场景速查路由表

| 开发或排查场景 | 核心指引与机制参考 |
| :--- | :--- |
| 插件骨架搭建 / 形态选型 / 入口导出 | [plugin-anatomy.md](references/plugin-anatomy.md) · [desktop-vs-cli.md](references/desktop-vs-cli.md) |
| 服务注册 / 依赖注入 / 单复数契约 | [services.md](references/services.md) · [cordis-core.md](references/cordis-core.md) |
| 生命周期钩子 / 猴子补丁 / 卸载清理 | [lifecycle.md](references/lifecycle.md) · [deep-refactoring-governance.md](references/deep-refactoring-governance.md) |
| 前端 UI 插槽 / 状态管理 / 样式隔离 | [web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md) · [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) |
| 跨进程通信 (RPC) / 前后端消息分发 | [remote-rpc.md](references/remote-rpc.md) · [three-roles.md](references/three-roles.md) |
| 工具函数 / Slash Commands / 终端集成 | [tools.md](references/tools.md) · [slash-commands.md](references/slash-commands.md) · [persistent-shells-and-observation-policy.md](references/persistent-shells-and-observation-policy.md) |
| 配置 Schema / 动态表单 / 原子写盘 | [config.md](references/config.md) · [official-settings-form-pattern.md](references/official-settings-form-pattern.md) · [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) |
| 插件打包 / 依赖解析 / 产物分发 | [packaging.md](references/packaging.md) · [install-resolution-traps.md](references/install-resolution-traps.md) · [release-verification.md](references/release-verification.md) |
| 多智能体协作 / 任务规划与审核 | [agent-teams-architecture.md](references/agent-teams-architecture.md) · [plan-mode-and-user-review-gate.md](references/plan-mode-and-user-review-gate.md) · [goal-driven-system.md](references/goal-driven-system.md) |
| 故障排查 / 挂起调试 / 静默失效定位 | [debugging.md](references/debugging.md) · [silent-failures.md](references/silent-failures.md) · [reproduction-experiment-design.md](references/reproduction-experiment-design.md) |
| 交付验收 / 隔离环境实测 / 浏览器自动化 | [isolated-instance-acceptance.md](references/isolated-instance-acceptance.md) · [browser-automation.md](references/browser-automation.md) |

## 最小验收闭环

- **宿主状态**：进程无僵尸挂起，退出码合规，标准错误流无未捕获异常。
- **生命周期**：多次热重载与卸载后，内存无泄漏，未遗留全局事件监听器或悬挂定时器。
- **配置一致**：配置修改落盘文件与界面状态实时同步，无效输入自动回退安全默认值。
- **环境隔离**：在全新的独立 profile 目录中从零安装，验证首次引导、运行交互与持久化无断层。

## 高危反模式 (Anti-Patterns)

- [错误] 凭历史文档或记忆硬编码 API 字段与内部方法名，不查证真实安装包源码。
- [错误] 在共享的日常开发 profile 中直接调试安装，污染全局配置导致验收假绿。
- [错误] 劫持宿主原型方法而不保存原始引用，卸载时留下永久性全局行为污染。
- [错误] 在事件回调或异步流中吞并取消信号（AbortSignal），导致长时间任务失控无法中止。
- [错误] 在前端 React/DOM 树中直接引用 Host 端专有环境接口，触发跨端运行时崩溃。
- [错误] 假设服务总是同步就绪，在 `apply` 阶段直接调用尚未注入完毕的依赖方法。
- [错误] 配置项直接覆写磁盘而不校验合法性，导致配置损坏无法自愈。
- [错误] 为一次性简单逻辑堆砌多层抽象与工厂封装，破坏代码可读性与维护性。
- [错误] 在通用文档与规范中写死特定小版本号，导致版本迭代后产生误导性知识漂移。

---
*注：全库所有详细专题见 [references/README.md](references/README.md)。任何描述与目标运行时的源码冲突时，一律以真实源码为准。*
