---
name: dsh-plugin-dev
description: "Use when creating, modifying, reviewing, debugging, verifying, or releasing DeepSeek Harness (DSH) or Cordis plugins, including source verification against real DSH code, service injection, events, tools, guards, LLM adapters, dual-face UI, slots, schedules, agent teams, patches, bundles, isolated-instance acceptance, and hot/cold install validation."
---

# DSH 插件开发

面向 DSH/Cordis 插件开发、审查和排错的通用指南。具体 API、服务名、配置字段和版本行为必须以目标运行时、已安装包和可执行探针为准；本技能不替代官方类型声明。

## 第一道门：读源码，不读就不能写

**本技能库的正文是导航，不是答案。** 动手前必须完成三件事：

1. 确认目标运行时与版本（CLI 形态还是桌面版形态、哪个版本、哪个 profile）。
2. 按 [source-verification-and-caches.md](references/source-verification-and-caches.md) 的三层顺序打开真实源码：先 pnpm、再 npm、命中即停；本机安装的源码未混淆、读到了就不要解包桌面版；只有想看 TypeScript 原始写法才克隆云端上游仓库。
3. 把读到的契约写下来——包名、注入名、字段、返回结构、路径。

可失败检验：**能否指出某个契约出自哪个包的哪个文件。指不出来，就等于没读。**

## 先做什么

1. 明确插件形态：函数插件、工具插件、Service、LLM 适配器、双面 UI、Bundle，或它们的组合。
2. 列出必需依赖、可选依赖、外部资源和用户可见效果。
3. 为每个必需依赖找到真实提供方，并核对 `inject`、入口参数、生命周期和错误语义。
4. 先建立最小行为测试，再实现代码；测试应穿过公开接口或真实运行时 seam。
5. 把每个副作用放进可逆生命周期；验证激活、失效、卸载和重复激活。
6. 交付前在隔离新实例上验收：冷装、热装、热更新、卸载各过一遍，浏览器逐项点过并回读真值，模型由用户选定。

## 不可变原则

- **事实优先**：文档是线索，当前运行时行为、安装包源码/类型、官方上游源码和可复现实验才是证据；本技能库自身也属于线索级。
- **源码至上**：读参考文档只是起点。没有打开真实源码核对过的 API、字段与默认行为，不得进入实现。
- **验收隔离**：插件完成的标志是隔离新实例上四种安装形态全过且浏览器逐项回读真值，不是日常 profile 里能跑。
- **显式依赖**：必需服务通过正式注入表达；延迟查找只用于明确设计的可选能力，不能用来掩盖缺失依赖。
- **最小权限**：只声明真正需要的服务、插槽、文件能力和网络能力。
- **可逆副作用**：监听器、定时器、连接、注册、缓存、后台 Promise 都必须有 disposer、取消和错误处理。
- **取消穿透**：遍历、I/O、网络、工具执行和后台任务都要传递并检查取消信号。
- **事件不可猜测**：广播、串行、并行、瀑布和短路事件的等待、返回、错误和取消语义必须逐一核验。
- **跨端隔离**：Host、Browser 和隔离进程不是同一个运行面；只通过正式数据通道传递能力。
- **写入回读**：配置、UI、文件和发布操作都必须回读实际真值；点击、退出码或截图不能单独证明成功。
- **断言可失败**：每条重要门禁都要通过人为破坏证明它真的会失败，优先验证行为和产物而不是源码文本。
- **承诺同步**：删除或改名能力时，同步检查入口、文档、配置、导出、示例和发布物。
- **废弃不是删除**：配置字段废弃时保留 schema 声明与 volatile 标注，只在写入侧不再触碰它。删声明让用户历史配置被静默丢弃；去 volatile 标注会让清掉它的 unset 也被宿主写入闸门拒绝。详见 [config-field-lifecycle.md](references/config-field-lifecycle.md)。
- **先问哪一层**：构建期常量、编译期写死的清单、文档里的历史结论都会过期。真值在运行时响应、磁盘文件和源码里；三者对不上时先确认自己引的是哪一层。
- **门禁不写死会变的东西**：把具体版本号或阈值抄进门禁，等于每次变更都要改门禁本身，漏改即失效。断言应校验「几处一致」，不是「某处等于某字符串」。
- **分清静态与真机**：有一类门禁在原理上无法用静态断言覆盖——宿主运行时的语义闸门。写门禁前先对一遍 [host-semantic-gates.md](references/host-semantic-gates.md)，把真机项排进隔离实例验收，不要留在脚本里假装已覆盖。
- **先判能力再写方案**：需求是「同一份数据按调用方给出不同表现」时，先沿链路收敛——枚举全部消费方、追到投影函数的字段白名单、抄缓存键的构成维度、核对作用域参数。四条全过才有受支持路径；有一条不过就是上游数据模型不支持，此时该做的是选覆写路径并写清代价，而不是继续找写法。判定程序见 [shared-contract-capability-boundaries.md](references/shared-contract-capability-boundaries.md)。

