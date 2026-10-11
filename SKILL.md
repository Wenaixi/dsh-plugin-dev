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
- **先证状态再论症状**：同一症状可能来自「从未进入目标状态」或「已进入但被丢弃」，观测完全一样。先找一个状态发生的标记并断言它，再讨论原因。
- **承诺同步**：删除或改名能力时，同步检查入口、文档、配置、导出、示例和发布物。
- **废弃不是删除**：配置字段废弃时保留 schema 声明与 volatile 标注，只在写入侧不再触碰它。删声明让用户历史配置被静默丢弃；去 volatile 标注会让清掉它的 unset 也被宿主写入闸门拒绝。详见 [config-field-lifecycle.md](references/config-field-lifecycle.md)。
- **先问哪一层**：构建期常量、编译期写死的清单、文档里的历史结论都会过期。真值在运行时响应、磁盘文件和源码里；三者对不上时先确认自己引的是哪一层。
- **门禁不写死会变的东西**：把具体版本号或阈值抄进门禁，等于每次变更都要改门禁本身，漏改即失效。断言应校验「几处一致」，不是「某处等于某字符串」。
- **分清静态与真机**：有一类门禁在原理上无法用静态断言覆盖——宿主运行时的语义闸门。写门禁前先对一遍 [host-semantic-gates.md](references/host-semantic-gates.md)，把真机项排进隔离实例验收，不要留在脚本里假装已覆盖。
- **先判能力再写方案**：需求是「同一份数据按调用方给出不同表现」时，先沿链路收敛——枚举全部消费方、追到投影函数的字段白名单、抄缓存键的构成维度、核对作用域参数。四条全过才有受支持路径；有一条不过就是上游数据模型不支持，此时该做的是选覆写路径并写清代价，而不是继续找写法。判定程序见 [shared-contract-capability-boundaries.md](references/shared-contract-capability-boundaries.md)。
- **原子批处理**：多字段或列表项变更必须由客户端平铺为单次原子 `form.mutate(allOps)`，严禁并发触发多次独立 `mutate` 竞争宿主 revision 乐观锁，杜绝状态撕裂与局部失败。详见 [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §九。
- **内存语法解析**：构建与门禁语法校验严禁使用跨进程 `spawnSync('node --check')`，改用 Node 原生 `node:vm`（`new vm.Script`）纯内存解析，彻底免疫 Windows 沙箱命名管道 EPERM 崩溃。详见 [sandbox-process-and-pipe-traps.md](references/sandbox-process-and-pipe-traps.md)。
- **缺省值缓存隔离**：探测宿主全局设置时，对 `undefined` 缺省结果必须引入独立的布尔标志位区分「未探测」与「已探测为 undefined」，杜绝每次请求穿透缓存重复全量反射扫描；并在配置重载（`app-boot/config-reload`）中同步复位。详见 [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §九。
- **取消优先穿透**：I/O 变动探测的异常捕获块严禁无差别吞没异常，必须优先判断并 rethrow `AbortError`，保障协作式取消链路畅通。详见 [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §十。
- **增量替换通知**：向会话注入动态目录时严禁篡改已持久化的历史事件，严格遵循 Append-only 增量替换通知模型（`renderCatalogUpdate`），保全大模型长会话 Prompt Cache。详见 [session-prompt-cache-and-catalog-update.md](references/session-prompt-cache-and-catalog-update.md)。
- **双层提示词与零缓存破坏**：插件自身模式切档严禁修改顶层 SystemPrompt 前缀（基线终身静态化），必须通过 `agent/pre-step` 尾部追加增量提醒并就地更新，彻底保全大模型 KV Cache（Prompt Cache）。详见 [session-prompt-cache-and-catalog-update.md](references/session-prompt-cache-and-catalog-update.md) §六。
- **轮次拦截深模块化**：在 `agent/pre-step` 与 `session/event` 拦截用户指令时，坚决避免将消息展平、waterfall 穿透、变动对比、原地替换与状态标记散落在入口胶水代码中，必须收敛为单一的 `TurnCoordinator` 深模块，并捍卫 6 大核心不变量。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §八。
- **全状态存储虚拟化**：插件持久化存储严禁硬编码调用 `node:fs` 读写磁盘，所有私有文件 I/O 必须由存储适配器代理，并向单测暴露纯内存适配器（`createMemoryStorage`），物理零磁盘触碰。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §九。
- **包引擎与 CI 兼容基线**：`package.json.engines` 仅声明 Node 基础运行底座（`node: ">=20"`），严禁锁死 `engines.pnpm`（防 CI 触发 `ERR_PNPM_UNSUPPORTED_ENGINE` 与 `ERR_UNKNOWN_BUILTIN_MODULE` 恶性死锁）。详见 [ci-release-workflow.md](references/ci-release-workflow.md) §三。
- **控制器深度抽象**：双面客户端配置交互必须抽象为领域控制器深模块（`CardController` / `PanelModel`），统一封装 `ConfigForm` 交互与单次原子 ops 拍平，React 视图仅通过 `useSyncExternalStore` 接入不可变快照，从根源杜绝并发渲染状态撕裂；并在纯 Node 环境下利用 `node:vm` 建立毫秒级脱机单测（The interface is the test surface）。详见 [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md)。
- **重置边界正交隔离**：列表工具条上的批量重置操作严格局限于该列表项字典路径，严禁越权侧漏抹除用户独立的全局标量配置（如语言或主题偏好）。详见 [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §十。
- **配置容灾与自愈闭环**：外部配置不可信。向前端暴露的易变或字典字段在 Schema 中声明为无闭包的纯类型（如 `Schema.any().default(...).volatile()`），严禁在 volatile 节点使用 `Schema.transform`（防跨端 JSON 序列化丢失回调导致客户端反序列化抛错）；数据清洗与容灾自愈由双侧无副作用纯函数在运行时承担；容灾提取键值字典必须使用 `Object.create(null)` 彻底免疫 `constructor` 原型假阳性与原型污染；自愈重生回写聚合为单次原子批处理，组件挂载与控制器构造严禁自发发起写入副作用（No Side-effect on Mount）。详见 [config.md](references/config.md) §九、§十。
- **崩溃安全原子写盘**：插件私有本地文件（配置、状态、缓存）物理写盘严禁直接调用 `writeFileSync` 原地覆写，一律使用“同目录唯一临时文件写入 -> `renameSync` 原子替换”；在 Windows 极端文件占用环境下若 rename 失败安全回退直写并清理临时文件，从物理底层彻底消除由于掉电或进程中断导致的 0 字节与半截断破坏。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §一。
- **配置损坏自愈与留样备份**：物理配置文件读取严禁在 `JSON.parse` 报错时直接丢弃用户数据回退空对象；必须通过轻度语法修补（清洗控制字符、去悬挂逗号、补齐闭合大括号）与模式正则深度提取进行多阶启发式抢救，现场留样备份损坏文件（`.corrupted.<timestamp>`，轮转保留 ≤3 份），并原地自动自愈重写为合法标准 JSON，使系统和后续外部读取平滑自愈。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §二、§三。
- **状态跃迁原子事务**：拦截器中的状态变动检测与已发射标记回写严禁拆分为多步外泄调用，必须由状态机深模块提供原子跃迁接口（`consumeSessionTransition`）自闭环消费，对比判定与标记回写在单个原子事务内完成，“问一次即完成消费”，彻底捍卫单通知幂等不变量并免疫重试流水线撕裂。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十。
- **持久化单向接缝**：多通道持久化（如 Settings 官方通道与文件回退通道）必须收敛于统一的 `ConfigSink` 接口接缝，底层磁盘 I/O 独占内聚在 `FileSink` 内部，配置定义模块彻底纯化为无状态模块，严禁上层暴露裸写盘函数形成旁路写盘双轨制漏洞。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十一。
- **跨 Realm 断言拍平**：在纯 Node 环境下使用 `node:vm` 脱机测试客户端控制器时，沙箱内对象跨 Realm 比对因原型链隔离会被 `assert/strict` 拒绝（报 `Values have same structure but are not reference-equal`）；断言前必须使用 `toJson = (v) => JSON.parse(JSON.stringify(v))` 拍平数据结构，杜绝假失败误判。详见 [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §六。
- **YAML 损坏截断与空值毒丸防御**：YAML 补丁（`cordis.patch.yml`）遭遇断电截断时未写完的列表项（如 `- `）会被解析器静默转为 `null`，数组提取与清洗必须强制施加 `typeof === 'string'` 过滤，杜绝静默注入引发空指针；语法损坏时自动切换为行级启发式状态机抢救。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §六。
- **运行时持久化自愈回写闭环**：`apply` 入口深度清洗内存配置，若检测到修正且宿主 `settings` 就绪，必须通过 `settings.update` 自动将纯净 volatile 字段回写宿主，消除宿主存储中的持久化脏数据。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §七。
- **配置重生成反引号转义隔离**：生成包含 `!!js` 动态表达式（含内层反引号）的配置文件时，严禁使用外层模板字符串直拼，一律采用字符串数组 `join('\n')` 物理隔离，杜绝反引号提前闭合截断文件与引发编译崩溃。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §八。
- **客户端插槽防崩与防白屏守卫**：双面客户端组件严禁直接解构不可信的 `state.user`/`value`，必须使用防污解构与 `strArray` 清洗器兜底，杜绝组件崩溃被宿主降级为静默 `<div data-slot-error>`。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §九。
- **遍历取消绝对穿透**：多条目/多文件循环扫描的 catch 块严禁无差别捕获，必须优先执行 `if (signal?.aborted || (err as DOMException)?.name === 'AbortError') throw err`；严禁将外部取消误判为业务解析损坏记入脏错误状态，严禁自定义 Abort reason 被静默吞没。详见 [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §十。
- **构建先验后写原子时序**：双面或编译型插件构建流水线必须严格遵循「纯内存前置校验 -> 零漂移后安全写入目标磁盘 -> 最终产物落地核验」时序；严禁先覆写分发目录再做校验，彻底消除因漂移退出导致的脏产物落盘污染。详见 [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §一。
- **编译器死代码零容忍与导入解耦**：模块入口严禁顶层 import 本地未直接消费的符号，纯对外公开接口必须物理分离为 `export { ... } from './module'` 委托重导出；保证 `tsconfig.json` 能够永久开启 `noUnusedLocals: true` 与 `noUnusedParameters: true` 严格死代码拦截。详见 [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §二。
- **Tag 指针绝对对齐与纠偏铁律**：打 Tag 前后必须执行 `git rev-parse HEAD === git rev-parse "<tag>^{commit}"` 双向指针核验；一旦 Tag 误落入历史提交，严格执行「删 tag -> 在最新 HEAD 重打 tag -> 推 main -> 推 tag」标准纠偏序列，杜绝 CI 发布旧产物。详见 [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §三。
- **私有复杂度就地内聚防浅模块膨胀**：单消费方、纯内部的私有逻辑（如宿主配置解构或内部操作组装）严禁冲动抽离为独立的浅类（Shallow Module）；就地内聚在私有方法中不仅减少函数签名膨胀、维护单一测试表面，更能保全短路求值性能。详见 [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §四。
- **多持久化语法自愈纯函数化**：当插件管理多个本地私有持久化 JSON（如主配置、会话表、缓存映射等）时，必须提炼通用的零 I/O 纯函数 `repairJsonSyntax(raw)` 统一闭合缺失大/中括号并清洗悬挂逗号；严禁在各业务存储模块各自手写重复的括号计数与正则修复样板。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §十一。
- **损坏现场留样备份入口时序**：物理文件读取一旦标准 `JSON.parse` 抛出语法异常，必须在进入 catch 块的第一时间立即执行现场留样备份（`.corrupted.<timestamp>`，轮转保留 ≤3 份），严禁将备份调用滞后放置在第一阶语法修补之后，杜绝因第一阶语法修复成功提前 return 造成案发现场漏备份。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §十二。
- **多通道上下文目标解构单一真源与依赖消环**：多通道异构宿主上下文（如 `agent.session.id` / `scope.session.id` / `session.id`）提取逻辑必须下沉至基础无状态模块（`resolveSessionTarget`）作为全仓单一真源；消费子系统单向引用，严禁提示词引擎与轮次拦截器相互反向导入引发 ESM 双向循环依赖死锁。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十二。
- **PowerShell 自动化命令链分号兼容规范**：跨平台或 Windows 自动化执行器连续执行终端命令严禁使用 `cmd1 && cmd2`（易在受限管道解析器引发 InvalidEndOfLine 语法解析中断），一律使用标准分号 `;` 分隔或拆分为独立执行调用。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十三。
- **同步栈内存互斥防微任务竞态**：双面客户端在防范高频连击时，严禁依赖 React 的 `useState(busy)` 守卫；React 18 合成事件批处理机制下，状态更新属于异步调度，在下次 commit 渲染前闭包内 busy 仍为 false，快速连击能轻易穿透守卫并携带相同 revision 发射多次并发 mutate，引发宿主版本乐观锁撕裂冲突。必须在领域控制器上维护内存布尔字段（`private _busy = false`），在动作同步调用栈第一行立即执行 `if (this._busy) return false; this._busy = true;`，在 JavaScript 主线程同步期瞬间锁死，物理消除微任务并发窗口。详见 [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §七。
- **单页面板拒绝自建事件总线过度工程 (Ponytail 裁决)**：双面插件设置面板若挂载于宿主行配置页（如 `plugins.row.config`），宿主上层本就监听了全局配置变动并在更新时重新下发全新 `props.form`，面板自身没有多调用方共享订阅需求；坚决遵循 Ponytail 极简原则（YAGNI），果断砍掉通用控制器模板中的 `_listeners = new Set()`、`subscribe()`、`useSyncExternalStore` 与 `Generation Counter` 等 50+ 行无用脚手架，控制器保持为极轻量的纯内存领域映射与同步互斥器即可。详见 [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §八。
- **对称具名安装器装配范式**：插件入口 `apply(ctx, config)` 随功能增多时，严禁将多条独立的生命周期逻辑（如动态预设注册、工具运行期守卫、提示词注入、文件变动监听等）以匿名闭包直接内联堆叠在单个 `ctx.effect` 内；必须提炼为对称的具名安装器函数（如 `installPresetMode`、`installToolGuard`），每个安装器入参明确、职责内聚，统一返回标准的清理函数 `() => void` 或 `[trigger, dispose]`。`apply()` 彻底收敛为极薄的装配层编排器，圈复杂度大幅下降，生命周期可逆性一目了然。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十四。
- **全链路取消信号穿透无死角**：取消信号不仅要在底层 I/O（如 `provider.list` / `get`）中传递，更必须在上层生命周期抽象（如 `Runtime.listNames(signal?: AbortSignal)`）与目录发布流水线中全链路透传到底层；严禁在上层封装中丢弃信号传递空配置 `{}`，并在所有的异常处理块中显式通过 `isAbortError(err, signal)` 识别重抛，严防外部取消信号被误判为物理文件损坏或目录卡死无法中断。详见 [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十五。
- **模板嵌套反引号破坏与构建假绿陷阱**：在代码生成器或补丁自愈模块中使用 ES 模板字符串（反引号）生成包含动态表达式的代码时（如嵌套的反引号表达式），内层反引号若未加斜杠转义会提前闭合外层模板字符串，使后续代码沦为裸标识符引发致命编译错误（TS1005/TS1127/TS1434）；必须防范“假绿陷阱（The Phantom Green）”——若测试直接 import 编译产物，源码编译崩溃会被历史产物静默掩盖，门禁流水线第一步必须是全新构建（`npm run build`），遇错立即熔断，断言必须防御产物与源码漂移。详见 [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §十三。
- **Git Tag 显式 SHA 强绑定与 spawnSync 数组传参防御**：发版打 Tag 时严禁直接通过 Shell 命令行字符串拼接调用（易受 Shell 双引号转义、编码与换行符吞没干扰，且重名 Tag 在未带 `-f` 时会静默失败保持旧指针）；必须使用 Node 原生 `child_process.spawnSync('git', ['tag', '-f', '-a', tagName, '-m', msg, targetSha])` 纯数组传参物理隔离 Shell 解析歧义，显式将 `git rev-parse HEAD` 的绝对哈希传入，并在推 Tag 前后执行双向哈希比对核验。详见 [publish-npm-verification.md](references/publish-npm-verification.md) §四。
- **多语言说明文档发布白名单防 404 死链**：主文档包含多语言跳转链接（如 `[English](./README.md) | [中文](./README.<lang>.md)`）时，必须将多语言副档显式加入 `package.json.files` 发布白名单中；严禁遗漏副档导致 npm 线上发布包中缺失该文件，使文档顶部的语言跳转链接沦为 404 死链。详见 [packaging.md](references/packaging.md) §五。
- **猴子补丁会话级深度还原**：插件覆写宿主单例服务工厂（如 `sessionOf`、`get` 等）时，仅在卸载回调中重置该工厂方法并不够（已被分发给外部使用中的活跃会话实例仍持有篡改后的闭包）；必须使用全局唯一的 `Symbol.for('dsh.<plugin>.origMethod')` 在会话实例上固化原始方法（杜绝二次重复包装），并使用 `Set<WeakRef<object>>` 收集活跃实例（零内存泄露）；在 `ctx.effect` 销毁时，设 `active = false`，恢复工厂方法，并遍历解引用逐一还原已分发实例的方法并 `delete Symbol`。详见 [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §一。
- **声明式样式与插槽监听销毁**：客户端 `<style>` 标签挂载与 `ctx.slots.inject` 监听器严禁裸露在 `apply` 入口；必须分别包在 `ctx.effect(() => { document.head.appendChild(style); return () => style.remove() })` 与 `ctx.effect(() => ctx.slots.inject(...))` 内部，杜绝 HMR 与热重载下的标签堆积与插槽监听器翻倍泄露。详见 [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §二。
- **非 React 交互浮层深模块化与离线单测**：当交互浮层受限于键盘焦点必须锁定在输入框而无法使用 React Portal 时，严禁手写散落的全局 DOM 变量与命令式突变；必须抽象为独立的 `OverlayController` 深模块，将 DOM 骨架挂载、视口定位计算与事件委托统一内聚；将文本高亮切片（`splitHighlighted`）、多行文本截断预览与视口边界避让算法提炼为零 I/O 纯函数，实现纯 Node 环境下无需伪造 JSDOM 的毫秒级脱机单测（The interface is the test surface）。详见 [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §三。
- **输入交互外壳 Coordinator 模式与 Hooks 正交解耦**：输入框增强类插件涉及按键拦截、右键粘贴、选区浮动工具栏、会话消息同步等多重关注点时，严禁揉成单一庞大 React 组件（发散式变化坏味道）；主组件仅作为协调器（Coordinator），维护单一的 `liveRef` 避免闭包过期，将其穿透至若干专注的子 Hooks；所有捕获期全局事件监听器的依赖项一律设为 `[]`，彻底消除按键输入过程中的事件解绑重绑抖动与 Fiber 重新调度开销。详见 [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §四。
- **非必要文档写死版本与度量指标去中心化**：面向最终用户的说明文档（`README`）严禁充斥如 `（vX.Y.Z 新增）` 等历史版本标注，或写死的测试用例具体数字；版本变更全量收敛至 `CHANGELOG.md`，测试保障以自动化门禁脚本为单一真源；消除每次版本发布时对说明文档的散弹式修改（Shotgun Surgery）。详见 [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §五。
- **元数据资源硬边界**：`package.json` 引用的静态资源（如 `icon`）必须严格受控于宿主硬限制（≤256 KiB，安全水位 ≤100 KiB）；图标采用 256×256 高保真重采样压制，并在门禁中断言物理大小，杜绝宿主引导期元信息崩溃。详见 [packaging.md](references/packaging.md) §七、[host-semantic-gates.md](references/host-semantic-gates.md) §2.9。
- **构建钩子与输出流管道隔离**：自动化校验 `npm pack --json` 时，必须防范 `prepare`/`prepack` 钩子向 stdout 打印构建日志导致的标准输出污染；采用结构锚点切片提取（`raw.slice(start, end)`）防御，杜绝门禁 JSON 解析假崩溃。详见 [packaging.md](references/packaging.md) §八。
- **React 18 快照引用稳定性与事件驱动失效**：控制器向 `useSyncExternalStore` 暴露的 `getSnapshot()` 必须返回不可变缓存对象（`_cachedSnapshot`）。若状态未变时每次调用返回新建对象字面量，`Object.is(old, new)` 恒为 false，React 18 会误判外部存储在渲染期间发生改变而无限递归更新，导致主线程 100% 冻结卡死（`Maximum update depth exceeded`）；快照缓存必须采用**事件驱动失效 (Event-Driven Invalidation)**，仅在底层数据源事件广播、作用域重绑或交互状态变动时清空缓存；且 `updateScope(nextScope)` 必须包含 `if (this.scope !== nextScope)` 恒等守卫，严禁在组件渲染周期内无条件调用 `_notify()` 向外部订阅者派发同步更新信号。详见 [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §九。
- **Schemastery 跨端表单序列化与 Schema.transform 禁忌**：严禁在向前端暴露的 volatile 字段上使用 `Schema.transform`。宿主向浏览器同步配置表单 Schema 时使用 `schema.toJSON()` 进行 JSON 传输；`Schema.transform` 内部的 JavaScript 回调函数无法被 JSON 序列化，导致浏览器客户端反序列化（`rehydrate`）后调用 `validate(schema, draft)` 校验时触发 `TypeError: callback is not a function`，使 `ConfigFormController.prototype.decode(view)` 判定校验失败并返回 `undefined`，状态永远停留在 `loading` / `unavailable`，导致前端降级显示“当前宿主未提供本插件的配置通道，开关暂不可用”；易变字段声明保持 `Schema.any().default(...).volatile()`，清洗逻辑下沉至双侧纯函数。详见 [config.md](references/config.md) §十。
- **客户端插件显式服务依赖声明铁律 (No Implicit Client Context)**：双面插件客户端导出严禁仅暴露裸 `apply(ctx)`，必须同时导出 `export const inject = ['slots', 'locale', ...]` 与 `export default { apply, inject }`。Cordis 微内核在全新隔离实例冷启动时在服务未就绪前立即执行 `apply`，未声明依赖会导致 `ctx.slots` / `ctx.locale` 为 undefined 并抛未捕获 TypeError，使条目的 Fiber 无法初始化（`fiber === undefined`），被宿主 Bootloader 判定为 `failed`（`web boot: 1 entry did not activate`）；在日常 profile 中该缺陷会被其他插件提前唤醒服务的行为隐蔽掩盖（假阳性）。详见 [client-bundle-loading-and-artifact-trace.md](references/client-bundle-loading-and-artifact-trace.md) §五、[dual-face-ui.md](references/dual-face-ui.md)。
- **隔离实例本地源码联调直连铁律 (Direct Source Junction Rule)**：在隔离 profile 中调试本地未发布的源码时，严禁运行 `pnpm install` 或 `dsh plugin add <本地目录>`。pnpm 依赖解析器会将包深层锁定在 `.pnpm/<name>@<hash>/node_modules/<name>` 虚拟存储池中；导致开发者在本地修改源码并重新构建后，宿主静态服务继续分发虚拟池中的历史快照副本，产生“源码改了、编译过了、控制台零报错，但宿主永远运行旧代码”的严重假象；必须在 profile 的 `package.json` 配置 `dependencies` 与 `bundles` 后，跳过 pnpm install，直接手工建立直通开发工作区根目录的目录联接（Windows `mklink /J`，类 Unix `ln -s`），并通过 `(Get-Item node_modules/<pkg>).Target` 强校验联接目标绝不含 `.pnpm`。详见 [isolated-instance-acceptance.md](references/isolated-instance-acceptance.md) §一。
- **特权能力多级物理守卫铁律 (Multi-Tier Tool Guard Rule)**：插件向宿主引入代码执行、敏感数据写入或外部特权 API 时，严禁仅依靠系统提示词软约束，必须在 `agent/created` 中构建双道物理防线：先调用 `tools.restrict({ deny: targets })` 从系统提示词工具目录物理移除（第一道防线，消灭调用意图），再挂载 `tools.guard((exec) => ...)` 执行期动态守卫（第二道防线，阻断模型盲调并返回可读拒绝理由）；且必须具备全局 Master 总控短路（总控关闭全系统无条件拦截）与按预设作用域过滤机制，并通过 `settings/document-updated` 响应式联动。详见 [tools.md](references/tools.md) §九。

## 场景路由

| 需求或症状 | 先读 |
| --- | --- |
| 点击插件卡片展开详情界面瞬间崩溃卡死、CPU 100%、useSyncExternalStore 未缓存死循环 | [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §九 |
| 配置面板提示当前宿主未提供本插件的配置通道、状态永久 unavailable、Schema.transform 闭包丢失 | [config.md](references/config.md) §十 |
| 覆写宿主全局服务工厂导致旧会话永久持有闭包、Symbol+WeakRef 深度可逆还原 | [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §一 |
| 插件多次热重载导致 `<head>` 内 `<style>` 标签堆积与插槽监听器翻倍泄露 | [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §二 |
| 键盘焦点需锁定输入框无法用 React Portal、OverlayController 浮层解耦与脱机单测 | [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §三 |
| 输入增强组件膨胀至数百行、捕获期监听频繁重绑颠簸、Coordinator 与 Hooks 拆分 | [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §四 |
| 每次发版被迫散弹式修改 README、说明文档写死历史版本与单测数字去中心化 | [deep-lifecycle-overlay-and-coordinator-patterns.md](references/deep-lifecycle-overlay-and-coordinator-patterns.md) §五 |
| 多文件 JSON 损坏修补重复代码膨胀、通用语法自愈纯函数 repairJsonSyntax | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §十一 |
| 损坏文件自愈成功但未生成留样备份文件、备份调用时机滞后陷阱 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §十二 |
| React 18 useState 异步调度并发穿透、连击导致 revision 乐观锁冲突 | [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §七 |
| 双面单页面板是否需要自建事件总线、useSyncExternalStore 过度工程裁决 | [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §八 |
| apply() 闭包变量膨胀纵横交错、对称具名安装器解耦装配模式 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十四 |
| 目录收集与清单发布丢失 AbortSignal 上下文、全链路取消信号穿透 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十五 |
| 模板字符串嵌套反引号引发编译崩溃、测试读旧产物产生虚假安全感 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §十三 |
| Git Tag 因 Shell 引号解析截断未绑定最新提交、spawnSync 数组强绑定 | [publish-npm-verification.md](references/publish-npm-verification.md) §四 |
| 提取会话或上下文 ID 导致模块间循环依赖、resolveSessionTarget 下沉消环 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十二 |
| Windows 下自动化脚本运行多条命令报 && 不是有效语句分隔符 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十三 |
| YAML 补丁损坏截断、YAML 解析出 null 空值毒丸、启发式状态机抢救 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §六 |
| 插件启动时发现配置有脏数据、自动写回宿主 settings 持久层自愈闭环 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §七 |
| 生成带 !!js 动态表达式的配置时反引号提前闭合、TS1005 编译报错或文件被截断 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §八 |
| 客户端配置面板打开空白、渲染被替换为 `<div data-slot-error>`、state.user 防污 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) §九 |
| 资产/条目循环扫描时被取消、取消异常被当成业务损坏并残留脏错误状态 | [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §10.4 |
| 携带自定义错误原因的 AbortController 取消时异常被静默吞没 | [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §10.5 |
| 构建脚本校验失败但目标目录已被脏产物覆盖、先验后写原子时序 | [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §一 |
| TypeScript 开启 noUnusedLocals 报 TS6133、模块消费导入与委托导出物理解耦 | [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §二 |
| 本地打 Tag 后又有新 commit、CI 发布旧代码、Tag 指针漂移纠偏序列 | [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §三 |
| 冲动抽离单消费方私有逻辑导致接口反噬与性能倒退、浅模块防陷阱准则 | [deep-refactor-and-governance-hardening.md](references/deep-refactor-and-governance-hardening.md) §四 |
| 本地私有配置文件掉电截断、损坏时抢救提取数据、留样备份与自动自愈重新生成 | [config-resilience-and-atomic-self-healing.md](references/config-resilience-and-atomic-self-healing.md) |
| 拦截器状态变动比对与标记回写时序外泄、重试管道重复追加通知、原子跃迁事务 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十 |
| 多环境配置持久化双轨撕裂、消灭旁路直接写盘、单一 ConfigSink 接缝范式 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §十一 |
| node:vm 脱机单测报 not reference-equal 假失败、跨 Realm 原型链隔离拍平 | [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) §六 |
| 会话内动态切档、插件自身模式切换与大模型 Prompt Cache 零破坏 | [session-prompt-cache-and-catalog-update.md](references/session-prompt-cache-and-catalog-update.md) §六 |
| agent/pre-step 轮次拦截胶水代码膨胀、TurnCoordinator 深模块收敛与 6 大不变量 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §八 |
| 状态模块硬编码 node:fs 导致测试污染磁盘、StateStorageAdapter 纯内存虚拟化 | [architecture-refactor-experience.md](references/architecture-refactor-experience.md) §九 |
| CI 安装报 ERR_PNPM_UNSUPPORTED_ENGINE、PowerShell CLI 管道符 | 语法截断 | [ci-release-workflow.md](references/ci-release-workflow.md) §三 |
| 双面客户端控制器深模块重构、`useSyncExternalStore` 接入、纯 Node 脱机状态机单测 | [client-controller-architecture-and-headless-testing.md](references/client-controller-architecture-and-headless-testing.md) |
| 列表批量重置意外抹掉语言/主题偏好、正交隔离准则 | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §十 |
| 手动改坏 cordis.patch.yml 报 invalid config 崩溃、配置损坏自愈提取与自动重生 | [config.md](references/config.md) §九 |
| 字典型配置提取命中 constructor 属性、原型链假阳性、Object.create(null) 防御 | [config.md](references/config.md) §9.2 |
| 前端组件挂载时自动写入导致 revision 冲突与乐观锁状态撕裂、挂载零副作用 | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §11.3 |
| Tag 指针漂移导致 CI 发布旧代码、发版前三步核验与标准纠偏序列 | [publish-npm-verification.md](references/publish-npm-verification.md) §三 |
| 全局改配置是否影响已有会话、动态条目更新与 LLM Prompt Cache 保全 | [session-prompt-cache-and-catalog-update.md](references/session-prompt-cache-and-catalog-update.md) |
| Windows 沙箱下管道 EPERM 报错、node --check 崩溃、纯内存语法校验 | [sandbox-process-and-pipe-traps.md](references/sandbox-process-and-pipe-traps.md) |
| 批量修改配置/开关报保存失败、部分成功部分失败、并发 mutate 乐观锁撕裂 | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §九 |
| 宿主缺省值导致缓存穿透、每次请求全量重复扫描 describe | [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §九 |
| 开发期 HMR 修改 CSS 样式不生效、刷新页面才生效 | [web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md) §十 |
| npm 发布后线上多语言 README 点击报 404 死链 | [packaging.md](references/packaging.md) §五 |
| 服务注入、Service、PENDING、缺失依赖 | [services.md](references/services.md)、[plugin-anatomy.md](references/plugin-anatomy.md) |
| 监听器、定时器、异步任务、重载或卸载 | [events.md](references/events.md)、[plugin-anatomy.md](references/plugin-anatomy.md) |
| 动态目录、Provider、缓存、失效、重名 | [skill-provider.md](references/skill-provider.md)、[provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) |
| 设置面板、Web 插槽、Host/Client、UI 不显示 | [three-roles.md](references/three-roles.md)、[web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md)、[client-ui-placement-and-verification.md](references/client-ui-placement-and-verification.md) |
| 设置页 UI 怎么写（官方 SettingsForm / 草稿 / 冲突栅栏） | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) |
| 开关/单选不要保存按钮、改动自动生效 | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §八（操作即写） |
| 输入框上方浮层、双击手势、焦点留输入框、中文输入法组字 | [input-overlay-and-keyboard-gestures.md](references/input-overlay-and-keyboard-gestures.md)、[web-ui-slots-and-styling.md](references/web-ui-slots-and-styling.md) |
| 手势关闭后宿主浮层关不掉 / 高亮越界环绕 / 视觉顺序与数据顺序相反 | [input-overlay-and-keyboard-gestures.md](references/input-overlay-and-keyboard-gestures.md)（让位分支、clamp、单套下标） |
| 客户端没加载、注册 id 报错、改了代码不生效 | [client-bundle-loading-and-artifact-trace.md](references/client-bundle-loading-and-artifact-trace.md)、[silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md) |
| 不开浏览器回读配置/状态真值、写自动化验收 | [api-truth-read-back-without-browser.md](references/api-truth-read-back-without-browser.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| patch、Bundle、peer 依赖、打包、发布 | [config.md](references/config.md)、[packaging.md](references/packaging.md)、[install-resolution-traps.md](references/install-resolution-traps.md) |
| 面板点一下卡死 / 诊断段永久「不可用」/ 读不到命名空间 | [runtime-truth-and-external-contracts.md](references/runtime-truth-and-external-contracts.md)（信封未解包、命名空间未挂载）、[official-settings-form-pattern.md](references/official-settings-form-pattern.md)（注入面形状） |
| 卡片显示包名、中英界面标题不一致 | [settings-and-plugin-ui.md](references/settings-and-plugin-ui.md)（meta 段与面板键分工、中英同族） |
| schema 形态门禁从不红 / volatile 嵌套才在宿主炸 | [config.md](references/config.md)（嵌套位置限制、引用表形状）、[silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)（破坏实测） |
| 非负整数配置字段（`integer()` 不存在、用 `z.natural()`） | [config.md](references/config.md) §7.8 |
| 插件改 scoped 名、改名后多处对不上 | [packaging.md](references/packaging.md)（scoped 化六件套）、[config.md](references/config.md)（patch name 引号） |
| 插件启动或安装报包元信息错误、icon exceeds 256 KiB、图标过大宿主加载崩溃 | [packaging.md](references/packaging.md) §七、[host-semantic-gates.md](references/host-semantic-gates.md) §2.9 |
| 自动化验包报 Unexpected token [信息]、prepare 钩子日志污染 npm pack --json | [packaging.md](references/packaging.md) §八 |
| 搭 CI 流水线、tag 发版、npm 发布失败 | [ci-release-workflow.md](references/ci-release-workflow.md)、[publish-npm-verification.md](references/publish-npm-verification.md) |
| 没有报错但功能不生效 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| 点击按钮/开关毫无反应、表单静默失败、热重载后表单 disposed 假死 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[official-settings-form-pattern.md](references/official-settings-form-pattern.md) |
| 热重载/升级后报 scandir ENOENT、旧 pnpm 哈希路径丢失 | [install-resolution-traps.md](references/install-resolution-traps.md)、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| volatile 字段拒写、联合字段设计、宿主端拿到引用包装需解包 | [config.md](references/config.md)、[settings-and-plugin-ui.md](references/settings-and-plugin-ui.md) |
| 卡片版本与面板版本不一致、客户端版本常量脱节漂移 | [silent-failure-and-gate-design.md](references/silent-failure-and-gate-design.md)、[client-bundle-loading-and-artifact-trace.md](references/client-bundle-loading-and-artifact-trace.md) |
| npm 发布后暂态 404/时延、E409 staged 冲突、线上产物 SHA256 验签 | [publish-npm-verification.md](references/publish-npm-verification.md)、[ci-release-workflow.md](references/ci-release-workflow.md) |
| tsc 报「找不到 react 声明 / JSX namespace」、`@types` 顶层缺失 | [debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md)（开头环境四坑） |
| 固定端口联调「改了没生效」、describe 回读是旧 schema | [api-truth-read-back-without-browser.md](references/api-truth-read-back-without-browser.md)（旧进程核对）、[debugging-and-troubleshooting.md](references/debugging-and-troubleshooting.md) |
| 跨模块变更、能力删除、兼容迁移 | [cross-cutting-engineering-practices.md](references/cross-cutting-engineering-practices.md) |
| 具体 API 或版本结论无法确认 | 先查现有参考，再核对目标运行时和 [official-upstream-and-docs.md](references/official-upstream-and-docs.md) |
| 找不到本机源码、桌面版解包、上游克隆 | [source-verification-and-caches.md](references/source-verification-and-caches.md) |
| 插件写完了要验收、测安装卸载、跑浏览器验证 | [isolated-instance-acceptance.md](references/isolated-instance-acceptance.md)、[browser-automation-acceptance.md](references/browser-automation-acceptance.md) |
| 症状看起来对但修完就好了，怀疑归错因；复现时好时坏；前置条件没满足就开跑 | [reproduction-experiment-design.md](references/reproduction-experiment-design.md)（症状与状态分别取证、冷热态前置、对照组） |
| 验收脚本一直绿但测的不是它；断言靠文本匹配或「按类型取第一个」 | [reproduction-experiment-design.md](references/reproduction-experiment-design.md)（锚点纪律、断言可失败） |
| 前导命令后打斜杠没补全；要判断是状态门禁还是解析失败 | [slash-commands-and-input-triggers.md](references/slash-commands-and-input-triggers.md)（守卫档位）、[reproduction-experiment-design.md](references/reproduction-experiment-design.md) |
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
| 三态/多态配置字段在客户端缺项折叠、未配置跟随失效 | [client-i18n-pitfalls.md](references/client-i18n-pitfalls.md) 铁律七 |
| 宿主切换界面语言后插件缓存陈旧、模型目录不刷新 | [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §五 |
| 异步扫描多任务并发重入、Map 相互清空报假重名或丢技能 | [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §六 |
| 呈现维度（如语言）切换造成高频无谓读盘、未解耦物理变动 | [provider-catalog-invalidation.md](references/provider-catalog-invalidation.md) §七 |
| 集合/字典型字段惰性迁移时，单项操作抹除旧表其余历史数据 | [config-field-lifecycle.md](references/config-field-lifecycle.md) §3.2.1 |
| 本地 pnpm pack 重装调试时报 Already up to date、产物不更新 | [install-resolution-traps.md](references/install-resolution-traps.md) §8.4 |
| 纯净隔离新实例冷启动卡死在启动遮罩、报 web boot: 1 entry did not activate / failed | [client-bundle-loading-and-artifact-trace.md](references/client-bundle-loading-and-artifact-trace.md) §五、[dual-face-ui.md](references/dual-face-ui.md) |
| 本地插件改了源码重新构建后新实例依然运行旧代码、pnpm 虚拟存储池快照陷阱 | [isolated-instance-acceptance.md](references/isolated-instance-acceptance.md) §一 |
| 现代高质感插件设置面板设计规范（状态展板、卡片分段单选、主控芯片、即时搜索与批量控制） | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §十二 |
| 特权工具/敏感外部能力双道物理守卫、全局总控短路与专属预设按需隔离 | [tools.md](references/tools.md) §九 |
| 技能/功能开关多轴心智负担简化为一元化单开关、持久层 3-ops 原子批处理与向后兼容契约 | [official-settings-form-pattern.md](references/official-settings-form-pattern.md) §十三 |

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
- 把带有「跟随默认」语义的三态字段在客户端读取时折叠成兜底字面量，让前端跟随逻辑永久成为死代码。
- 集合/字典型字段惰性迁移时只把当前操作项写入新表就全量 unset 旧表，导致历史表中其余生效项被连带意外抹除复活。
- 异步多 I/O 扫描器在函数开头裸调 `clear()` 且无并发重入屏障，让后进入的任务清空前一个正在填充的 Map 造成技能丢失。
- 宿主全局配置（如界面语言）变更依赖自身插件的 volatile 广播，不知道该事件只在所属插件 Fiber 传播而漏接 `app-boot/config-reload`。
- 把「最终输出为空」直接当成「功能有缺陷」，不先证明中间状态真的发生过——归错因的修复同样能让症状消失，假结论于是被写进记忆库。
- 在冷态（目录或注册表未 ready）下跑完整个验收就下结论，并把结论当可复现的缺陷记录。
- 用「按类型取第一个匹配」或界面文本当断言锚点；同类元素多于一种时，断言稳定测错对象且一直绿。
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
- 批量配置变更采用 `Promise.all(items.map(form.mutate))` 发起并发写入，在同一微秒内竞争宿主单调递增的 revision 锁，导致后序调用被版本冲突拦截、UI 状态严重撕裂与级联失败。
- 在门禁或构建脚本中使用跨进程 `spawnSync('node --check')` 校验语法，在 Windows 沙箱受限环境下遭遇命名管道 EPERM 拦截并因未判空调用 `.trim()` 引发致命的 TypeError 崩溃。
- 以 `if (this.cache !== undefined)` 作为宿主缺省值探测的缓存守卫，在默认未配置环境下守卫恒为 false，导致后续每一次调用都全量重复反射扫描。
- 在目录/文件变动探测的 catch 块中盲目返回 true，吞没 `signal.throwIfAborted()` 抛出的 `AbortError`，使已取消的任务反被误判为文件变更并强行触发全量重扫。
- 客户端样式注入使用纯 `if (!document.querySelector(...))` 守卫，导致开发期 HMR 热重载时因已有标签未被清理，新修改的 CSS 规则无法热生效覆盖。
- 在 `package.json` 的 `files` 发布白名单中遗漏多语言说明文档（如 `README.zh.md`），导致 npm 线上发布包中缺失该文件，文档顶部的语言跳转链接沦为 404 死链。
- 试图在插件层覆写或篡改已持久化的会话历史事件，破坏会话事件流的 Append-only 契约，摧毁大模型服务端原本逐字匹配的 Prompt Cache 历史前缀。
- 在 React 组件内部将多个 `useState` 状态更新器深传给散落的提交函数中，形成高耦合浅模块（Shallow Module），导致测试必须强依赖启动真实的 Chromium/Playwright 进程，无法建立毫秒级的脱机状态机单元测试。
- 列表工具条的「恢复默认」在清理条目字典时，私自向独立的全局标量字段派发 `unset`，违反最小惊讶原则，意外抹杀用户显式配置的全局偏好设置。
- 重新发版前未核对本地与远程 tag 的提交指针（`git rev-parse <tag>` vs `HEAD`），导致本地残留旧 tag 并触发 CI 流水线发布未经修复的历史旧产物。
- 在双面客户端中使用 React `useState(busy)` 守卫异步操作，忽略了 React 18 批处理调度窗口，使快速连续点击穿透守卫并携带相同旧 revision 触发宿主乐观锁撕裂。
- 在单页宿主注入面板中生搬硬套控制器全量模板，为不需要多处订阅的简单面板引入自建事件总线与 `useSyncExternalStore`，平白制造 50+ 行死代码与复杂度债务。
- 在 `apply()` 中将多条独立生命周期逻辑以匿名闭包直接堆叠在单个 `ctx.effect` 内，数十个闭包变量纵横交错，导致注销链条脆弱且无法独立单元测试。
- 在上层运行时封装中调用底层 Provider 接口时传递空配置 `{}` 丢弃 `AbortSignal`，使取消信号在顶层发布与目录收集链路上发生断路。
- 在代码生成模块中使用外层模板字符串包裹包含内层未转义反引号的动态模板，造成模板字符串提前闭合，引发致命语法崩溃。
- 测试直接 import 上一次构建留下的 `lib/` 产物且未配置前置 clean build，使源码语法破坏被旧产物静默掩盖，形成“假绿”虚假安全感。
- 在自动化发版脚本中使用拼接 Shell 命令字符串执行 `git tag`，因双引号转义解析异常导致 Tag 未能覆盖绑定到最新发版提交。
- 提供了包含多语言跳转链接的主说明文档，却未将副语言文档加入 `package.json.files`，导致 npm 线上发布包中缺失该文档产生 404 死链。
- 在声明插件 Config 时对易被用户手动编辑的字典或枚举字段使用严苛强校验 Schema，导致底层配置文件一旦出现脏数据、类型不符或非标别名时 Loader 直接抛出 invalid config 致命崩溃使插件激活完全失败。
- 容灾提取键值字典时直接使用普通对象字面量 `{}`，导致外部包含原型属性名时触发 `constructor` 等原型链继承假阳性与原型污染隐患。
- 为了实现所谓的“自动修复损坏配置”，在前端组件挂载（useEffect）或控制器构造函数中自发调用 `scope.mutate`，在 React 严格模式和热重载下微秒级并发消耗宿主版本号 revision，引发乐观锁冲突与严重的状态撕裂。
- 将合法的向后兼容历史废弃字段（Legacy fields）误判为破坏性配置损坏，在挂载时擅自抹杀清理，破坏「操作即迁移、单开关原子继承」的向后兼容契约。
- 在写盘持久化时直接调用 `writeFileSync` 原地覆写文件，导致进程在写入中途被操作系统杀死或系统掉电时留下 0 字节或半截断破损坏文件。
- 读取物理配置文件时仅使用简单的 `try { JSON.parse() } catch { return {} }`，在遇到截断损坏或手改括号缺失时粗暴丢弃用户的全部历史有效配置。
- 在拦截器或中间件中将状态变动比对与发射标记回写拆散为两步独立调用，导致同轮发生内部重试流水线时漏标已发射状态并反复追加冗余通知消息。
- 在纯 Node 环境下使用 `node:vm` 脱机运行客户端控制器时，直接使用严格深度断言比较跨 Realm 输出的数组或对象，遭遇 V8 原型链隔离报错误判为业务逻辑缺陷。
- 在多资产/多条目循环遍历中使用无差别 catch，导致外部取消被误判为条目解析损坏并计入脏状态，甚至在末尾条目取消时误报为成功。
- 在自愈读取 catch 块中仅检查 `err.name === 'AbortError'`，导致携带具体错误信息的自定义 Abort reason 被当作常规错误静默吞没。
- 构建脚本先执行文件复制覆写再比对元数据一致性，导致比对失败时目标分发目录已被写入脏产物。
- 在顶层无差别 import 未在本地直接消费的符号，迫使团队在 tsconfig 中妥协关闭 noUnusedLocals 导致死代码静态拦截失效。
- 在修改完发版文档或提交最后修正前提前打 Tag，未核对 `git rev-parse HEAD` 与 Tag 指针一致性便推送到远程触发 CI 发布历史旧代码。
- 违背 YAGNI 原则将单消费方的私有逻辑过度抽象为浅类（Shallow Module），带来入参膨胀并破坏短路求值性能。
- 将损坏现场留样备份调用滞后写在第一阶语法修补之后，导致因尾部截断缺失闭合括号被第一阶自愈成功提前 return，原始破坏现场从未被留样备份从而彻底丧失事故可追溯性。
- 在提示词装配引擎与轮次拦截协作者之间相互反向导入异构上下文提取探针，在 ESM 模块体系下引发致命的双向循环依赖（Circular Dependency）与未初始化变量死锁。
- 在 Windows PowerShell 或受限自动化执行器下使用 `&&` 串联多条连续 Git/CLI 命令，遭遇语法解析器报错 `InvalidEndOfLine` 导致自动化流水线意外崩溃中断；应统一使用标准分号 `;` 分隔。
- 猴补宿主单例工厂（如 `sessionOf`）时仅还原工厂方法自身，未通过 Symbol 与 WeakRef 级联还原各活动实例的原方法，导致插件热重载或禁用后旧闭包继续劫持输入。
- 客户端样式注入与 `slots.inject` 裸露在 `apply` 顶层，丢弃返回的 Disposer，导致 HMR 期间重复堆积标签与内存监听泄露。
- 交互浮层为了避免失去焦点而手写全局 DOM 变量与命令式突变，未将切片与视口定位提炼为纯算法深模块，导致测试必须依赖重型浏览器。
- 在高频变动状态（如 `draft`）的输入框组件中混杂多个正交特性，导致捕获期全局事件监听器频繁解绑重绑引发事件颠簸。
- 在面向用户的说明文档（`README`）中滥用 `（vX.Y.Z 新增）` 历史标签或写死单测通过数量，破坏文档长青性并引入散弹式维护债务。
- 客户端插件仅导出 `apply` 却遗漏 `inject: ['slots', 'locale']`，导致在纯净隔离新实例冷启动时因前端服务未就绪抛未捕获 TypeError 被宿主标记为 `failed`（`web boot: 1 entry did not activate`）。
- 在隔离新实例调试本地插件时直接运行 `pnpm install` 或 `dsh plugin add`，导致依赖被深锁入 `.pnpm` 虚拟快照池，引发“源码修改重构建后宿主继续分发旧代码”的严重假象。
- 插件设置面板直接堆叠简陋的原生单选框与粗糙表格，条目繁多时缺少即时搜索过滤与原子批量控制工具条。
- 特权工具仅依赖系统提示词口头约束，未在 `agent/created` 中构建“静态目录物理剥离 (`tools.restrict`) + 运行期动态拦截 (`tools.guard`)”双道物理防线。
