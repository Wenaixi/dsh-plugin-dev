# DSH 插件开发技术参考目录

## 通用经验优先

新插件先读以下通用专题；它们只描述可迁移的机制和验证判据，不承载任何单一仓库的包名、版本、路径或事故叙述。

**动手前的第一道门**：本目录所有正文都属于线索级材料，任何 API、字段与默认行为都必须再回到真实源码核对。流程见 [source-verification-and-caches.md](./source-verification-and-caches.md)。

**交付前的最后一道门**：功能写完不等于可用，必须在隔离新实例上完成四态安装与浏览器逐项验证。流程见 [isolated-instance-acceptance.md](./isolated-instance-acceptance.md)。

**改完必查的环境四坑**（详见各专题，先对一遍再动手）：
1. `node_modules/@types` 顶层缺失会让 tsc 报「找不到 react 声明 / JSX namespace」——按包用 `cmd mklink /J` 补 junction（见 [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md) 开头）；
2. 固定端口联调时「改了没生效」先核对监听进程的 `StartTime`，旧实例残留会让一切回读都拿到旧 schema/旧产物（见 [api-truth-read-back-without-browser.md](./api-truth-read-back-without-browser.md)）；
3. 发布验证直查官方源要用 `curl.exe --noproxy '*'`，`npm view` 与 `Invoke-RestMethod` 都会吃镜像/代理假阴性，发布后 1~2 分钟 propagation 时延内别重发同版本（见 [publish-npm-verification.md](./publish-npm-verification.md)）；
4. 非负整数配置字段用 schemastery 的 `z.natural()`，没有 `z.number().integer()`（见 [config.md](./config.md) §7.8）。