## 场景路由

| 需求或症状 | 先读 |
| --- | --- |
| 服务注入、Service、PENDING、缺失依赖 | [services.md](references/services.md)、[plugin-anatomy.md](references/plugin-anatomy.md) |
| 监听器、定时器、异步任务、重载或卸载 | [events.md](references/events.md)、[plugin-anatomy.md](references/plugin-anatomy.md) |
| 动态目录、Provider、缓存、失效、重名 | [skill-provider.md](references/skill-provider.md)、[provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) |
| 设置面板、Web 插槽、Host/Client、UI 不显示 | [three-roles.md](references/three-roles.md)、[web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md)、[client-ui-placement-and-verification.md](references/client-ui-placement-and-verification.md) |
| 设置页 UI 怎么写（官方 SettingsForm / 草稿 / 冲突栅栏） | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) |
| 开关/单选不要保存按钮、改动自动生效 | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §八（操作即写） |
| 输入框上方浮层、双击手势、焦点留输入框、中文输入法组字 | [input-overlay-and-keyboard-gestures.md](references/input-overlay-and-keyboard-gestures.md)、[web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md) |
| 客户端没加载、注册 id 报错、改了代码不生效 | [client-bundle-loading-and-artifact-trace.md](references/client-bundle-loading-and-artifact-trace.md)、[silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md) |
| 不开浏览器回读配置/状态真值、写自动化验收 | [api-truth-read-back-without-browser.md](references/api-truth-read-back-without-browser.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| patch、Bundle、peer 依赖、打包、发布 | [config.md](references/config.md)、[packaging.md](references/packaging.md)、[install-resolution-traps.md](references/install-resolution-traps.md) |
| 面板点一下卡死 / 诊断段永久「不可用」/ 读不到命名空间 | [runtime-truth-and-external-contracts.md](references/runtime-truth-and-external-contracts.md)（信封未解包、命名空间未挂载）、[official-settings-form-pattern.md](references/official-settings-form-pattern.md)（注入面形状） |
| 卡片显示包名、中英界面标题不一致 | [settings-and-plugin-ui.md](references/settings-and-plugin-ui.md)（meta 段与面板键分工、中英同族） |
| schema 形态门禁从不红 / volatile 嵌套才在宿主炸 | [config.md](references/config.md)（嵌套位置限制、引用表形状）、[silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)（破坏实测） |
| 插件改 scoped 名、改名后多处对不上 | [packaging.md](references/packaging.md)（scoped 化六件套）、[config.md](references/config.md)（patch name 引号） |
| 搭 CI 流水线、tag 发版、npm 发布失败 | [ci-release-workflow.md](references/ci-release-workflow.md)、[publish-npm-verification.md](references/publish-npm-verification.md) |
| 没有报错但功能不生效 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| 点击按钮/开关毫无反应、表单静默失败、热重载后表单 disposed 假死 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[official-settings-form-pattern.md](references/official-settings-form-pattern.md) |
| 热重载/升级后报 scandir ENOENT、旧 pnpm 哈希路径丢失 | [install-resolution-traps.md](references/install-resolution-traps.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| volatile 字段拒写、联合字段设计、宿主端拿到引用包装需解包 | [config.md](references/config.md)、[settings-and-plugin-ui.md](references/settings-and-plugin-ui.md) |
| 卡片版本与面板版本不一致、客户端版本常量脱节漂移 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[client-bundle-loading-and-artifact-trace.md](references/client-bundle-loading-and-artifact-trace.md) |
| npm 发布后暂态 404/时延、E409 staged 冲突、线上产物 SHA256 验签 | [publish-npm-verification.md](references/publish-npm-verification.md)、[ci-release-workflow.md](references/ci-release-workflow.md) |
| 跨模块变更、能力删除、兼容迁移 | [cross-cutting-engineering-practices.md](references/cross-cutting-engineering-practices.md) |
| 具体 API 或版本结论无法确认 | 先查现有参考，再核对目标运行时和 [official-upstream-and-docs.md](references/official-upstream-and-docs.md) |
| 找不到本机源码、桌面版解包、上游克隆 | [source-verification-and-caches.md](references/source-verification-and-caches.md) |
| 插件写完了要验收、测安装卸载、跑浏览器验证 | [isolated-instance-acceptance.md](references/isolated-instance-acceptance.md)、[browser-automation-acceptance.md](references/browser-automation-acceptance.md) |
| 插件自带配置界面、Settings 命名空间、ConfigForms 生命周期 | [plugin-config-card-architecture.md](references/plugin-config-card-architecture.md)、[plugin-config-ui-decision.md](references/plugin-config-ui-decision.md) |
| **以下五类只在真机触发，静态断言原理上测不到** | [host-semantic-gates.md](references/host-semantic-gates.md)（先读这份清单再排期） |
| 新增/废弃/迁移配置字段，升级后用户配置丢失，写入被拒 | [config-field-lifecycle.md](references/config-field-lifecycle.md) |
| 迁移与回退兼容逻辑、归一化分支、幂等 | [config-field-migration-selfcheck.md](references/config-field-migration-selfcheck.md) |
| 静态门禁全绿但真机零作用，不知道哪些必须真机测 | [host-semantic-gates.md](references/host-semantic-gates.md) |
| 配置卡写入零生效、每点必报保存失败、整批被拒 | [host-semantic-gates.md](references/host-semantic-gates.md)、[config-field-lifecycle.md](references/config-field-lifecycle.md) |
| 热重载后旧页面写操作静默失效、控件可点但不生效 | [host-semantic-gates.md](references/host-semantic-gates.md)、[official-settings-form-pattern.md](references/official-settings-form-pattern.md) |
| 重复注入或卸载后仍有样式与监听残留 | [host-semantic-gates.md](references/host-semantic-gates.md)、[isolated-instance-acceptance.md](references/isolated-instance-acceptance.md) |
| 同层重名裁决顺序依赖、只做正向注册测不出 | [host-semantic-gates.md](references/host-semantic-gates.md)、[skill-provider.md](references/skill-provider.md) |
| 缓存失效后宿主目录没刷新，或界面已变而注册表未变 | [host-semantic-gates.md](references/host-semantic-gates.md)、[provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) |
| 改了客户端代码界面没变、版本号与界面不同步 | [host-semantic-gates.md](references/host-semantic-gates.md)、[client-ui-placement-and-verification.md](references/client-ui-placement-and-verification.md) |
| 同一面板在多处重复出现、DOM 计数不是 1 | [host-semantic-gates.md](references/host-semantic-gates.md)、[client-ui-placement-and-verification.md](references/client-ui-placement-and-verification.md) |
| 配置文档只读态下控件可点但写不进去 | [host-semantic-gates.md](references/host-semantic-gates.md)、[official-settings-form-pattern.md](references/official-settings-form-pattern.md) |
| 热装/卸载后卡片未出现、刷新过早假死、Chokidar 2s 防抖期等待、Windows EPERM 锁 | [isolated-instance-acceptance.md](references/isolated-instance-acceptance.md) |
| 裸 add 命令解析到远古旧版本、pnpm 冷却期版本回退陷阱 | [install-resolution-traps.md](references/install-resolution-traps.md) |
| 界面显示「数据不可用/请确认宿主版本」、宿主零报错、命名空间永不出现 | [runtime-truth-and-external-contracts.md](references/runtime-truth-and-external-contracts.md)（跨端命名空间需显式 $mount） |
| 改了配置项界面停在旧值、切换语言/模式后仍是构建期结果 | [runtime-truth-and-external-contracts.md](references/runtime-truth-and-external-contracts.md)（运行时推导值不得构建期内嵌） |
| 受控控件键盘不可达、指示器滑出轨道、「配过与没配过」不可区分 | [runtime-truth-and-external-contracts.md](references/runtime-truth-and-external-contracts.md)（值必须落在选项集合内、Schema 默认值吃掉三态） |
| 某段选项选过一次就消失、再也选不回来 | [runtime-truth-and-external-contracts.md](references/runtime-truth-and-external-contracts.md)（合法配置态常驻 vs 未配置标记条件追加，两者外观相同语义相反） |
| 同一个字段模型侧要英文、人类侧要按配置本地化，宿主改不动 | [shared-contract-capability-boundaries.md](references/shared-contract-capability-boundaries.md)（先判投影与缓存，再选覆写路径） |
| 想让模型/菜单拿到不同描述或不同精度，先判可行还是上游不支持 | [shared-contract-capability-boundaries.md](references/shared-contract-capability-boundaries.md)、[skill-provider.md](references/skill-provider.md) |
| 打算猴补官方对象、担心升级后静默失效 | [shared-contract-capability-boundaries.md](references/shared-contract-capability-boundaries.md)（三条失效形态与对应门禁）、[host-semantic-gates.md](references/host-semantic-gates.md) |
| 想少显示几条上游条目，动了可见性标志后主功能也坏了 | [shared-contract-capability-boundaries.md](references/shared-contract-capability-boundaries.md)（同一标志是否被多通路共用） |
| 包自带补丁 insert 格式规范、全新安装零配置自动渲染、界面写入自动持久化回写 | [plugin-config-card-architecture.md](references/plugin-config-card-architecture.md) |

已有专题参考仍按 [references/README.md](references/README.md) 索引；若通用参考与目标版本源码冲突，以源码和运行时为准。

## 最小验收闭环

- Host：入口可加载、必需依赖可用、注册数量正确、错误和取消语义可观察。
- 生命周期：失效后得到新状态；卸载后无监听、写入、广播或旧异步结果；重复激活不叠加资源。
- Browser：模块确实加载，插槽语义匹配，组件只消费 props，写操作后状态重新读取。
- 交付：构建产物可加载，tarball 文件完整，临时干净环境能安装并启动，发布后通过权威四件套核验（Tag、Release、npm dist-tags，以及真实 tarball 解包 SHA256 逐文件数字对齐）。
- 语义门禁：宿主写入闸门、注册表仲裁、缓存实时性、产物时序、生命周期残留、插槽注册、只读态逐条有真机判据。清单见 [host-semantic-gates.md](references/host-semantic-gates.md)，每条配一条破坏实验。
- 配置演进：字段新增（是否需要保留、是否三态）、废弃（两个标注都不动）、迁移（写新字段与清旧字段同批）三件事各有判据；迁移逻辑自带语义转换表穷举与幂等自检。
- 外部契约：跨端命名空间已显式挂载、运行时推导值走运行时通道、受控控件的值落在选项集合内、文档里的路径与层数与源码一致。清单见 runtime-truth-and-external-contracts。
- 隔离实例：只装基础插件与目标插件，冷装、热装、热更新、卸载四态各过一遍；浏览器里每项控件点过并回读真值；测试模型由用户选定。

## Anti-Patterns

- 凭记忆猜服务名、字段名、插槽名或事件返回值。
- 把 `ctx.get()` 当作必需注入的替代品。
- 只清理 watcher/定时器，却放任已启动的 Promise 继续写入。
- 把失效通知和刷新实现互相调用，形成递归或重复广播。
- 只看 DOM、截图、配置解析退出码或本地安装成功提示。
- 为单个调用方创建公开 adapter，或为已有深 module 再拆一层转发。
- 只读完本技能库就动手，把正文当 API 契约而不去核对真实源码。
- 在自己日常 profile 上验证通过就宣称功能可用，没开隔离新实例、没测热装冷装卸载。
- 在表单异步交互中仅捕获异常而未在 UI 对应区域显式渲染失败状态，造成假死无响应的静默失败。
- 插件热重载后不刷新页面，直接在持有已废弃（disposed）旧表单实例的前端闭包中测试异步写入。
- 误以为热安装必须由用户手动往 profile 补丁追加顶层条目，忽略了纯 `insert:` overlay 的自生挂载机制与宿主自动持久化回写闭环。
- 假设跨端 RPC 的命名空间「服务端暴露了就自动通了」，不读网关客户端那份编译期写死的贡献清单。
- 把随用户可改配置变化的推导值在构建期算好内嵌进客户端产物，让切换配置后界面停在旧值。
- 为了表达「未配置」而把受控控件的 `value` 设成不在选项集合里的值——下标越界会让全部段键盘不可达。
- 在 CLI 安装或修改配置后，未等待宿主文件监听器防抖期（Chokidar `awaitWriteFinish` 2s）便立即判定热重载失效并误判必须重启宿主。
- 废弃配置字段时删掉它的 schema 声明，或为「不再写入」去掉 volatile 标注。
- 把「写新字段」与「清旧字段」拆成多次提交，或在迁移批里混入未通过 volatile 校验的路径——前者在并发下留下半迁移态，后者让整批零写入。
- 迁移逻辑的测试样例与实现分支来自同一个直觉，于是测试只证明代码跑过，不证明读的是对的那张表。
- 用接口的成功返回值当成功判据。返回 false 与返回 true 都不告诉你失败发生在哪一层；判据必须是可观察的状态转移。
- 只写「不报错就不算错」的正向断言。漏掉一个测试场景这件事破坏实测抓不到，只能靠先写下来的语义转换表。
- 用「按类型取第一个匹配」当测试锚点。同类元素多于一种时，断言会稳定测错对象并且一直绿，破坏实测也只证明了别的控件是对的。
- 把「未配置」这类状态标记段与合法配置态混为一谈，照抄相邻控件的条件追加写法——用户选过一次后该状态永久不可达。
- 凭直觉认为「把双语字段挂进 metadata 就能给人类侧留通道」，不去读投影函数与跨端结果 schema 的字段白名单——字段可能早在摘要那一步就没被拷走，或者根本过不了线缆。
- 拿一个改不动的上游字段去做「按调用方差异化」的需求，写完方案才发现投影与缓存那一层已经把信息抹掉了；判定程序见 shared-contract-capability-boundaries.md。
- 为了让上游少显示自己的条目去改可见性标志，没先确认该标志是否被上游多个通路共用，结果连带砍掉主功能。
- 选中运行时改写上游对象之后不把失效形态与升级核对清单写进项目记忆库，让它变成没人复查的暗债。
