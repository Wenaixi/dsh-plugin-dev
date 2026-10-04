---
name: dsh-plugin-dev
description: "Use when creating, modifying, reviewing, or debugging DeepSeek Harness (DSH) or Cordis plugins, including service injection, events, tools, guards, LLM adapters, dual-face UI, slots, schedules, agent teams, patches, bundles, and plugin release validation."
---

# DSH 插件开发

面向 DSH/Cordis 插件开发、审查和排错的通用指南。具体 API、服务名、配置字段和版本行为必须以目标运行时、已安装包和可执行探针为准；本技能不替代官方类型声明。

## 先做什么

1. 明确插件形态：函数插件、工具插件、Service、LLM 适配器、双面 UI、Bundle，或它们的组合。
2. 列出必需依赖、可选依赖、外部资源和用户可见效果。
3. 为每个必需依赖找到真实提供方，并核对 `inject`、入口参数、生命周期和错误语义。
4. 先建立最小行为测试，再实现代码；测试应穿过公开接口或真实运行时 seam。
5. 把每个副作用放进可逆生命周期；验证激活、失效、卸载和重复激活。
6. 从构建产物、实际 tarball 和目标运行时分别验证，不把局部通过当成最终成功。

## 不可变原则

- **事实优先**：文档是线索，当前运行时行为、安装包源码/类型、官方上游源码和可复现实验才是证据。
- **显式依赖**：必需服务通过正式注入表达；延迟查找只用于明确设计的可选能力，不能用来掩盖缺失依赖。
- **最小权限**：只声明真正需要的服务、插槽、文件能力和网络能力。
- **可逆副作用**：监听器、定时器、连接、注册、缓存、后台 Promise 都必须有 disposer、取消和错误处理。
- **取消穿透**：遍历、I/O、网络、工具执行和后台任务都要传递并检查取消信号。
- **事件不可猜测**：广播、串行、并行、瀑布和短路事件的等待、返回、错误和取消语义必须逐一核验。
- **跨端隔离**：Host、Browser 和隔离进程不是同一个运行面；只通过正式数据通道传递能力。
- **写入回读**：配置、UI、文件和发布操作都必须回读实际真值；点击、退出码或截图不能单独证明成功。
- **断言可失败**：每条重要门禁都要通过人为破坏证明它真的会失败，优先验证行为和产物而不是源码文本。
- **承诺同步**：删除或改名能力时，同步检查入口、文档、配置、导出、示例和发布物。

## 场景路由

| 需求或症状 | 先读 |
| --- | --- |
| 服务注入、Service、PENDING、缺失依赖 | [services.md](references/services.md)、[plugin-anatomy.md](references/plugin-anatomy.md) |
| 监听器、定时器、异步任务、重载或卸载 | [events.md](references/events.md)、[plugin-anatomy.md](references/plugin-anatomy.md) |
| 动态目录、Provider、缓存、失效、重名 | [skill-provider.md](references/skill-provider.md)、[provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) |
| 设置面板、Web 插槽、Host/Client、UI 不显示 | [three-roles.md](references/three-roles.md)、[web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md)、[client-ui-placement-and-verification.md](references/client-ui-placement-and-verification.md) |
| patch、Bundle、peer 依赖、打包、发布 | [config.md](references/config.md)、[packaging.md](references/packaging.md)、[install-resolution-traps.md](references/install-resolution-traps.md) |
| 没有报错但功能不生效 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| 跨模块变更、能力删除、兼容迁移 | [cross-cutting-engineering-practices.md](references/cross-cutting-engineering-practices.md) |
| 具体 API 或版本结论无法确认 | 先查现有参考，再核对目标运行时和 [official-upstream-and-docs.md](references/official-upstream-and-docs.md) |

已有专题参考仍按 [references/README.md](references/README.md) 索引；若通用参考与目标版本源码冲突，以源码和运行时为准。

## 最小验收闭环

- Host：入口可加载、必需依赖可用、注册数量正确、错误和取消语义可观察。
- 生命周期：失效后得到新状态；卸载后无监听、写入、广播或旧异步结果；重复激活不叠加资源。
- Browser：模块确实加载，插槽语义匹配，组件只消费 props，写操作后状态重新读取。
- 交付：构建产物可加载，tarball 文件完整，临时干净环境能安装并启动，发布后从外部真源核对版本和内容。

## Anti-Patterns

- 凭记忆猜服务名、字段名、插槽名或事件返回值。
- 把 `ctx.get()` 当作必需注入的替代品。
- 只清理 watcher/定时器，却放任已启动的 Promise 继续写入。
- 把失效通知和刷新实现互相调用，形成递归或重复广播。
- 只看 DOM、截图、配置解析退出码或本地安装成功提示。
- 为单个调用方创建公开 adapter，或为已有深 module 再拆一层转发。