- [source-verification-and-caches.md](./source-verification-and-caches.md)：源码至上的三层来源（本机安装先 pnpm 后 npm、命中即停且未混淆不必解包 / 桌面版解包 / 上游仓库）、`lib/types/*.d.ts` 优先于读实现的阅读入口、pnpm isolated 目录名转义、跨平台定位、缓存目录约定与冲突裁决顺序。
- [isolated-instance-acceptance.md](./isolated-instance-acceptance.md)：隔离新实例的创建与配置复用、四种安装形态、浏览器逐项验证、模型选择与 debug 循环；本地源码联调必须手工建指向仓库根的目录联接，不跑 `pnpm install`。
- [reproduction-experiment-design.md](./reproduction-experiment-design.md)：复现实验设计——症状与状态分别取证、冷热态前置条件、对照组（只变一个变量）、断言锚点选择（不按类型取第一个、不用文本匹配）、环境不稳定与产品缺陷的区分、产物遗留物与文档口径漂移，以及把单次事故沉淀成可迁移规则的四段式。
- [dependency-injection.md](./dependency-injection.md)：显式依赖、服务契约和缺失依赖。
- [lifecycle.md](./lifecycle.md)：可逆副作用、异步取消和卸载竞态。
- [discovery-cache-invalidation.md](./discovery-cache-invalidation.md)：动态发现、缓存分层和失效传播。
- [dual-face-ui.md](./dual-face-ui.md)：Host/Browser 数据流、插槽和真实 UI 验收。
- [patch-packaging-release.md](./patch-packaging-release.md)：补丁、构建、打包、安装和发布真值。
- [silent-failure-debugging.md](./silent-failure-debugging.md)：零报错失效的证据驱动排查。
- [host-semantic-gates.md](./host-semantic-gates.md)：静态断言测不到的宿主语义门禁清单——写入闸门、表单处置态、注册表仲裁、缓存失效实时性、产物缓存时序、生命周期、插槽静默注册、只读态；附真机判据的组织方式与验收矩阵。
- [runtime-truth-and-external-contracts.md](./runtime-truth-and-external-contracts.md)：七类假来源（构建期常量、编译期写死清单、Schema 默认值、受控控件隐式下标、文档历史结论、形状错误的 schema 门禁、未解包的远程返回值）与各自的运行时真值取证位置；跨端命名空间显式挂载、codec 契约的实际宽度、远程返回值的信封形状与失败双形态、描述长度上限来自宿主配置、配置归属维度、卸载与更新的逐项覆盖面；**受控控件的选项集合跨配置状态必须恒定**（条件追加会让用户选过一次后该状态不可达；「合法配置态」与「未配置标记」两类段外观相同语义相反，不能照抄相邻控件写法）。
- [config-field-lifecycle.md](./config-field-lifecycle.md)：配置字段的新增（三态表达、volatile 与否）、废弃（声明与 volatile 标注两个都不能动）、迁移（启动期/惰性/只读兼容三选一）与批次失败范围；**集合/字典型字段惰性迁移的局部操作陷阱与原子继承（Atomic Carryover）**——单开关操作时必须将旧表中其余有效项一同作为 set 带入新表，杜绝历史配置被意外物理抹除与技能意外复活。
- [config-field-migration-selfcheck.md](./config-field-migration-selfcheck.md)：迁移逻辑的自检写法——语义转换表穷举、新旧优先双向断言、幂等断言、批次形状自检、负向样例，以及「漏了一个场景」为何破坏实测抓不到。
- [client-i18n-pitfalls.md](./client-i18n-pitfalls.md)：客户端双语字典与构建产物的九条铁律——键成对性、纯数据无 t()、构建期内嵌字面量、即时刷新、meta 键共存、**三态字段缺项折叠陷阱（undefined 必须保留）**、**分段选择器 SegmentedControl 合法配置态常驻 vs 未设置占位段**，以及**控件作用域的显式标题与详细指引**。
- [provider-catalog-invalidation.md](./provider-catalog-invalidation.md)：动态技能目录失效机制——`skills/change` 递归反模式、闭包捕获实例、**宿主跨 Fiber 全局配置变更（如界面语言）收敛点 `app-boot/config-reload`**、**异步扫描 In-Flight 并发重入屏障 `scanPromise`**，以及**呈现投影变动与物理文件变动解耦（零磁盘 I/O 刷新）**。
- [session-prompt-cache-and-catalog-update.md](./session-prompt-cache-and-catalog-update.md)：已存在会话条目更新机制与大模型 Prompt Cache 保全原理——会话级增量消息注入、历史事件一字不动保全前缀缓存、极限全关降级提示词。
- [sandbox-process-and-pipe-traps.md](./sandbox-process-and-pipe-traps.md)：Windows 沙箱环境下子进程命名管道受限 EPERM 陷阱与 node:vm 纯内存语法校验实践。
- [client-controller-architecture-and-headless-testing.md](./client-controller-architecture-and-headless-testing.md)：双面客户端控制器深度架构与 node:vm 脱机纯内存状态机单测实践——消除多参数提交泥球、PanelController 深度抽象、单次原子 mutate 批处理、React 18 `useSyncExternalStore` 零撕裂渲染、以及在无真实浏览器环境下 50ms 极速覆盖全量状态机用例。
- [shared-contract-capability-boundaries.md](./shared-contract-capability-boundaries.md)：当「同一个数据要按调用方给出不同表现」的需求撞上一个改不动的上游时，先沿链路收敛——枚举全部消费方、追到投影函数的字段白名单、抄缓存键的构成维度、核对作用域参数能否区分调用方。四条全过才有受支持路径；不过就是上游数据模型不支持。不可行时的三条覆写路径（接受同源 / 并列注册 / 运行时改写上游对象）各自的代价、失效形态与门禁写法，含「为省条目而改可见性标志会砍掉主功能」这一常见否决项。
- [config-resilience-and-atomic-self-healing.md](./config-resilience-and-atomic-self-healing.md)：配置韧性、多阶损坏提取与崩溃安全自愈架构——物理崩溃安全原子写盘（Temp + Atomic Rename）、双阶启发式抢救提取流水线（语法修补与字段级模式深度提取）、**YAML 补丁与组合层 (Bundle Patch) 的物理损坏提取与行级状态机抢救**、**截断写入引发的「Null 毒丸」伪正常解析防御**、**运行时内存配置深度体检与宿主持久层 (Settings) 自愈闭环**、**配置重生成时的反引号嵌套与转义陷阱**、**双面客户端 (Client UI) 防崩与防白屏契约**、现场留样备份轮转与破坏注入测试设计范式。
- [deep-refactor-and-governance-hardening.md](./deep-refactor-and-governance-hardening.md)：深度重构、构建流水线原子时序与工程治理严密化指南——构建时序先验后写（Validate-Before-Write，杜绝脏产物落盘污染）、TypeScript 编译器死代码零容忍与导入重导出分离架构（解除 noUnusedLocals 约束）、发版 Tag 指针漂移陷阱与标准纠偏四步序列、以及插件私有复杂度的 YAGNI 裁决与浅模块过度抽象警惕。

通用专题与具体版本资料冲突时，以目标运行时和源码为准。**每篇专题末尾都有「相关 DSH 源码」清单**，列出上游仓库相对路径与版本号，版本升级后必须重新读源码核对。

> **核心定位声明**
> **本目录是用于辅助开发 DeepSeek Harness（DSH）插件的参考知识库（Agent Skill 参考集）。**
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 核心架构分类与参考指南导航

### 一、官方上游源码与官方文档核验指引 (Upstream & Docs)
- [official-upstream-and-docs.md](./official-upstream-and-docs.md)：
  官方一手资料索引——上游仓库包清单与模块依赖图、实际安装包的目录结构与类型声明速读法、官方文档站页面索引、事实核验的证据分级与版本升级回溯流程。
  **任何架构结论与官方源码冲突时，一律以源码为准。**

### 二、微内核与服务架构 (Microkernel & Spine)
- **[cordis-context-internals.md](./cordis-context-internals.md)**：
  Cordis 微内核底层的三个隔离原语——`ctx.isolate(key)` 服务作用域物理隔离槽、`ctx.intercept(key, config)` 动态拦截代理、`Context.is(value)` 全局 Symbol 品牌跨 Realm 检验。
- **[skill-provider.md](./skill-provider.md)**：
  自定义技能发现（SkillProvider）参考指南——`registerProvider` 注册契约与同步工厂语义、`list`/`get` 两方法与 `locator` 往返句柄、`rank` 取值与重名裁决规则、`complete: false` 的"发现未完成"表达、AbortSignal 贯穿规范与吞 abort 造成的卡顿，以及生产侧 SKILL.md 发现器的 BOM/CRLF/闭栏/目录名四坑、frontmatter 解析的性能陷阱与失效链路。
- **[services.md](./services.md)**：
  The Core Spine 核心大动脉服务单复数绝对铁律（`ctx.sessions`、`ctx.agents`、`ctx.agentTeams`、`ctx.tools` 为复数；`ctx.schedule`、`ctx.planMode`、`ctx.workspaceRegistry` 为单数；`ctx.llm` 为 Seam）、终端服务挂载键是复数 `ctx.terminals`、不存在 `dsh-approval` 包（审批是 `dsh-user-approval`）、Service 类定义规范与依赖注入契约。
- **[plugin-anatomy.md](./plugin-anatomy.md)**：
  插件解剖学——三种插件形态、Context Proxy 与 `extend`/`isolate`/`intercept`、可逆副作用生命周期管理（`ctx.effect`）、五大派发模式、四角色模型、设置表单与配置持久化契约。

### 三、配置系统与补丁机制 (Configuration & Patches)
- **[config-resilience-and-atomic-self-healing.md](./config-resilience-and-atomic-self-healing.md)**：
  配置韧性、多阶损坏提取与崩溃安全自愈架构——崩溃安全原子写盘、JSON/YAML 双格式损坏提取流水线、断电截断 Null 毒丸防御、运行时 Settings 持久化自愈回写闭环、配置重生成反引号转义隔离、客户端插槽防崩防白屏规范与现场留样轮转备份。
- **[config.md](./config.md)**：
  Schemastery 强类型配置规范、代码级四层补丁生效落点（bundles -> profile -> global -> `--patch` overlays）、全量替换（Wholesale Replacement）语义、`- insert:` 分组插入机制、`!!js` 动态表达式求值沙盒、`--dump-config` 假阳性避坑与三步真实启动验证；**写入前的反向覆盖闸门**（落盘前深比较「组合结果 vs 提交值」，不等即拒写并抛 `is overridden by ...`，因此 bundle patch 必须写全字段且与 schema 默认值逐字段一致）；设置表单三种写入语义与乐观版本控制；**Volatile 字段底层判定机制**（`isVolatilePath` 递归校验与 `volatileForm` 模式提取，非 volatile 路径直接拒写）；**复合/联合字段设计与解包陷阱**（Loader 校验后 volatile 字段解析为带 `.get()` 的引用对象，宿主代码必须解包提取真实值，不设默认值保留三态语义）；**volatile 的嵌套位置限制只在解析期生效**（构造 schema 不报错，`resolve` 才抛 `volatile fields require a fixed object path`，因此含 volatile 的 schema 必须有一条真走 `resolve` 的测试）；**解析非法值抛 `ValidationError` 而非返回错误数组**（写 `const [, errors] = Schema.resolve(...)` 会得到恒假的空门禁）；**`toJSON()` 返回引用表 `{uid, refs}` 而非展开树**（直读 `json.dict` 得到 `undefined`，形态门禁因此永远为假）。

### 四、事件总线与工具流水线 (Events & Tool Execution)
- **[events.md](./events.md)**：
  Cordis 五大派发模式源码剖析（`emit` 同步广播、`waterfall` 同步环绕中间件与 `next()` 拦截、`parallel` 并发与 `AggregateError`、`serial` 串行短路与 bail 判定、`bail` 同步短路）、宿主运行事件族、Persistence Catalog 事件与 SurfaceEventType 兼容性、5 类 SurfaceEventType 与 `ignorable` 契约。
- **[tools.md](./tools.md)**：
  ToolRuntime 架构、工具执行时序、单调安全守卫法则与工具归属核验方法与 `defineTool` 编写规范。

### 五、前端双面 UI 插件与插槽体系（Client UI & Slots）
- **[input-overlay-and-keyboard-gestures.md](./input-overlay-and-keyboard-gestures.md)**：
  输入浮层与键盘手势通用经验——双击手势判定（纯时间窗 + 第一键透传第二键消费 + 单调钟 + 组字停顿 + 必须可配置关闭）；输入框上方过滤列表必须自绘（焦点留输入框就不能用宿主 Menu，ARIA 底线，查询词从草稿推导不逐键累加，方向键修饰符语义）；内容可编辑宿主草稿写入异步需 rAF 后再放光标；浮层卸载销毁与 DOM 计数断言；DOM 归属核对（按类名前缀全页扫描，别把宿主空面板算自己头上）；peer 包类型传递依赖缺口的 `TS7006 隐式 any` 判定；全新实例自动化首启先点掉引导模态。
- **[settings-and-plugin-ui.md](./settings-and-plugin-ui.md)**：
  全局设置窗口 (Settings) 与插件管理中心 UI 深度指南——`settings.section` 与 `plugins.bundle.config` 插槽机制、源码样本与真实注入代码、导航图标 (Nav Glyph) 替换技法、React 设置面板的本地 vs 补丁持久化、左侧“插件”管理中心卡片呈现、**`readPluginMeta` 的 exports 白名单契约（卡片空白根因与修法）**、**`meta` 段与面板扁平键的分工及中英同族要求**（卡片标题缺失时回退包名，只写中文而英文册无 `meta` 会导致切英文看到 `@scope/dsh-xxx`）、、图标 256 KiB 上限与路径约束、**改完必跑的两道验证（`npm pack --dry-run` + 直接调 `readPluginMeta`）**与开发决策树。
- **[web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)**：
  Web GUI 插槽树实战——右侧边栏（`sidebar.right.pane.tab`）、会话顶部工具栏（`conversation.session.header.utilities`）、输入框挂件（`conversation.input.right`）、消息流拦截（`conversation.chat.node`）、全局外壳（`shell.*`）；官方主题 CSS 变量（以当前主题包导出为准，含常见误写对照）；样式安全注入与 HMR 回收铁律；**官方 primitives 组件族优先策略**（SegmentedControl / Switch / StateDot / Tag / Button）与「客户端产物单一来源」纪律；**「焦点归谁」判据与 Menu 的适用边界**（Menu 的方向键会把焦点搬进列表，输入框上方浮层必须自绘并让 composition 期间的按键归 IME）；多语言国际化（`ctx.locale` 双语注册、声明 `locale:` 注入 t 席位、缺词静默返回 key）；语言边界契约（静态文案进词典、内容数据保持单语）。

- **[plugin-config-card-architecture.md](./plugin-config-card-architecture.md)**：
  插件自带配置界面的**三层架构**——插槽位置（`plugins.bundle.config` / `settings.plugin.item`）、Settings 命名空间（**等于 Loader 行 id，插件不能手动注册；改 id 等于要求用户重新配置**）、客户端 ConfigForms 生命周期；自带页面必须在 `ctx.inject(['settings'], ...)` 里 `configure({ auto: false }, ctx.fiber)`，否则宿主再自动生成一份、入口出现两份；**最关键的硬判据：ConfigForms 写入只接受 volatile 字段，持久化配置写不进去**；静态注入与动态 `ctx.inject` 的语义差别；只搬 `whileServed` 外壳而不搬 `forms.get(ns)` 与数据面会把卡片降级成空壳；数据性质分类（持久化 / 进程内 / 运行时推导 / 动作）与对应实现路径。
- **[plugin-config-ui-decision.md](./plugin-config-ui-decision.md)**：
  配置界面的**选型与否决**——「DSH 有 Settings 就该交给它」是误解；重启后是否需要保留这一条判定直接决定走自有存储还是 Settings；三种实现形态（自有端点 / Settings 持久化字段写入抛错 / Settings volatile 重启丢失）的对照表；**迁移前五条否决条件**（视觉不变、卡片以运行时推导值为主、已有稳定落盘路径、现有实现已通过门禁、需要改成 volatile 才能跑通）；最小可行迁移路径与六条验收清单。
- **[client-ui-placement-and-verification.md](./client-ui-placement-and-verification.md)**：
  客户端 UI **落点选择与真机取证**——「界面语义 → 插槽」完整映射表（设置窗口各级 Tab / 插件页分组条目 / 卡片内联配置区 / 右侧栏 Tab / 侧边栏底部 / 全局浮层）；**铁律「一个功能一个入口」**（多落点冗余 = UI 污染，实测需回滚）；插槽三个必知机制（spec 由父条目 `children` 表声明、四种 kind 与注册参数对应关系、**`slots.inject` 在 spec 不存在时静默不执行且零报错**）；`plugins.bundle.config` 的 **`configured` 渲染门（匹配键是包名）**；**组件列表里 `id` 与 `name` 相同的行会重复显示包名（宿主行为，且改 id 等于破坏性迁移）**；「UI 不显示」三分法（模块没进图 / apply 没跑 / 落点或渲染门不匹配）；客户端产物 **`immutable` 长缓存与「版本号先于界面更新」的假象**（桌面端必须完全重启）；**无浏览器验证法（Node 直跑 CJS factory 探针）**；CDP / browser-harness 真机取证的环境坑；**解析 Electron `app.asar` 做桌面版与 CLI 版差异比对**。
- **[official-settings-form-pattern.md](./official-settings-form-pattern.md)**：
  官方设置页 UI 体系——**`SettingsForm` 外壳（unavailable/readOnly/saveFailed/save/saving 五文案、dirty/invalid 自动禁用 Save、卸载自动 discard）**；**官方 `SettingsFormModel` 只服务文本/数字字段**，bool 与带说明的枚举必须自写 card controller（形态抄官方 settings-subagent）；`ConfigForm` 与 `SettingsFormScope` 是同形契约（configForms.get 直接当 scope）；**五条保存铁律**（冲突置 invalid、回读逐字段比对、saveGeneration 抑制迟到回执、草稿过期的相等/冲突二分、无差异保存为 no-op）与十条验收判据；**§八「操作即写」模式**（开关/单选不要保存按钮时的选型与控制器骨架：无草稿、每次操作一个 mutate、失败只标 failed 不吞、连点不锁界面、能力面与文案键删干净、恢复默认写 schema 默认值）；**`ConfigFormController` 生命周期与热重载陷阱**（卸载时表单被 `dispose()` 置标志位，未刷新页面调用 `form.mutate` 会直接被底层短路返回 false 并不发 RPC，造成静默假死；组件需具备失败感知能力）；**`whileServed` 命名空间状态守卫机制**（按宿主真实服务列表动态激活与安全销毁注册）；**注入面形状三条**（面顶层必须是工厂函数而非对象；闭包变量不会自动出现在 props 上，`props.scope` 为 undefined 会让点击抛 TypeError 并拖死渲染树；`hooks` 的键会被转成 `use<Name>` 选择器钩子，签名是 `(selector, equal?)` 而非无参取全量）。
- **[client-bundle-loading-and-artifact-trace.md](./client-bundle-loading-and-artifact-trace.md)**：
  客户端加载与产物取证——**`__ModuleLoader__.load` 的注册 id 必须等于包名**（scoped 改名后构建 id 没同步 = `loaded without registering`，整条 bundle 不激活）；组合 URL `/plugins/??<pkg>/client.js&rev=<hash>` 形态与 rev 的非内容哈希语义（mtime/ctime/size）；**「改了代码不生效」的实例取证三步**（resolve 真实路径 → 逐字节比对 client.js → junction 目标）；重启宿主才能越过 immutable 长缓存的硬规矩。

### 六、跨端通信与三角色物理隔离 (IPC & Remote)
- **[remote-rpc-guide.md](./remote-rpc-guide.md)**：
  Typert Remote RPC 跨端通信开发指南——Browser 前端 ↔ Host Node.js 服务端通信规范、方法签名四大硬约束（禁止解构、禁止默认值、禁止 rest、末位 signal 协作取消）、一元 RPC 与流式 mux 通道、端到端可运行范本。
- **[runtime-truth-and-external-contracts.md](./runtime-truth-and-external-contracts.md)**：运行时真值与外部契约——*跨端命名空间不会自动开通*（服务端只暴露端点，第三方必须在客户端显式挂载贡献，挂载失败要降级不抛错，不要写轮询）；*codec 契约的实际宽度*（strict 只校验模式字段本身，解码缺省原样透传，恒等函数即充分）；*运行时推导值三不*（不进 schema、不给 Schema 默认值否则三态归零、不落盘否则过期值遮蔽新值、不构建期内嵌否则切换配置停在旧值）；*描述长度上限来自宿主配置项*（超长被截成省略号导致触发词失效，按折叠语义计数）；*受控控件的值必须落在选项集合内*（findIndex 越界导致全段键盘不可达）；*配置归属维度*（数据根解析不含实例维度导致多实例串扰）；*卸载与更新的逐项覆盖面*（补丁条目是高频漏项，宿主能力缺口只能如实告知）；*文档漂移门禁*（退役表述不得留在模型可读正文，版本一致性断言跟随真源不写死）。
- **[three-roles.md](./three-roles.md)**：
  Browser / Host / 隔离进程三角色物理隔离模型（源码中 Worker 专指 worker_threads，教学上避免用 Worker 指代第三角色）、子进程生成原语（`ctx.subprocess.spawn` 与 `spawnTerminal` 零 Shell 解释）、`SandboxMode`（仅限文件系统效果）与沙箱隔离。

### 七、模型适配、MCP 外部工具桥接与打包分发 (LLM, MCP & Packaging)
- **[mcp-and-tools-bridge.md](./mcp-and-tools-bridge.md)**：
  DSH MCP 客户端集成与外部工具桥接指南——`@deepseek-ai/dsh-mcp-client` 协议桥、Streamable-HTTP 与 StdIO 双传输协议、`mcp__<serverName>__<rawName>` 命名空间强规范、生产环境启动容错（`failOnStartupError`）与单调守卫权限拦截。
- **[llm-adapter.md](./llm-adapter.md)**：
  `ctx.llm`（LlmRuntime Seam）抽象协议、`LlmAdapter` 继承与 `stream()` 实现、7 种 `StreamChunk` 封闭判别联合完整定义代码。
- **[packaging.md](./packaging.md)**：
  Bundle 与 Profile 互斥模型、`package.json` 规约、npm `--legacy-peer-deps` 规避 OOM 实战、`allow-version` 风险豁免机制、多包 Monorepo 工作区联调；**[publish-npm-verification.md](./publish-npm-verification.md)**（npm 发布验证权威指南——本地镜像假阴性避坑、npm 跨区域分发 1-2 分钟时延与 **E409 Staged 冲突锁死防御**、以及发布真源四件套核验标准与真实 Tarball 解包 SHA256 逐文件数字验签）。

### 八、系统提示词注入、会话事件流与状态投影 (Prompt & Projections)
- **[system-prompt-and-projections.md](./system-prompt-and-projections.md)**：
  系统提示词动态编排与会话状态投影——`ctx.systemPrompt` 有序段落（Sections）收集与 `system-prompt/assemble` 环绕中间件、会话事件流（SessionEvent）仅追加哲学、`ctx.sessionProjections` 事件溯源与纯函数折叠（Pure Folds）状态机、以及 `workspace-changes` 工作区代码变更自动化审计。

### 九、本地联调与故障排查 (Debugging & Troubleshooting)
- **[debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)**：
  本地开发调试三大极速回路（`--patch` 覆盖、本地路径添加、临时沙盒）、双面插件前端排查技巧（`__DSH_BOOT__`、`__ModuleLoader__`、Combo 404）、Top 9 高频故障排查速查表（PENDING 挂起、配置冲掉、组件传 ctx 报错、安装解析到旧版本等）、安装失败排障六步路径、**免启动反证法（直接调宿主公开函数问真值，附 Windows `pathToFileURL` 坑与可跑对照探针、`npm pack --dry-run` 打包清单核对）**、插件管理器目录结构与黑匣子日志分析。
- **[install-resolution-traps.md](./install-resolution-traps.md)**：
  插件安装版本解析三大陷阱的权威排查手册——pnpm 自身的发布冷却期配置（v11 起默认 `minimumReleaseAge: 1440`，属包管理器行为，非 DSH 代码实现；DSH 侧兼容闸门是 peer 预检 + allow-version 豁免）、semver 预发布排序（`-tag.N` 后缀被范围解析默认排除，`maxSatisfying(vers,'*')` 返回旧正式版）、DSH 兼容性闸门两段式预检与后检语义与精确版本豁免机制、profile 目录结构与 `minimumReleaseAge: 0` 配置落点、desktop profile 的 Electron 独占守卫。附可复现的参数实验、时间指纹判定法与排障决策表；并覆盖**全新 profile 首次安装的三大坑**：`dsh plugin add` 不写 `dsh.profile.bundles` 需手动补、原生依赖的 `ERR_PNPM_IGNORED_BUILDS` 需在 `pnpm-workspace.yaml` 里加 `allowBuilds` 放行、从零到可跑的五步落地顺序；以及 **pnpm 符号链接热更新与常驻进程模块解析缓存撕裂（ESM ModuleLoader Cache Trap）**（热更新后 Node 常驻进程缓存模块 realpath 导致扫描旧路径抛 `ENOENT: scandir ... locale`，标准处置动作为重启常驻进程）。

### 九之二、静默失效防线与可失败门禁 (Silent Failures & Verifiable Gates)
- **[silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)**：
  把「代码写全了、门禁全绿、运行时毫无作用」这类零报错缺陷归纳成三类根因（代码从未被执行、契约被吞掉、解析到了别的东西），每类配可执行的判定动作；并给出**门禁设计方法论**——先按「错了会不会报错」分类，再决定写运行时回读、源码形态正则还是产物断言，**每条新断言必须做破坏实测证明它会红**，**且断言对象要锚定到具体元素而不是「第一个匹配」**（同类元素多于一种时测错对象也会一直绿；修复后的回归锁要锁判定形状而非顺利路径）；另含真机浏览器验收的环境坑速查（遮罩吞点击、导航等待超时、写入期间控件禁用）、收敛判定的「两帧相同加目标谓词」纪律、发布前后的双重复验与 manifest 自动规范化坑；**异步表单漏渲染失败状态的静默吞错（Silent Failure）**与 Fail-Loud 契约防御；**客户端版本号常量脱节漂移**的门禁对齐断言。

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
### 十八、跨专题工程治理与实战经验 (Cross-cutting Engineering)

- **[provider-catalog-invalidation.md](./provider-catalog-invalidation.md)**：
  技能目录/注册表失效链路的操作参考——`skills/change` 是**消费方通知缝**（官方 `notifyChange()` 源码链路），提供者在其监听器内反向调 `control.invalidate()` 会**同步递归栈溢出**（`invalidateCache` 再次 emit，invalidate 守卫不抑制重入）；`registerProvider` 工厂返回值必须**捕获到闭包变量**否则 `invalidate()` 空转成静默失效；filesystem provider 的观察 roots 与插件包内 skillDir 的关系；正确姿势 = 变更点直调 invalidate；**冷热读取一致性铁律**（自愈重读与快照命中必须走同构转换管道，杜绝漏传参数导致冷读语言撕裂）；**未配置态（undefined）缓存击穿漏洞**（以 undefined 作守卫导致每轮重复反射扫描，必须引入布尔标志位并与 `app-boot/config-reload` 闭环重置）；**协作式取消信号穿透**（变动探测 catch 块严禁吞没 `AbortError`，优先 rethrow）；每条断言做破坏实测。
- **[session-prompt-cache-and-catalog-update.md](./session-prompt-cache-and-catalog-update.md)**：
  已存在会话条目更新机制与大模型 Prompt Cache 保全原理——会话日志 Append-only 事件流契约；每轮对话前置 SHA-256 条目指纹检测；`history.published` 驱动的 `renderCatalogUpdate` 增量替换通知模型；**历史所有轮次 Token 序列 100% 保持未改动从而保全大模型服务端 Prompt Cache** 的设计原理；全关极端状态下的安全降级文案；插件严禁篡改会话历史。
- **[sandbox-process-and-pipe-traps.md](./sandbox-process-and-pipe-traps.md)**：
  Windows 沙箱环境下子进程命名管道受限 EPERM 陷阱与 node:vm 纯内存语法校验实践——Windows 受限沙箱禁止非受信任命名管道；`child_process` 默认 stdio pipe 导致 EPERM 且返回对象未判空直接 `.trim()` 造成致命 TypeError 崩溃；**纯内存语法校验最佳实践 `new vm.Script(source)`**（0 子进程开销、耗时 1ms、0 代码执行副作用、100% 绝对免疫沙箱 EPERM）；必须派生子进程时的安全姿态（可选链保护与禁止盲目重试）。
- **[client-controller-architecture-and-headless-testing.md](./client-controller-architecture-and-headless-testing.md)**：
  双面客户端控制器深度架构与 node:vm 脱机纯内存状态机单测实践——**浅组件参数泥球反模式**；提炼高内聚的 `PanelController` / `CardModel` 深度领域控制器，统一封闭 `ConfigForm` 交互与单次原子 `allOps` 批处理；**React 18 原生 1 行代码接入 `useSyncExternalStore`** 消除并发渲染状态撕裂（Tearing）；以及**利用 Node 原生 `node:vm` 纯内存沙箱提取 CJS bundle 工厂导出**，通过最小 MockScope 在 **< 50ms** 内极速覆盖全量状态机用例（单开关三段式、旧表原子继承、批量 17 条原子批处理、disposed 假死拦截与堆栈捕获），彻底免除启动笨重真实浏览器的依赖。
- **[client-i18n-pitfalls.md](./client-i18n-pitfalls.md)**：
  客户端 `ctx.locale` 实战六铁律——双语键必须完全成对、值可相同（刻意单语条目也用同值占位）；字典是纯数据、**不能嵌 `t()` 调用**；构建期 Node 计算、产物只内嵌**字面量**（浏览器端执行 `readdirSync` 会 ReferenceError）；宿侧下发的诊断链中文在客户端按枚举查字典覆盖（宿侧契约零改动）；语言切换刷新用 `ctx.locale.subscribe` 而非 `locale/change` 事件；字典并入 `locale/*.json` 顶层键组与 meta 键共存；反向断言门禁清单。
- **[architecture-refactor-experience.md](./architecture-refactor-experience.md)**：
  入口重构、深模块判据、可失败自检、产物断言、TDD 接线等价、缓存与文件拆分的经验；维护时关注行为覆盖和第二消费方，避免为拆而拆。
- **[cross-cutting-engineering-practices.md](./cross-cutting-engineering-practices.md)**：
  跨专题工程治理原则——证据等级、删除测试、运行时 adapter 与领域 module 分层、算法结果与 CLI 报告 seam、Host/Browser 隔离、产物 provenance、缓存指纹、顺序无关比较、数据域正则、失败能力、权威真值回读与能力删除承诺面。
  不重复具体 DSH API、静默失效门禁或发布专题。

### 十九、实战深挖沉淀：失效链路 / i18n 坑 / 重构经验 / 发布验证 (Field Experience)
- **[publish-npm-verification.md](./publish-npm-verification.md)**：
  发布验证通用经验——镜像 registry 可能让 `npm view` 假阴性，直查官方 registry API 验 `versions` 与 `dist-tags.latest`；幂等发布「已发布跳过」只跳 npm 不跳 Release，需 `gh release view` 单独验证；tag 指向错误的修正流程（删 tag、补提交、重打、force push）；PowerShell 不支持 `&&` 的拼接坑；发布五步 checklist（bump、CHANGELOG、门禁、commit/tag/push、双真源验证）。
- **[ci-release-workflow.md](./ci-release-workflow.md)**：
  GitHub Actions 双流水线——push/PR 到 main 只跑全量测试（typecheck + 单测 + build），打 `v*` tag 才跑全量测试并 `pnpm publish` + `gh release create`。四个必踩坑：锁文件没入库报 `ERR_PNPM_OUTDATED_LOCKFILE`、tsdown 需要 `Promise.withResolvers` 所以 CI node 必须 ≥22、`NODE_AUTH_TOKEN` secret 必须手动配（OIDC 404 是噪音）、tag 打在旧 commit 的修正序列。

### 二十、源码核验与交付验收 (Source Verification & Acceptance)

- **[client-bundle-loading-and-artifact-trace.md](./client-bundle-loading-and-artifact-trace.md)**：
  客户端加载与产物取证——**注册 id 必须等于包名**（scoped 改名后构建 id 没同步 = `loaded without registering`，整条 bundle 不激活）；组合 URL `/plugins/??<pkg>/client.js&rev=<hash>` 形态与 rev 的非内容哈希语义（mtime/ctime/size）；**「改了代码不生效」的实例取证三步**（resolve 真实路径 → 逐字节比对 client.js → junction 目标）；重启宿主才能越过 immutable 长缓存。
- **[api-truth-read-back-without-browser.md](./api-truth-read-back-without-browser.md)**：
  不带浏览器的 API 真值回读——认证三件套（launch token → `dsh-auth-*` cookie → 带 cookie 请求 `/api/*`）；Typert RPC 报文四段形态（`type/rpcId/method/payload.args`）与三个高频报错对照；`settings/describe` 命名空间真值字段（value/base/user/revision）；**`expectedRevision` 的 null 边界**（省略=无条件，传 null 被 wire 校验拒绝）。

- **[source-verification-and-caches.md](./source-verification-and-caches.md)**：
  源码至上的强制流程——三层来源与固定顺序（本机已安装源码先查 pnpm 再查 npm且命中即停，同机两份实现版本不同不得混读；两者都没有才把桌面版 asar 按需解包到工作目录里被 git 忽略的缓存目录；本机完全没有才浅克隆云端上游仓库）、跨平台定位方法（Windows/macOS/Linux 的用户数据根、npm 全局根、asar 与自带 CLI 位置差异，一律先探测再使用，不静默回退到猜测路径）、冲突裁决顺序（运行时行为 > 已安装源码 > 包内 README > 文档站散文 > 本技能库正文）、以及“仓库相对路径与版本号由各包 manifest 的 directory 与 version 字段生成、不靠推测”这一取数纪律。

- **[isolated-instance-acceptance.md](./isolated-instance-acceptance.md)**：
- **[reproduction-experiment-design.md](./reproduction-experiment-design.md)**：
  复现实验设计与可失败断言——**症状与状态分别取证**（先证明状态真的发生，再看输出）、**冷热态前置条件必须显式满足**（懒加载目录未 ready 时的症状与功能缺陷不可区分）、**对照组只变一个变量**（用修复前的源码跑同一脚本，确认症状可复现）、**断言锚点纪律**（不按类型取第一个匹配、不用文本内容、分组标题会吃掉首列文本）、被测环境三类不稳定（一次性令牌、网络间歇、输出流污染）与产品缺陷的区分、产物目录遗留物（删源码不删声明）与文档数字口径漂移，以及把单次事故沉淀成「症状 / 根因类别 / 判定动作 / 可失败实验」四段式的通用化处理。
  交付验收流程——只装基础插件与目标插件的隔离新实例创建、复用其他实例配置的安全追加法（凭据全局共享但引用必须存在）、**本地源码联调手工建 junction 且必须指向仓库根（跑 pnpm install 会让宿主解析失败、整棵树一起 import 失败）**、冷装/热装/热更新/卸载四种形态各自的验收点与读源码判据（应用状态三态、没有 HMR 服务时一律要求重启、客户端产物长缓存需完全重启）、模型必须问用户选定并建议选便宜的、真实浏览器逐项点击与回读真值清单、浏览器环境坑、debug-修复-验证循环。

- **[browser-automation-acceptance.md](./browser-automation-acceptance.md)**：
  browser-harness 真机验收实战——专用 Chrome 拉不起来的原因（doctor 的 0 connections 与 30s unreachable 是同一件事）、PowerShell 管道四个坑（heredoc 不可用、UTF-16 破坏中文要 `\uXXXX` 转义、stderr 假报错、tab 串场）、`cdp Runtime.evaluate awaitPromise` 发异步 RPC、导航到配置卡的稳定选择器序列（引导模态/插件中心/详情按钮）、真机断言纪律（中文乱码走 DOM 属性、负向断言限定卡片容器、点击→describe→磁盘三段一致）、隔离实例快速验收流程模板。

- **[plugin-config-card-architecture.md](./plugin-config-card-architecture.md)**：
  插件自带配置界面的三层架构——插槽位置、Settings 命名空间与客户端生命周期观察者的职责切分，以及任一层缺失导致的界面静默消失。

- **[plugin-config-ui-decision.md](./plugin-config-ui-decision.md)**：
  配置界面的选型决策——哪些字段适合走 Settings 的 volatile 写入，哪些必须落到自有存储；每种选择各自的断言集与卸载残留风险。