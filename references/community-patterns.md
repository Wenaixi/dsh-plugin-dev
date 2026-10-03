# 社区实践图谱：高星 DSH 插件共性工程经验

> **定位**：本文档由 GitHub topic:dsh-plugin 高星仓库（约 100 个）的逐一分析蒸馏而成，
> 只收录**可复用的通用经验**，不收录任何仓库专属的业务细节。每条经验都标注了
> 出处仓库（便于追溯与二次核验）。形态判定、API 契约等基础事实以官方类型声明为准，
> 本文件是"工程做法"层面的补充。
>
> **证据强度**：本文件全部条目来自对上游仓库源码/README/patch 的直接阅读（2026-10-03
> 快照），属于"第三级证据"（社区实现）；与官方源码冲突时以官方为准。

---

## 〇、怎么判定一个仓库是不是 DSH 插件（社区里的三种形态）

topic:dsh-plugin 话题下 17306 个仓库里，真正是 DSH 插件的不到两成。判定只看三个信号：

1. 根或子包的 `package.json` 里有 `dsh.bundle.patch`（或 `dsh.client`）声明；
2. 存在 `cordis.patch.yml`；
3. 依赖 `@deepseek-ai/*` 包。

名字里带 dsh/deepseek、README 提到 harness、星数很高，都不算数。高星仓库的三类真实形态：

| 形态 | 特征 | 例子 |
| --- | --- | --- |
| **纯 patch 型** | 包内只有 cordis.patch.yml + README，零 JS | dsh-antibrow（把宿主 dsh-mcp-client 配一行） |
| **标准插件**（工具/双面UI/服务/适配器/预设） | 有主入口 apply + 各类注册 | dsh-context、dsh-agent-teams、modlens |
| **独立产品 + DSH 桥接子包** | 主仓库不是插件，但内含 dsh-* 子包是标准插件 | Agents-Anywhere（dsh-bridge/）、ReMe（reme-dsh-plugin） |

另外大量"高星非插件"（桌面壳、数据站、教程、精选列表、独立 agent 产品）在话题里混淆视听；
它们唯一的价值是：**消费生态数据时按快照指针+明细文件两段设计**、**判断插件只看三信号**。

---

## 一、patch 与插件装配（出现率最高的坑区，62/86 份深度笔记提及）

### 1.1 patch 的 config 是"整块替换"不是深合并（5+ 仓库独立印证）
- dsh-TUI 注释原话：`A patch replaces the targeted row's whole config, so each row below restates every key it owns`。
- dsh-desktop 的 `- id: ui-brand-official\n  disabled: true` 覆盖官方内置行；可选插件行要单独放一个 patch 文件（patch 引用不存在的 entry 会让 loader 每次启动都警告）。
- **写法铁律**：覆盖任何一行的 config 时，把该行拥有的每个 key 全部重述，漏一个就是静默丢失。

### 1.2 patch 里做版本自适应（!!js 求值读自身依赖版本）
dsh-TUI 用 `!!js` 表达式在 patch 求值时读 `@deepseek-ai/dsh-system-prompt/package.json` 的版本，0.1.3-alpha.2 之后用 `personaPrefix`、之前用 `persona`，同一份 patch 同时兼容新旧宿主：
```yaml
config: !!js >-
  (() => {
    const require = process.getBuiltinModule('node:module').createRequire(ctx.baseUrl)
    const version = JSON.parse(require('fs').readFileSync(require.resolve('@deepseek-ai/dsh-system-prompt/package.json'),'utf8')).version
    if (major>0||minor>1||(minor===1&&patch>=3)) return { personaPrefix }
    return { persona }
  })()
```
类似：dsh-antibrow 用 `!!js process.env.X` 直通环境变量；treg 用 `disabled: !!js` 做"无 token 自动禁用"；CloudBase 用 `baseUrl: !!js` 锚定包路径。

### 1.3 插件开关 = 改用户 patch 层的 disabled（免重启热启停）
dsh-market 的机制（从 dsh-plugin-hub 移植）：
- 写 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 的 `- id: X` + `disabled: true` 停用；`disabled: false` 强制启用。
- profile 配置 watcher（HMR）约 1 秒内重组合，不重启；重启后同样生效。
- 安全铁律：写操作串行化（防 read-modify-write 交错）；patch 文件不是合法 entry 列表时拒绝 append；**基础设施行受保护**（cordis:*、@deepseek-ai/cordis-plugin-*、dsh-host-*、dsh-client-*、tools/agent/llm/session/storage 一整串清单拒绝 toggle）。

### 1.4 bundle 的 code-level inject 要慎用（死锁案例）
dsh-TUI issue #183：CLI 从自己的安装锚点解析 bundle 的 cordis.patch.yml（通常全局 launcher），Loader 却从 profile 的副本 import 插件模块；两份不同步时 patch 里还没有某 row，硬 `inject` 会**死锁整个树**（`pending (waiting for service: xxx)`）。解法：把该服务从 code-level inject 移除，只在 patch 的 row-level inject 保留（存在时当顺序保证），代码内部走 local fallback。

### 1.5 聚合载具（family bundle）五段式
聚合载具（family bundle）的 aggregate.yml 五段式（patchFrom/deps/rows/tombstones/inactive）是 dsh-web 仓库**早期/自建形态**——0.2.0-rc.2 官方 dsh-web-app 包已无 aggregate.yml（只有 cordis.patch.yml + presets/*.patch.yml，patchFrom/tombstones 关键词全无）。参考价值在行 id 命名空间化（web-ui-* 前缀）防 duplicate entry + 生成脚本 --check 幂等门禁，不按官方契约写。

### 1.6 多 bundle 套件 = 一个 patch 数组
clearai 用 `dsh.bundle.patch: ["./cordis.patch.yml", "./presets/clearai/clearai.patch.yml"]`；Openwrite 的 suite 形态按产出物切包；每个子插件行 `name` 用 `@scope/pkg/<family>` 子路径让官方列表每行独立标题。

---

## 二、版本兼容层：高迭代宿主下的存活术（64/86 提及，全生态共识）

### 2.1 能力探测优先于版本号分支
- 事件名新旧并存：0.1.6 起 agent 就绪事件是 `agent/created（payload 恒带 source: 'startup'|'resume'|'clear'|'compact'，按 source 值判而非 'source' in payload）；SessionStartSource = 'startup'|'resume'|'clear'|'compact'）——agent/session/created 是旧版事件名，0.2.0 全包 0 命中
- 方法探测：0.2.0-rc.2 已移除 session.events（用 snapshotEvents；eventAt/ownEvents deprecated）；Settings 无 register 方法（用 describe/update/replace/configure）；官方无 WEB_SERVER_KEYS 常量（服务名就是 ctx.webServer）。
- 版本号分支只用在"补丁/配置键名"这类真的按版本变化的场景（dsh-TUI 的 persona→personaPrefix）。

### 2.2 进程级稳定符号做跨包通信
Symbol.for('dsh.subagent.queuePrompt') 等进程级 Symbol + 能力探测，替代对内部子路径的静态 import（子路径在不同版本可能不存在，静态 import 直接让插件加载失败）。

### 2.3 peerDependencies 的三种写法
- **精确枚举**（最可控）：`"@deepseek-ai/dsh-agent": "0.2.0-rc.2 || 0.1.7-rc.2 || 0.1.5-rc.3 || ..."`（agent-teams、dsh-TUI）。
- **范围 + 兼容性矩阵**：`dsh.compatibility.dshReleases: { "0.1.5-rc.1": "compatible", ... }` 声明"测过的版本"（dsh-context、dsh-im 还加 `profiles: ['web']`）。
- **rc 期区间**：`">=x-rc <下一主版本"`（ANOLISA 经验）。
- 注意：peer 声明是**启动期硬约束**，caret 跨 minor 不成立；写清单只列实际验证过的宿主版本，"未测"不要写成"不支持"。

### 2.4 版本基线门（fail-open）
apply 时探测宿主版本：低于支持基线给 fallback 单元（零数据 + 门记录）；检测失败 fail-open 进正常组成（dsh-context）。`dsh.compatibility.dshReleases` 里的"unknown"档表示未验证。

---

## 三、webServer 路由与浏览器信任围栏（42/86 提及）

### 3.1 注册姿势
- `ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => {...}))` 延迟到服务可用再注册，返回 dispose 函数。
- `{ kind: 'exact', path, handler }`：exact 用于健康检查/单文件；`kind: 'prefix'` 用于静态托管目录（剩余路径段自己解析，必须做路径穿越防护：`resolve(root, rel)` 后 `abs !== root && !abs.startsWith(root + sep) → 403`）。
- 本地文件服务先 stat 再读，超体积上限 413。
- 每个 handler 先查 method，不支持就 405 + allow 头。

### 3.2 信任围栏（DNS-rebinding 防御，不是认证）
- DSH 的 /api 网关接受 "loopback OR 已声明 authority"（`--trusted-host <name>` + 绑定 0.0.0.0 被拒：web-app/startup.js 对 --host 0.0.0.0 直接报错拒启动（"would expose remote code execution"）；LAN/反代部署正解是 --trusted-host <authority>（可重复、port-less 匹配任意端口），经 webStartup 服务注入 connection Config.trustedHosts
- **血泪坑（dsh-market #729）**：exact 路由赢过 /api fence 的 prefix 匹配，永远见不到它，必须自己决定 → 只信 loopback 会让所有经域名（反代/隧道/LAN 主机名）到达的部署写路由 403 而读路由正常，表现为"安装按钮点了没反应"。
- trustedHosts 是 ConnectionConfig 配置项，HostConnectionService 构造时快照入私有字段，**不暴露 live getter**；isLoopbackHostname 宿主明确不导出（package-internal），插件只能复制语义。判定 = Host 头是 loopback（127/8、localhost、[::1]）或属于 trustedHosts，**且** Origin 语义：无 Origin 放行（浏览器读）、有必同源、null Origin 拒绝、sec-fetch-site cross-site 拒绝。better-sidebar 把 /api 网关的 fence 逻辑整体复制过来（BSD-3 注明出处），不 import 内部模块。
- mutating 端点：same-origin POST + curated 来源白名单（dsh-market 安装路由）；`isTrustedApiRequest(request, trustedHosts)（不存在 isTrustedRequest(req, mutation) 两级函数；单级：loopback/trustedHosts + sec-fetch-site 非 cross-site + Origin 同源（无 Origin 放行、有必同源、null 拒绝）；/api 是 kind:'prefix' 路由 + handler 内 admit() 双级 403/401，exact 表优先——'exact-table miss 后才走 prefix'）(req, mutation)` 两级（只 loopback vs 还要 Origin 校验）。

### 3.3 长任务取消与 effect 内 throw 的坑
- 从请求取取消信号（req 'aborted' / socket 'close'）传给运行时；插件卸载统一 AbortController。
- **effect 内 throw 会被吞**（dsh-market）：路由静默不挂载、所有请求 404、无任何日志 → throw 前先写 log。

### 3.4 wire 协议约定
统一 `{ok:false, error:{code,message}}`（机器可读 code 枚举）+ `{ok:true, value}`；body 读取有上限（1MB）；JSON 解析失败 → bad-request。dsh-market 的 `/capabilities` 返回能力位图（features 位），客户端据此渲染 UI，不靠探测端点路径。

---

## 四、客户端（browser）半区的工程纪律（62/86 提及）

### 4.1 客户端模块扫描只看宿主 Loader 行
任何要出现在浏览器里的 UI 必须插在 patch 的宿主平面（insert 行）；放在 agent 预设里的行浏览器看不见（dsh-worktable）。

### 4.2 __ModuleLoader__ 握手与 external 白名单
- 客户端产物保持 `window.__ModuleLoader__.load({ id, factory })` 结构（CJS factory 形态；ESM import / 顶层 return / JSX 任一出现即加载失败）。
- react、react/jsx-runtime 与所有 @deepseek-ai/* 必须是 external（宿主提供），不能打进 bundle——两份 React 会导致 hooks 失效。
- 插件客户端改动必须重建聚合 bundle（profile link 安装下宿主代码是新的、页面仍跑旧 UI）。

### 4.3 settings.section 渲染契约（血泪坑）
宿主 ui-settings 的 settings.section 槽（真实注入 = ctx.slots.inject('settings.section', () => ctx.slots.register({...}, Component))，组件必须是 (props)=>ReactNode 函数）期望 **React 渲染函数**（register(descriptor, () => createElement(...))）；写成"返回带 render() 方法的对象"会抛 React #130（slot entry crashed）白屏。官方 primitives（SegmentedControl/Switch/StateDot/Tag/Button）优先复用。

### 4.4 模块级可变状态会静默分裂
同包经多个入口 artifact 加载时每个入口持有自己的模块拷贝，模块级可变单例状态分裂（路由重复注册 + 另一个入口伺服空状态）→ 跨条目/跨拷贝状态一律走 globalThis Symbol 注册表（Symbol.for 键，跨仓库契约，改变键形状会互踩）。

### 4.5 客户端注册必须包 ctx.effect
所有 slots 注册/事件监听/定时器在 client 半区也按 Cordis 生命周期走，卸载时回收，否则 HMR 后重复注册。

---

## 五、事件、生命周期与状态（33/86 提及）

### 5.1 自定义 session 事件类型必须先注册词汇表（最危险的静默故障）
graph-memory + working-activity 双重印证：自定义 session 事件类型不在宿主的 `KNOWN_SESSION_EVENT_TYPES`（generated 只读集合，**注册机制被官方否决**——known-event-types.d.ts 注释原文 "event-name registration was rejected"）。持久化读取只认 `ignorable: true` 信封标记（lib/index.js：未知类型+ignorable=true 才接受），自定义事件必须写 ignorable:true，不存在"注册事件名"操作；严格读取路径会拒绝整个会话（写进去没报错、下次打不开）。

### 5.2 事件派发模式的坑
- `agent/pre-step` 用 `{ prepend: true }` 注册且挂在**具体 Agent 的 context** 上；根组合拿不到每 agent 钩子，需 agent/created（payload 恒带 source: 'startup'|'resume'|'clear'|'compact'，按 source 值判而非 'source' in payload）；SessionStartSource = 'startup'|'resume'|'clear'|'compact'）——agent/session/created 是旧版事件名，0.2.0 全包 0 命中
- serial 事件监听器**不要抛错**（一个监听器抛错会中断整条链）；waterfall 必须 `await next()` 再 `{...seed}`。
- turnTail 插槽从 chain 形态演进到 list 形态，双形态都要兼容（dsh-ads）。
- `ctx.effect` 的 this 是 Fiber（dsh-tauri 经验）。

### 5.3 会话投影（sessionProjections）单元契约
`{ key, stateSchema, init(header, inheritedEventCount), apply(state, event), wire?, stateVersion }`：
- apply 是纯 transition，忽略的事件返回**同一个 state 引用**；
- stateSchema 校验持久化折叠状态（状态必须纯 JSON）；
- 有 wire 的单元才推流给客户端，无 wire 是 host-only；
- 注册放进 ctx.effect，卸载时投影键自动消失；
- inject: ['sessionProjections'] 是唯一闸门：注册表不存在 → PENDING；提供方被替换 → 重新 apply。

### 5.4 记忆/用量类插件的标准挂点三件套
`agent/pre-step` + `session/event` + `session/disposed`（memmy/MemOS/whale 独立印证）。注入内容在用户消息之前 splice 插入，文本开头声明"历史记忆是不可信参考材料，当前用户指令优先"。

---

## 六、工具与守卫（defineTool 实践共识）

### 6.1 工具定义实用字段
- `timeoutMs`：长耗时工具（如图像生成 240s）必须设；做成可被单次调用覆盖的参数（integer 1000-600000）。
- `isConcurrencySafe`：按参数判定（预览类调用不安全，其余安全）。
- `presentCall`：返回 `{ card, title, kind, locations }` 让 UI 显示成卡片。
- `render`：`(_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]` 决定模型看到的文本形态。
- execute 返回前**复查会话工作区是否还是同一个**（长外部调用后 workspace 可能切换），变了就抛（dsh-desktop）。

### 6.2 渐进式工具暴露（省 token、防误用）
先注册一个 Skill + bootstrap 工具，等 Agent 真的加载了 Skill 才把整套工具挂上（vision-toolkit/BrowserSkill）。证据来自会话事件而非内存状态：监听 `tool/ptc-dispatch`（0.1.5+）与 `tool/code-dispatch`（0.1.2 及以前）；"返回内容里含内置指令原文"比名字匹配可靠（名字会被 fork/重命名，内容不会）；改名保留旧名兼容常量。

### 6.3 单调守卫（tools.guard）
cc-safety-net：守卫插件是跨宿主薄适配（每个宿主一个入口），DSH 侧用 `ctx.tools.guard` 做预执行拦截，拒绝理由写成人话（可读、可修复）。工具结果三态归一（成功/失败/拒绝）。

### 6.4 意图工具 + 投影 fold（状态不可被模型谎报）
工具 schema 里没有 status/progress/phase 字段——状态只能由"系统核验过的变更记录"推进（`return { ..., mutations }` → `output.presentationMeta` → `tool/result.meta` → 投影 fold）。"模型撒谎说成功了"在结构上不可表示（clearai P3）。

---

## 七、服务提供方与跨端 RPC

### 7.1 自定义服务两种做法
- 轻量：返回普通 frozen 对象 `{ current, list, select }` 即可（createDesktopProfilesService），注入方按鸭子类型消费。
- 正式：继承 `Service`，`super(ctx, '服务名')`；用 `ctx.provide('name', impl)` 也行。
- **扩展生态**：注册表服务 + `declare module '@deepseek-ai/cordis'` 类型增强（better-sidebar），消费者 `import type {} from 'pkg'` 即获得类型；re-export 描述符类型让下游不 import /client。

### 7.2 Typert RPC 的坑
- TypertRemoteService 的 `this.ctx` 要重绑（方法被解构调用时 this 丢失）。
- **自注入死锁**：服务依赖自己会死锁，可选服务用 `ctx.get(name, false)` 判 undefined，不能因 inject 未声明就属性读（agentrq）。
- 覆写宿主服务方法要同时接管**实例与原型**（cordis 取用代理会吞掉实例级赋值，dsh-tauri）。

### 7.3 MCP 客户端桥接
- 插一行 `@deepseek-ai/dsh-mcp-client` 就能给模型一批工具（`mcp__<server>__<tool>` 命名空间由宿主接管）。
- `ctx.plugin(mcpClient, {...})` 作子 fiber 挂载：端点配一次、生命周期共享（agentrq）。
- 外部 CLI 版本要钉下限并写明可验证的行为理由（antibrow：2.19.1 是第一个真正结束进程的版本，更老只断连接 → 浏览器残留/锁死/许可证占满）。
- 生产环境 `failOnStartupError` 与单调守卫拦截。

---

## 八、配置、凭据与热更新

### 8.1 Schemastery Config 的坑
- `z.object({})` 有隐式 `{}` 默认 → 可选字段必须显式 `z.union([z.object({...}), z.const(undefined)])`（agent-teams）。
- 0.1.6 的 `settings.register()` API 已删；0.1.7+ 把插件 Config 的 volatile 字段投影到 ctx.settings → 兼容写法：运行时探测 `typeof service.register === 'function'`，新版用 describe()/update() 读写 + 监听 `settings/document-updated` 事件。
- 配置校验全部前置且抛 TypeError（区间/正整数/成对参数/引用名格式），不等到运行时才炸。

### 8.2 凭据只放引用
配置里只放**环境变量名**（用 /^[A-Za-z_][A-Za-z0-9_]*$/ 校验是合法引用名），运行时 `ctx.credentials.resolve(ref)` 解析真实值；可选能力读取失败静默禁用 + 日志警告，不阻断主流程。插件不落明文（whale/whale-widget）。

### 8.3 热更新 = prepare-before-swap
新配置先完整 prepare 成功才替换运行时（generation 计数 + reconfigure ticket 防并发乱序）；失败的 Settings 编辑绝不打断进行中的调用；纯展示/策略类开关在算指纹前强制归一化，避免切换显示开关重建整个运行时（vision-toolkit）。

---

## 九、环境与平台坑（跨平台/宿主环境）

### 9.1 Windows
- `import()` 必须走 `pathToFileURL`（否则 ERR_UNSUPPORTED_ESM_URL_SCHEME）。
- junction（Windows）/ symlink（类Unix）把 checkout 源码链到 node_modules：`symlinkSync(target, link, 'junction')`。
- `NODE_OPTIONS` 按空格分词（DSH-X 坑）；`process.execPath` 在 macOS 是 Electron helper，子进程要显式 `ELECTRON_RUN_AS_NODE=1`，否则 exit 0 但不干活。
- 杀进程树：Windows `taskkill /pid <pid> /t /f`；macOS/Linux `process.kill(-pid, 'SIGTERM')`。
- DSH 会 scrubbing 子进程凭证 env，需要时强制转发。

### 9.2 DSH_HOME 解析
三条规则照抄官方语义：DSH_HOME 优先（空/纯空白视为未设置）→ 否则 ~/.dsh；支持 ~/ 展开；相对路径按进程 cwd 解析；结果绝对化。**禁止业务代码直接拼 homedir()/.dsh**（自定义 DSH_HOME 会读错数据）；优先调官方 @deepseek-ai/dsh-home-paths 的 resolveDshHome，不可用才回退自实现；回退实现不能反向依赖被回退的功能（成环）。

### 9.3 junction 链接下的模块解析
插件经 junction 链接进 profile 时普通 import 解析不到 profile 级依赖 → 同时尝试 import.meta.url 与其 realpathSync 两条祖先链，逐级 createRequire 探测；再兜底 DSH_HOME/profiles/*/node_modules。探测必须有界（记录尝试次数、避免重入）。

### 9.4 Electron/打包环境
- Cordis HMR 需要 Node 内部模块 loader，Electron 打包环境没有 → 自备 hmr-fallback（文件 watcher + callback 阉割版，inject: ['loader']）。
- 日志桥：ctx.logger 只有内存环形缓冲，进程退出即丢 → 宿主自己挂 exporter 写 stderr 落盘；默认导出级别过滤 warn，需显式调 level。
- 同 tag 资产不可覆盖：坏包发新版本号，不替换已发布 tgz。

---

## 十、发布与验收纪律（跨仓库共识）

1. **npm pack --dry-run --json 核对打包清单**：files 写错只在发布后暴露；locale/ 图标/lib 全入库。
2. **readPluginMeta 直接调**：exports 白名单缺失 → 卡片空白（补 "./package.json" 与 "./locale/*.json"）。
3. **三层打包门禁**（dsh-worktable）：结构清单断言（无 src/、无 .map）→ 独立临时目录 npm install 后 import() 断言导出与 inject → 客户端工厂求值门禁（ModuleLoader 恰好注册一次 + external 白名单）。
4. **compatibility 声明是"测过的版本"不是"能跑的版本"**：只列实测版本 + 测试日期；未覆盖平台写"未验证"。
5. **dsh.plugin.json 不是契约**（子代理共识）：真契约 = package.json 的 dsh.bundle.patch + dsh.client + exports["./client"]。
6. **发布 beta 纪律**（dsh-plugin-shop）：beta 版本不替换 stable；capabilities 接口标 stability: 'beta' 直到形状稳定。
7. **免启动反证**：宿主公开纯读取函数直接调真值（Windows pathToFileURL 坑）。
8. **真实浏览器验收**：Playwright 指本机 Chrome、domcontentloaded、dialog 处理器、force=True 不等于命中（遮罩吞事件）、写操作后回读磁盘。

---

## 附：值得复刻的最小参考插件

- memmy-agent 的 DSH 适配器约 90 行：agent/pre-step 注入 + session/event 捕获 + disposer 逆序清理 + schemastery Config——新插件照抄这个骨架即可起步。
- superdesign-skill/treg：纯 ctx.skills 分发的最小技能提供方（无构建链、纯 ESM、frontmatter 单源解析）。
- WeKnora：结构性类型免运行时依赖（纯 JSON Schema 拒绝 schemastery 实例）+ config 全环境注入。


---

## 十一、社区沉淀的进阶细节（补充条目）

### 11.1 LLM 适配器包装（modlens 的完整踩坑）
- `ctx.llm.registerAdapter([providerId], {...})` 基类（LlmAdapter）已实现全部默认方法：
  providerInfo→{id,name}、providerRetryPolicy/imageRequestPricing→undefined、prepareCall 基类实现调
  resolveModel+stream——**只有 stream 是 abstract 必须实现**。漏实现抽象方法才是静默注册失败。dsh >= 0.1.1 所有调用（含 replay）
  都走 prepareCall；>= 0.1.2 无 feature check 就调 imageRequestPricing。
- 注册时宿主会 **snapshot** providerInfo / providerRetryPolicy；上游变化需要**重新注册**才能刷新。
- `DUPLICATE_ADAPTER` 错误按"竞争成功"处理（不当作失败）。
- `listModels` / `resolveModel` 要按家族 + inputModalities + 名字正则三重过滤包装目标，
  避免把真视觉模型也包一层。
- adapter 的 stream 里可以把消息中的图片块在**请求时**转成证据文本（持久日志保留原图块，
  wire 上换文本），既省 token 又可回放。

### 11.2 工具命名必须避开宿主保留名（静默走错路）
宿主自带的 `read_image` 与插件同名注册**不报错**，但模型会解析到 scope 内更强的那个 →
静默走错路径。对策：用自有命名（如 `<plugin>_read_image`），并在注册失败时 console.error
大声降级（modlens issue #34）。

### 11.3 ctx.inject 分包是兼容利器（inactive context）
bundle loader 调 apply 时外层 ctx 可能仍在等服务，直接读 `ctx.llm` 会抛 "inactive context"。
把相关注册全部放进 `ctx.inject(['llm'], scope => ...)`——Cordis 只在服务激活时启动子作用域
并连带注销监听，天然适配"web profile 才有、headless 没有"的服务（modlens issue #79）。
无 inject 的旧宿主走 feature-detect 退化路径。

### 11.4 缓存与重试的三个纪律
- **失败占位文本必须是常量**：每次失败措辞不同会改写 wire history 并 bust 提供方的前缀缓存。
- **缓存 key 用文件身份而不是路径**：`dev:ino:mode:size:mtimeNs`（路径可被替换/软链）。
- 失败进短期 cooldown（如 60s）而非永久缓存；LRU + 在飞请求可 join（pending 不逐出）。

### 11.5 运行中宿主版本的可靠识别（dsh-plugin-shop）
不要从 node_modules 走查 `@deepseek-ai/dsh` ——插件自身依赖会被 hoist/链接农场重指，
实测把运行中的 0.1.5-rc.3 误判成 0.1.2-rc.1。可靠做法：**realpath 解析启动本进程的 bin 脚本**
→ 其所属 package.json 的 version 就是运行版；其 import 的 `@deepseek-ai/dsh-app-boot` 的
PROFILE_TEMPLATES 就是当前模板表。运行信息一次读取并缓存（进程内不变）。

### 11.6 兼容判定借用宿主实现，不要自己重写
0.1.7+ 宿主自带 `evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)` 与
`readProfileVersionExemptions(profileDir)`。自己重实现必与真实拒绝行为漂移；直接调用宿主
判定来预测安装拒绝。注意该 API 默认每次重读 manifest（实测 75ms/2000 条），调用方要缓存。

### 11.7 权限与沙箱随 profile 打包（漏了就是"装上但没工具"）
`sandbox-policy` + `approval` + `permission` 三行联动定义多档预设
（read-only / workspace-write / danger-full-access × ask / never），并显式恢复被通用 profile
禁掉的工具：`tool-bash` / `tool-pwsh` 按 `process.platform` 互斥 disable，
`tool-fs` / `tool-web` 显式 `disabled: false`。桌面型 Agent 插件漏掉这步就是
"装上但模型没有命令/文件工具"的静默失效（dsh-tavern）。

### 11.8 对官方包 monkeypatch 的三条安全前提（最后手段）
1. 用 `createRequire` 从**正在运行的** DSH runtime resolve 官方包，不依赖自身 node_modules；
2. **先断言包版本与目标源码原文精确匹配**（挂 assert，官方一变就大声失败）；
3. 用 data: URL 重打包 import + `Object.defineProperty` 打/还原原型补丁，
   **多实例引用计数**（最后一个释放才还原），WeakSet 标记已处理会话。
仅当官方版本被精确 pin 时才安全（dsh-tavern）。

### 11.9 token 计量要补偿 CJK
宿主 `tokenMeter.estimateMessage` 按固定 4 字符/token 估计，严重低估中文 →
中文场景自己加保守下限（nonAscii 每字符按 2 token 起算 + 固定开销）（dsh-tavern）。

### 11.10 粘贴/附件落盘的安全要素（modlens）
magic-byte 嗅探（PNG/JPEG/GIF/WebP/HEIC 白名单 + ftyp 品牌校验）+ 体积上限；
私有临时根目录 0700 且 `lstat` 校验 leaf 非 symlink（防 /tmp 符号链接攻击）+ owner 校验
（Windows 无 getuid 则跳过）；过期清扫 TTL（如 7 天）+ 总字节上限（如 1GB）。
浏览器侧捕获用 capture 阶段监听；React 受控 textarea 需要 input 事件，
contenteditable 无 value setter 走原型 setter 兜底。

### 11.11 安装即副本的过期检测
安装到机器上的 skill/资源是**安装时快照**，永不跟随发布更新。可扫描各 harness skill 目录，
读取内嵌的版本标记并与当前 CLI 版本比对，尽早暴露停驻的老副本（modlens issue #33）。

### 11.12 受管进程安装模式
真正的 pnpm 安装跑在**外挂 manager 进程**，插件进程内只做编排与状态机，输出流式转发；
支持"不改 profile 文件、进程内热挂载"（`hotMount`/`hotUnmount`，nodeHotFs 拦截 fs 层）。
失败要有超时与宿主退出兜底（dsh-plugin-shop）。

### 11.13 pre-step 注入的完整姿势（memsearch）
- 监听 `agent/pre-step` 时**先 `await next()` 拿决策**，按需改判返回 `{ kind: 'enter', messages: [...] }`；
  `{ prepend: true }` 把监听器排到最前，别人的注入可以被它再包一层。
- 只改消息不改决策语义：step !== 1 直接放行、无搜索结果原样返回 decision（零成本）。
- 消息形状用 `@deepseek-ai/dsh-llm` 的 `createUserMessage` 工厂（`source: {kind:'plugin', plugin, form:'snapshot', sections}`），
  找不到模块就退化为手写同形状 `Object.freeze` 对象——注入绝不硬失败。
- 审查/提醒类动作用 `agent.inbox.append('next-turn', message)` 排到下轮，绝不打断运行中的 turn。

### 11.14 长驻 web 面不要假设 process.cwd()
session 的持久 cwd 在 `session.header.cwd`；多个项目并行时按 session 取项目目录，
用 `ctx.agents.get(sessionId).session` 反向解析，不是启动目录。

### 11.15 webServer 起步前重试再放弃（headless 兼容）
不声明 inject 硬依赖（headless/tui 组合永不提供 webServer），用 `setInterval(tryRegister, 1000)` +
`unref()` + `once` 标记重试：服务出现即注册，headless 静默跳过；unref 保证不 hold 进程。

### 11.16 文件浏览路由的路径纪律（补充）
`resolve` + `pathIsWithin` 双重校验（防 `../` 逃逸），再 `realpathSync` 校验符号链接不指向根外；
只读扩展名白名单 + 体积上限；GET 不渲染、POST 才写。

### 11.17 CLI 包装三件套（memsearch）
- 探测命令用 `bash -c 'command -v X'` 而非 which（看全 PATH）；
- 命令串可能含引号/参数时全部经 `bash -c` 执行并 shellEscape 参数；
- 读配置区分 `{ok:true,value:null}`（确认未配置）与 `{ok:false}`（命令失败/超时）——
  失败不可当作权威"未配置"，否则首次冷启动会把 auto 模式静默翻错。

### 11.18 非阻塞捕获的背压
LLM 摘要串行化（promise 链），捕获失败仅记日志不中断；摘要器超时 killProcessTree；
定时维护 `setInterval` + `unref` + due-state 门（每任务每 interval 至多一次）。

### 11.19 生命周期注入必须延迟到"首个持久信号"（Aegis）
在 `agent/created（payload 恒带 source: 'startup'|'resume'|'clear'|'compact'，按 source 值判而非 'source' in payload）；SessionStartSource = 'startup'|'resume'|'clear'|'compact'）——agent/session/created 是旧版事件名，0.2.0 全包 0 命中
首个模型请求之前，破坏依赖"无菌首请求"基线的轨迹预设。正确做法：每个会话边界只 ARM 一次
注入（记录 sessionId→agent 映射），等会话发出第一个**持久化**信号（`tool/call` 或
`assistant/message`）才真正 `agent.inject(message)`；`compaction/end` 重新 ARM
（压缩后的首个请求是"第二个首请求"）；没有稳定 session.id 的会话直接跳过。
调度要可回收防竞态：apply 返回 dispose 清掉所有订阅与状态 Map；每个 delivery 记录 epoch，
触发时校验 sessionId→agent 未变、epoch 未变，过期即丢弃；`agent/disposed` 时取消该会话
所有待投递。

### 11.20 注入文本必须带合法 source（会话格式 v4）
session v4 要求 producer-owned 的 `source.kind`（如 `plugin:<name>`、`form:'instructions'`）；
0.1.7-rc.1 弃用了 "plugin" wrapper 里的 "plugin" 字段。没有合法 source 的注入会被会话格式
校验拒绝（以官方类型声明为准）。

### 11.21 纯技能 bundle 的教科书形态（superdesign-skill/treg）
- bundle **绝不 import 宿主 in-box 包**：`ctx.skills` 的 `registerProvider` 契约（list/get）
  是稳定接缝，直接实现它（官方 dsh-skill-badge 同款）——零 `@deepseek-ai/*` 依赖的标准形态。
- `list` 返回 `{ name, description, invocation:{modelInvocable,userInvocable}, provider,
  source:'bundled', resourceBase:{kind:'directory',path}, rank, locator }`；`get` 额外带
  `content`。`rank` 取 600（官方 bundled 源 rank），不在 rank 上跟官方内置技能打架。
- 纯 ESM、零构建是 **git 直装的硬约束**（`dsh plugin add github:...` 抓源码不抓产物；
  `prepare` 脚本会让每个用户先 allowlist 构建才能首装成功）。
- SKILL.md frontmatter 描述用**正则解析**不引 YAML 依赖；load 失败返回 undefined/[] 而非抛错。

### 11.22 MCP 连接器无凭据时整体禁用 + !!js 表达式若以 ! 开头必须带引号——js-yaml 4.3.2 实测无引号 `!!js !ctx.get(...)` 抛 "duplication of a tag property"（必然解析失败）；`name: @scope/pkg` 无引号抛 "bad indentation of a mapping entry"（不是解析成指令）。官方 dsh-base 原文 disabled: !!js "!ctx.get('profileContext')" 就这么写（treg）
- 注册一个没有 token 的 connector 得到的是常开工具、每次调用都 401：`disabled: !!js
  (process.env.X ?? '') === ''` 让 patch 行缺 token 时根本不挂载。
- **patch 里 `!!js` 表达式不能以 `!` 开头**：YAML 会把第二个 `!` 读成又一个 tag
  property，整文件解析失败，**整个 profile 跟着挂掉**。模板字面量写法（反引号包
  `Bearer ${process.env.X}`）是安全的。
- 技能与凭据解耦：SKILL.md 零成本常开当说明书，引导用户配 token；工具在 token 就绪后出现。

### 11.23 外部二进制桥的防御模板（deja-vu）
- 对缺失 peer 的宿主包必须 `await import()` + try/catch 降级（直接 throw 会带崩整个 profile）。
- 二进制解析：用户显式环境变量 → PATH 同名命令 → npm 平台 optional 包（require.resolve），
  每个候选跑 version（超时 5s）验证真能执行；全失败保留裸名让报错指向缺失物。
- `execFileSync` 带 `timeout/maxBuffer`、stderr ignore，任何失败返回 "" 不抛（记忆是
  可选能力，throw 会终结回合）；"是否已装"加载时探测一次，区分"没装"与"没匹配"两种空结果文案。
- 用户文本拼 CLI 参数：显式命名子命令（裸首词会被当子命令）；以 `-` 开头的查询会被当 flag
  → 需要时加 `--` 终止符，且只在需要时发（老版本不认识 `--` 的子命令仍能应答）。
- `systemPrompt.context` **重名注册 = 整个 profile 加载失败**（不是局部错误）：所有注册用
  guarded() 包装吞掉重名；自动召回走 context 的 assembly 回调而非 agent/pre-step
  （pre-step 拼接会被后续 listener 重建答案时丢弃）。
- `defineTool` 的 schema 必须是普通 JSON Schema（schemastery 实例被宿主拒绝）。

### 11.24 组合包与原生二进制分发的工程细节（mnemon）
- 组合包 = 薄 patch + `dependencies: { "pkg": "latest" }`，patch 行保留原包名
  （"preserves its host and browser plugin identities"）；发布新插件版本无需改装配仓库。
- Go/Rust 二进制按平台分发：npm 包只放 JS shim，真实二进制在 `@scope/pkg-<platform>-<arch>`
  optional 包；shim 用 `require.resolve` 定位，缺失报 `Reinstall with --include=optional`。
- Windows 驱动 npm：`.cmd` 不能直接 spawn（无 shell 时），找 `npm-cli.js` 用
  `process.execPath` 执行；所有 spawn 显式 `windowsHide: true`。
- CLI 自更新必须先证明"自己被 npm 管理"（realpath 等于 npm root -g 的同名包），否则引导迁移。

### 11.25 wiring-only apply + 可测试性分层（reddit-radar 教科书）
- apply() 只做装配；业务逻辑不依赖 dsh，fetch/store/writeReport/sleep/now 全部接口注入，纯离线单测。DSH API 只出现在最薄的 wiring 层。
- **storageDomain 用 `ctx.get('storageDomain')` 探测 + 文件回退**；探测到就在 ctx.effect 里 async 打开 domain（open 返回的 handle 必须由调用方 close 做 disposer）；清单里绝不写死 inject 只在部分组合存在的服务（写进去会让插件在别处 PENDING）。
- **默认导出是毒药**：dsh Loader 的 unwrapExports 遇到 default export 会 collapse 模块并丢弃 inject，然后 ctx.tools 被 Guard 拒绝。插件模块绝不能有 default export。
- 动态拉取的远程 MCP 工具：参数 schema 不手抄，从远程 tools/list 的 JSON Schema 原样转发（落在宿主 JSON Schema subset 内即可透传，不用 defineTool 的编译期 DSL）；转发注册放独立 ctx.effect 且不 await，失败只 warn 吞掉。
- **状态推进语义**：transient（暂时失败）不推进 lastRunAt 让 heartbeat 尽快重试；非 transient 才推进，否则 heartbeat 每小时重试。写状态要幂等（基于最新 persisted 而非 before）。
- run 串行化：heartbeat 与手动工具碰撞时第二个调用者直接跳过（running 标志 + finally 复位）。
- **错误分类错误比错误本身贵**：fetch 失败/读 body 失败都算 networkError，不能吞成 status:200 空结果——否则一次坏响应会把未见数据永久标记为已见。
- **tsc 不重写相对 specifier**：extensionless 的 `./client` 编译后 Node ESM 直接 ERR_MODULE_NOT_FOUND，dsh Loader 裸 import 也救不了——相对 import 一律带 `.js` 后缀，且"npx tsc 通过"不证明产物可加载，要用真实 Node import 断言。
- sleep 用 `ctx.timeout(ms)`（宿主定时服务）而非裸 setTimeout。

### 11.26 插件互操作协议与命名空间治理（T-Auto/dsh-std）
- 插件生态第三层建设 = 跨插件契约：命令格式 / 连接语义 / 消息 schema / 存储命名空间 / UI 组件规范。做"通用能力"插件按 core → 能力域（command/connection/messages/storage/skill/tool/ui）→ sdk → 宿主 adapter 分层组织。
- namespace-guard 防止插件间命名冲突，与 DSH slot 命名空间化（web-ui-* 前缀）同理。
- 协议包是约定不是宿主 API：引用前确认 peer 依赖已装；rc 版本频繁演进，兼容层照用。

### 11.27 独立产品 + 插件子目录形态（summer1238/dsh-remote-web-gateway）
- 插件放 `plugin/` 子目录（自带 package.json/pnpm-workspace/tsdown），与仓库主体隔离；安装用 `dsh plugin add link:.../plugin` 或 GitHub 子路径。
- 远程访问类插件：pairing 一次性配对 + JWT 会话凭据 + 代理只转发授权路径 + 本地默认只绑 loopback；"根无 dsh 声明 ≠ 仓库非插件"，判定要进子目录看。

### 11.28 patch 行 name 必须完整 scoped + @ 开头加引号（LLM 适配器共识）
- pnpm 按真实 scoped 名链接包：`name: dsh-xxx`（无 @scope）会 ERR_MODULE_NOT_FOUND 崩启动。
- **YAML 标量以 @ 开头会被解析成指令/指示符**，必须加引号：`name: "@scope/pkg"`。

### 11.29 "两行 patch 拆分"：核心服务行 + 路由行
- 路由行只挂 `webServer` 存在处（`ctx.inject(['webServer'])` 或 patch 条件），headless 不激活；
  核心行任何 profile 都可用。**按服务存在性拆行是 profile 兼容的标准做法**（data-agent）。

### 11.30 group 行做整组开关（记忆桥）
- patch 里 `group: true` 行自身 disabled **恒 false 短路**（`if (this.options.group) return false`）；组开关表达式经父链（parent.ctx.fiber.entry 逐层）
  级联到子行——"一个总开关控制整组"。
- provider 插件化：记忆后端做可插拔 provider 子包，`dependencies` 拉全部、运行时按配置选。

### 11.31 晚挂载服务的三种延迟注册姿势（chat-import）
- webServer：`ctx.inject(['webServer'], ...)`（apply 时 ctx.get('webServer') 仍为空）；
- commands：headless 不挂 → 服务可用时注册，不阻塞插件激活；
- 核心事件（session/created 等）host 必备 → 直接 `ctx.on`。

### 11.32 llm/stream 瀑布嵌套计费防重（cost-meter）
包装路由适配器会多次触发下游计费监听器——用 AsyncLocalStorage 标记当前请求已计费，
usage 只在最外围记一次；峰谷按请求发起时刻归档。

### 11.33 tombstone 追加式删除（不可变日志契约）
不可变事件日志下删除 = 追加空消息 + 专用 provider/model 标记；`surfaceOrigins` 链追溯 +
`turnBracket` seq 区间定位；压缩回合拒绝删除。

### 11.34 __ModuleLoader__ factory 只注入 require（recall-unread）
`window.__ModuleLoader__.load({ id, factory })` 的 factory **必须 return 导出、不能碰
module/exports 变量**——使用即启动失败；客户端注册（slots/事件）必须包 ctx.effect。

### 11.35 loader 行名必须 = 包名（client-modules 契约）
0.1.2 起 client-modules 扫描按包名匹配 loader 行：别名 → UI 静默消失（零报错）。
bundle patch 指向子目录时同样按包根 specifier 扫描，子路径行 UI 不挂。

### 11.36 工具注入档位可配置（injectTools 三档）
`'off' | 'minimal' | 'full'` 按档位注销/重注册工具——工具注入量是上下文预算的一部分，
可配置化；历史 boolean 设置要归一为三档字符串。

### 11.37 自更新纪律（TUI 系）
缓存 TTL（1h）权衡；npm-only 判定（先证明自己被 npm 管理）；缓存落包 home 而非 workspace；
`SKIP_UPDATE` 环境变量 + CI 检测跳过更新。

### 11.38 patch 平台条件做"运行时替换"（win32 / skin 系）
官方行 `disabled: true` + 自研行 `insert` 精确互斥（如按 `process.platform` 切换
subprocess-local 与自研实现）；跨平台差异单独成模块，避免两套逻辑纠缠。

### 11.39 接管宿主 provider/服务 = 替换其 config 行而非只禁用旧行
无优先级链时"禁用旧行 + 插新行"会留下钉子（旧 provider 仍注册同名能力）；正确做法是
**钉死 config 行**（`- id: <官方行>
  config: { ...restate 全量 }`），全量替换必须重述
基座原值。客户端扫描只认裸包名行——纯 client 形态必须保持裸包名 UI 行让浏览器发现。

### 11.40 对官方包做指纹门（版本 + sha256 清单）
接管官方能力的插件在加载时断言目标包版本与内容哈希匹配清单，不匹配大声抛——防止
静默接管被官方升级打碎（AuthInOne）。

### 11.41 host 空 apply + 纯 client 是合法形态
皮肤/桌宠类插件 host 半可以只有 `export function apply() {}`；但浏览器侧 UI 必须
保持裸包名 loader 行（客户端扫描按包根 specifier 发现）。

### 11.42 typed OAuth 凭据适配
字符串凭据适配成 typed OAuth 存储：断言结构 → 串行化刷新 → **刷新与取值同快照配对**
（先取快照再刷新，避免读到刷新前后的混合状态）；Settings API 双版本适配器。

### 11.43 IM 通道插件模板（qqbot）
中间件栈 + 双向传输 + 会话映射三件套；凭据用 `__FROM_ENV__` 占位符 + 扫码绑定回写
profile；审批/提问渲染成 IM 平台原生卡片按钮。

### 11.44 安全导出模板（config-manager）
加密口令仅内存（AES-256-GCM）；路径根限定 + secret-scanner；导入 require
`confirm: true` 安全阀；可选服务 `ctx.get` 调用期判空。

### 11.45 本地端口守护做跨进程共享（damage-pulse）
用量/监控类插件用本地端口守护进程共享跨进程状态（EADDRINUSE 检测复用已有守护）；
`withFileLock` 原子写累加；端口占用可取消重试。

### 11.46 凭据占位符与回写（qqbot 补充）
配置模板里写 `__FROM_ENV__` 占位符，运行时发现占位符则从 env 解析；扫码/设备授权后
把真实凭据回写 profile（含权限校验）。

### 11.47 三角色 seam 一体化 + 懒读热生效（memento）
- Service Definition + Provider + Consumer 三角色可在一个插件里，但只有入口文件 import DSH 包，实现文件零依赖可测。
- 写方法内部强制走审批门（waterfall 审批接缝）——模型经任何路径间接调用都无法绕过。
- **懒读是热生效的全部机制**：0.1.7+ Loader 把表单编辑提交进 Config 的 volatile 引用，每次读都重新解引用；把配置冻成快照会静默失效。
- 热切换先建新再拆旧（先拆后建会在建新抛错后留下"配置说开实际没开"的半状态）；dbPath 同理先 open 新库再 close 旧库。
- 自持 disposer 防 HMR 二次调用：fiber 卸载时清空本地引用（ctx.effect(() => () => { ref = null })）。
- 运行期配置校验失败 → 保持旧值 + SettingsConflictError（revision 冲突拒写）——审计留痕是插件自选，非宿主契约，不崩插件但可查。

### 11.48 exact 路由赢过 /api 前缀 fence（isTrustedApiRequest 双级：prefix 路由 + handler 内 admit()；exact 表优先） → 每 handler 自带 loopback 围栏（usage 独立印证）
宿主 /api fence 只保护 prefix 匹配的路由；`kind: 'exact'` 的路由赢过它，必须**每个
handler 自带围栏**（loopback/trustedHosts/Origin 校验）。

### 11.49 组合一致性校验防陈旧应用（nexttavern）
capture 当前组合快照 vs composeEntries 计算结果 isDeepStrictEqual；不一致（异步 compose
漂移）要重试/保留上一代，避免把陈旧的 loader 组合写进去。disabled 表达式 throw **不中止整个组合**，只判该 entry failed（inactiveEntries 区分 pending 等待服务 vs failed：
import 失败/disabled 表达式失败/fiber FAILED 两类 outcome，inactiveDiagnostic 分开渲染）——用 try/catch 保留上一代。

### 11.50 volatile 配置值 0.2.0 是 Cosmokit Volatile 包装要 unwrap
0.2.0 的 volatile 值是 `Volatile<T> = { get(): T }`（cosmokit 类型）——不是 { value } 也不是
{ ref }。统一解包：`isVolatile(v) ? v.get() : v（cosmokit createVolatile 返回 { get(): snapshot } + Symbol.for('cosmokit.volatile.write') 写口，**无 .value 也无 .ref**）`。配套的 settings 服务是 SettingsForms
（configure/describe/update/replace/mutate/writable/documentPath/prepareDocument）。

### 11.51 generator 形态 ctx.effect
`ctx.effect` 的工厂可以是 async generator/回调形态（yield disposer），配合
`ctx.fiber.entry?.options.id` 取插件行 id 做命名空间（多实例安全）。

### 11.52 systemPrompt context 尾消息注入保缓存（与 pre-step splice 并列）
记忆/上下文注入的另一正确接缝：`ctx.systemPrompt.context` 渲染成 user-role 尾消息，
DSH 只在文本变化时重新 append——稳定的 system/history 前缀缓存得以保留。pre-step splice
与 context 注入二选一，别混用。

### 11.53 配置持久化必须 $DSH_HOME + 内容指纹防重复吸收
用户配置/状态落盘 `$DSH_HOME`（跨 profile 稳定）；批量吸收配置前先算内容指纹
（hash），同指纹跳过，防重复导入（status-rotator issue #51 根因）。

### 11.54 静态 bundle 同一正文双形态（popout-sidebar）
同一份 client 正文既当 host 侧注入 code（`new Function` 包裹）又当浏览器侧脚本：
保持同一正文双形态，避免两份拷贝漂移。

### 11.55 审批/权限类插件三件套（auto-review/permission-rules 独立印证）
- `approval/request` answerer 短路语义：匹配本插件策略的请求自己 settle，其余 `next()` 委托人类链；fail-closed 默认（ApprovalPolicy = 'ask' | 'never'（默认 'ask'）；无 answerer fail-closed → 'unavailable'（waterfall 尾 = Promise.resolve('unavailable')；OUTCOMES = ['allowed-once','rejected','cancelled','unavailable']）；allowed-once 是唯一 grant
- `tools/pre-execute` 决策语义：deny/ask 短路；allow 委托 `next()` 是**推荐实践非契约**——官方语义 next() 委托且默认结果 = allow，listener 可直接返回 {kind:'allow'}。
- invariant 伴生校验"模型可见 = 已记录"的审计一致性。

### 11.56 审查上下文隔离模板（auto-review）
只读审查子代理的消息源白名单：agent/pre-step 只留 user/tool 源（防仓库文本/历史污染裁决者），工具 allow-list 限制审查者能力，结构化 verdict schema。

### 11.57 localStorage origin 漂移陷阱（dream-skin）
Desktop 宿主端口每次重启随机 → localStorage 的 origin 每次变化 → 浏览器侧偏好设置"丢失"。
正确做法：宿主半区做 stable 持久化（`$DSH_HOME`/profile）+ fenced API，localStorage 只做首帧种子。

### 11.58 回滚/fork 类操作 = 日志完整 + 视图裁剪
撤回不是删除：fork 新版本保留完整日志、surface 裁剪 marker 只剪模型可见（rewind surfaceOp /
easyrewrite fork / dream-skin 整对象替换三仓库同哲学）；备份在 tools/execute around 阶段捕获
（审批短路不记录/denied 从不记录）+ post-execute 提交。

### 11.59 存储类的三条纪律（meow-memory/git-memory）
- operation-lock 跨进程判活（processAlive 而不是只靠文件存在）；
- SQLite 用 `node:sqlite` 零依赖（WAL）；文件树即真相 + 可重建 search index；
- 事件落库节流（5s 合并）+ 插件自身轮副作用排除（isPluginTurn 防自激）+ 空闲阈值才 dream。

### 11.60 学习管线（run2skill）
静默期协调器：尾部检测完 + 空闲 + 无 agent 才动；快/慢/指数退避分级重试；pre-step step1 时
先追平持久化再 snapshot（catchup 门槛）；WeakMap scope disposer + agent/disposed 清理；
RecoveryLifecycle 崩溃后可重放。

### 11.61 预设编辑器双渠道（preset-plus）
systemPrompt.section 与 llm/stream fake 消息双渠道注入；**不能用 agent/request 改消息**
（该瀑布不可变）；scope 门控 scopedPresets。

### 11.62 视觉/设备流插件铁律（android/ios/openpencil 三仓独立印证）
DeepSeek adapter 拒绝请求内 ImageBlock → 工具结果**纯 JSON + presentationMeta 投影** +
渲染时现铸签名 URL（不发原始图片，只发寻址引用）。工具永远注册 execute 抛解释错误
（不用未注册工具）。

### 11.63 签名 URL 安全基线（ZSeven 家族）
HMAC-SHA256 + per-DSH-home 0600 密钥原子创建 + 短 TTL（10 分钟）+ 路由先过
loopback/trusted 围栏再看 capability + `lstat` 禁 symlink + realpath 包含校验；
内容寻址签名投递（name + 字节长 + SHA-256）。

### 11.64 进程外二进制插件样板（noema 拉式生命周期）
懒启动 + idle 回收 + 崩溃退避 + 状态面；子进程二进制缺失是**静默性能悬崖**
（npx 回退 3.6-6.5s/tap vs 57ms）→ 启动时探测 + warn；绝不两个 xcodebuild（busy
cooldown）；命令串用 tokenize 而非 shell 解析。

### 11.65 插件 id 与 npm 包名解耦 + patch 不含本机路径
插件行 id 可以独立于包名（兼容已装用户与重命名）；patch 永远不写本机绝对路径
（用 !!js dshHomePath 或相对包路径）。

### 11.66 路由注册全 ctx.effect + 可选服务 ctx.inject
webServer/路由注册包 `ctx.effect`（卸载自动摘除防 duplicate）；可选服务用
`ctx.inject` 按需拿（headless 组合不崩）；前缀路由找不到包时显式 404 而非静默。

### 11.67 cordis.patch.json 是合法形态（nexttavern）
patch 可以是 JSON（cordis.patch.json），与 YAML 等价——对 YAML 块标量/引号敏感场景是
零歧义替代；`disabled: { __jsExpr: ... }` 表达式形态做 entry-policy 判定。

### 11.68 !!js 表达式里解析包（没模块上下文）
patch 求值环境无模块上下文：用 `createRequire` 锚在 `ctx.get('profileContext')?.dir（profileContext 是服务，非直读属性）` 的
package.json 来 resolve 包路径。

### 11.69 替换默认实现类插件 = 运行时 registerProvider + 三段接管（free-search）
**不要在 patch 静态写 `- id: web config: {...}`**（整块替换副作用）；正确做法是
运行时 `registerSearchProvider({ id, available, search })`，接管规则：未设置/仍是
官方默认 → 接管；显式指向别家 → 只警告不抢占。不在 patch 静态写 searchProvider。

### 11.70 投影单元 warm-up
注册 sessionProjections 后要 `sessions.list()` 全部 snapshot 一次，否则前端打开看到
空数据；warm-up 异常按单会话 try/catch。

### 11.71 增量折叠的缓存纪律（usage）
revision 变更不保证旧前缀存活（rewrite/truncate）——增量系统一旦变更必须整段重折叠；
缓存 key 含全部影响维度（model/route/时间窗）。

### 11.72 SkillProvider list() 不完整就不缓存
list() 返回 complete:false 时不要缓存（注册表会把截断目录当权威）；双层取消契约：
`control.signal`（注册级）+ `options.signal`（查询级）。

### 11.73 用户可执行代码的沙箱纪律（workflow）
QuickJS（quickjs-emscripten）+ 静态扫描（先剥字面量再匹配 FORBIDDEN 表）+ 同步/墙钟双超时；
产物流过 assertJsonValue（拒绝非有限数字、循环引用、稀疏数组）。

### 11.74 关键动作过审批门的完整姿势（workflow）
`needsApproval` 字段不存在——正解是 `approval/request` 事件 + `ApprovalService.request(req)`，outcome 四值 allowed-once/rejected/cancelled/unavailable；**审批摘要来自确定性预检而非模型说法**。

### 11.75 服务提供方 + 工具面分离（workflow/dynamicWorkflows）
`ctx.plugin(ServiceClass, {...})` 注册服务，可选服务（approval/jobs/userQuestions）用
`ctx.get()` 探测后条件传入；工具面用 `ctx.inject(['服务'], child => installSurfaces(...))`
延迟注册，不做硬依赖。

### 11.76 设备桥的防 TOCTOU 与鉴权细节（android/ios）
截图/文件路由：逐级 `lstat` + `O_NOFOLLOW` + `realpath` 包含校验防 TOCTOU；流路由
loopback + Origin 鉴权。真机与模拟器 idle 回收策略分开（真机 `idleTimeoutMs = 0` 禁用回收，
xcodebuild 重启分钟级）；npx 兜底是 60 倍性能悬崖（3.6-6.5s vs 57ms）启动时大声警告。

### 11.77 进程外引擎的 MCP stdio 客户端（noema）
自写 MCP stdio 客户端：initialize 握手 + 包络大小上限（如 8MB）+ 超时（如 15s）；
平台二进制用 platforms.json 单源声明 + per-platform optional 包分发；启动失败降级为工具
错误（不崩 profile）；stderr 只做诊断。

### 11.78 防止递归自放大的起源链（crew）
worker/派工类插件的递归防护：以 (backend, cwd) 做起源链标识，**只观测不信任**（env 可被
敌意篡改，不能作为判定依据）；无人值守 worker 的提问立即拒绝（对齐 UserQuestionError
形状），不做静默降级。

### 11.79 patch insert-only 铁律 + duplicate 行为年级限定（trading）
patch 行支持 **insert 与 id 覆盖两种动词**（last write winning per row，dsh-base 注释），非 insert 行必须 id+name 匹配。duplicate entry id 行为分代：
0.1.5 世代抛 "duplicate loader entry id"；0.2.0-rc.2 新世代 EntryTree.create 用 `store[id] ??=` **复用已有 entry 不崩溃**（非静默塌缩）。顶层 YAML 数组形状强制（空层 []）。

### 11.80 storage-domain 无版本号加字段的兼容写法（mimir）
新增可空字段用 `.optional()`、可缺省数组用 `.default([])`——旧 v2 JSON 继续加载，
不写会丢数据；持久化 id 拼进文件系统路径时，加载期 quarantineUnsafe 隔离 + 写路径显式校验
（老记录不能 abort 整个域打开）。

### 11.81 Service 作为 Remote 门面（thin facade）
继承 TypertRemoteService，@Remote 方法签名保留在门面上、方法体全部转发到纯函数域模块；
可变实例状态骑在单独 ServiceState 对象上。注册工具时不在注册时取服务、执行时懒取
（`() => ctx.get('research')`）。

### 11.82 信任围栏抄写要点（lowtide，宿主不公开导出只能复制）
Host 命中 loopback（127/8、localhost、[::1]）+ sec-fetch-site cross-site 拒绝 +
带 Origin 必须与 Host 同源（**null Origin 拒绝**）+ **端口归一化**（'localhost' 隐式 80 vs
'http://localhost:3080' 比较前先 normalizedPort）。

### 11.83 SSE 推送容错模板（lowtide）
心跳先序列化 payload（可抛）→ 失败跳过帧 + 下心跳重试 + 每分钟最多一条 warn；写失败从 Set
删除客户端（迭代前 Array.from 快照）；并发 SSE 客户端硬上限。

### 11.84 第三方插件借用官方包名（voice-ai-girlfriend）
`@deepseek-ai/dsh-client-ui-voice` 是第三方借用官方命名空间的包——判定插件归属看实际仓库
（owner/repo + 发布者），不能只看包名。

### 11.85 跨宿主桥的 CLI 自管理安装 + 版本钉扎（plugin-cc）
桥插件自管 CLI 安装（resolveDshBinary / installPinnedDshFromNpm / writeDshWrapper）双份兼容面；
broker 会话续接必须活体验证；权限透传多档；作业台账 + 进程树终止。

### 11.86 知识库型插件 = 把 SKILL.md 注册成技能（plugin-guide）
用 ctx.skills 注册 provider，skill body 是仓库自己的 SKILL.md，相对引用经 directory
resourceBase 解析——agent 需要时才加载（渐进披露）；frontmatter 剥离要大声失败/回退全文本。
零宿主依赖：只消费 skills 服务（inject: ['skills']）。

### 11.87 durable 自动化调度的配置面（dsh-automation）
maxConcurrentRuns / runTimeoutMinutes / misfireGraceMinutes / catchUpMissedRuns /
archiveRunSessions——并发上限、run 超时、misfire 宽限（宿主 resume 后跳过 vs 补跑）、
错过运行追赶策略全部可配；任务在全新 Agent Session 运行（隔离 + 可归档）。

### 11.88 插件控制台的启停机制（gating-hub / dsh-market 独立印证）
插件启停 = 用户补丁层追加 `- id: X` + `disabled: true`（停用任意行），移除即恢复；HMR
自动重组合无需重启。写 patch 文件要串行化（queuedWrite 排队）防 read-modify-write 交错。
管理路由面：state/toggle/search/repo/install 五端点；loopback-only + 写 Origin 校验 +
输出脱敏（maskUrl）+ 安装目录垃圾回收。

### 11.89 webserver/index-inject 是"比 shell 更早的绘制面"（550c-boot）
启动卡片类需求必须用 index-inject 的同步 style/head script 行，而不是 client bundle
（bundle 求值必晚于 shell 卡片）。首帧契约：`window.__xxxFirstFrame.end()` + watcher +
超时三重兜底防黑屏；"只声明 dsh.client 不可安装"是门禁。

### 11.90 情感/人格化插件的安全契约模板（jingling）
身份透明 + 不制造依赖 + 导入素材不可信 + 工具白名单隔离工作面（ALLOWED_COMPANION_TOOLS）+
记忆写入权（仅 user-confirmed / proposal-confirmed / legacy 三种来源）。

### 11.91 IM/网关类插件 = 高危多实例模板（im-gateway）
DSH_HOME 实例锁（effect 绑 release，拿锁失败释放再 throw）+ 环形日志缓冲 + 状态分文件
store（每个 JSON 独立 try/catch）+ 未授权待授权队列（设置面板一键批准）+ 调度全走 effect
（unref + clearInterval 防双 tick）+ jobs.attachController 长任务前台视图 + 60s 心跳。

### 11.92 settings 命名空间 = ctx.fiber.entry.options.id（0.1.7+）
契约保证（SettingsForms.describe()/update(ns) 注释直说）：设置命名空间取 profile entry id；ctx.fiber.entry.options.id 是社区取法、无类型承诺
（`ctx.fiber.entry.options.id`），不是包名；0.1.7+ 的 settings.describe 按此寻址。

### 11.93 LLM 预算估算分族计价（deepread）
CJK 0.6 / 拉丁 0.25 / 其他 0.5 token 每字符分族计价，比"每字符固定下限"更精细；
模型速率默认表 + storage-domain 实时校准（defineDomain + domainTable + zod）持久化实测值。

### 11.94 volatile 配置统一解包函数（按 0.2.0 修正）
写统一 `unwrapLive(x)` 解包函数：`isVolatile(v) ? v.get() : v（cosmokit createVolatile 返回 { get(): snapshot } + Symbol.for('cosmokit.volatile.write') 写口，**无 .value 也无 .ref**）`（Volatile<T> = { get(): T }）——
所有读配置处复用，避免散落解包逻辑。

### 11.95 双通道设置（RPC channel + config）
设置面两条路并存：RPC channel（客户端实时读写）+ config 直写（无 RPC 时的降级）；
0.2.0 可选注入 settings 拿不到时靠 JSON 配置跑。

### 11.96 受限 LLM 适配器（nonce 签发制）
对"自由调用必须受限"的适配器：nonce + connection + request 三重匹配才放行，不匹配抛
UNSUPPORTED_OPTION；请求先校验再落账；Service.init 异步 + disposing 短路。

### 11.97 Read 侧多真源合并 + managed-block 可逆写入
管理面板读侧合并四源（loader 树 / manifest / deps / patch insert）；写侧只动托管块
（managed-block 标记），**永不重写用户内容**；安装卸载派官方 CLI。

### 11.98 sidecar 内核 + 薄插件（scholar）
重逻辑放 sidecar 内核（独立进程/独立包），插件只做薄映射；patch 只 ADD 不碰宿主
sandbox/approval/web_fetch 行；按角色 ACL 工具注册；技能随包分发。

### 11.99 编辑 = 追加版本效果事件 + 显式 inverse（message-edit）
消息/文档编辑用事件溯源：编辑 = 追加带 schemaVersion 的效果事件 + 显式 inverse（可重放
可撤销）；消息不可变语义（Object.freeze）；closedTurns 只折闭合回合；Timeline order 显式。

### 11.100 主题插件两层 CSS 变量都接管（bloom-theme）
`--dsw-alias-*`（语义层）+ `--dsw-specific-*`（组件特定层）都要覆盖——只接一层就是
"换了色还是丑"；`body[data-variant]` 切换变体；纯 client 主题 node 半空 apply 合法，
样式顶层立即注入（lazy CJS factory 不调用）。

### 11.101 纯函数协议模块被多入口双实例化是重型插件状态分裂源（knowledge）
RAG/重型插件把状态放进"纯函数协议模块"会被多入口静默复制成双实例——状态必须走
globalThis Symbol 注册表或服务；证据带 source-span 可追溯。

### 11.102 认证插件 gate 必须覆盖未认证 WebSocket upgrade（dsh-remote）
HTTP + WS upgrade + SPA fallback 全路由门；scrypt 哈希 0600 落盘；HMAC 签名 cookie；
登录限速 per-IP + username；首启 bootstrap loopback-only；enforceRoles 方法级门。

### 11.103 timingSafeEqual 前先比长度（notifier）
timingSafeEqual 长度不等会抛——先比 length 再比较；admin token 决策：SHA-256 哈希落盘 +
首启只打印一次 + 先比长度再 timingSafeEqual。

### 11.104 apiProxy 桥 wire 协议逐字段对齐（gov-portal）
自定义 WebUI 的最短路径：unary / events.mux / respond / export 四种信封逐字段对齐宿主
apiProxy 协议，独立端口 + 零依赖（node:http）复用宿主会话/权限；inject 由 patch 行声明。

### 11.105 TOOL_WRAPPER_PROTOCOL 版本矩阵（sandbox-escalation-fix）
包装宿主工具前先枚举支持版本矩阵（19 个）+ DSH_PACKAGES 清单 + 窄包装白名单
（TARGET_NAMES：bash/pwsh/write/edit）+ ESCALATION_FIELDS 协议字段。

### 11.106 PTY relay 的 Electron node 解析（wsl-workspace）
Desktop 宿主下 `process.execPath` 是打包的 Electron 可执行——必须显式解析真实 node
（resolveRelayNode）+ rejected 候选回退。

### 11.107 更新执行器 detached 独立进程（prompt-enhancer）
安装/重启类操作移出主进程（detached 执行器，宿主重启不丢更新）；RPC 版本协商
（probeEnv / executorEnsure {port, version, pid}）；动态安装与 bundle 安装双路径共存。

### 11.108 patch 内 !!js 读 installAnchor 版本条件禁用（llm-workbuddy）
patch 里 `!!js` 读 `installAnchor` 的版本做阈值判断，条件禁用旧行（0.1.7 阈值）——与
persona→personaPrefix 同族：同一份 patch 兼容新旧宿主。

### 11.109 apply 同步段必须同步载配置（auto-memory）
apply 的同步段若不同步载配置，注册闸门会"结构性恒假"（异步配置还没到，闸门已判过）。
启动预热防首轮竞态；写路径锁 + retryRename 防 Windows EPERM。

### 11.110 uncaughtException 护栏双刃剑（auto-memory）
抑制致命退出必须配计数诊断 + 全局旗标防重复挂——只抑制不诊断会让故障静默。

### 11.111 可选 UI 依赖 ctx.get() 探测不 inject（sidebar-qa）
可选 UI 服务用 `ctx.get()` 探测（防 PENDING），不写进 inject；context 三策略
（inherit/compressed/trim）失败降级 degraded:true。

### 11.112 技能注入 = 包内资产复制进用户技能目录（stock-watch）
安装时把包内 skills 复制进用户技能目录（已存在跳过 / env 覆盖 / 禁用）；MODULE_DIR
锚定包内资源；技能安装状态 ≠ 插件树存在（扫约定根目录）。

### 11.113 双 entry 拆分 web 面（agy）
主插件（llm 注册）+ web entry（等 ctx.webServer 激活后注册 RPC/OAuth）；headless 下
主插件照常；无 Config 合法（env 逃生口 DSH_AGY_DISABLE）；registerAdapter 官方已内部 ctx.effect，插件再包一层是双保险不必要。

### 11.114 零运行时 @deepseek-ai 依赖 = 全 type-only import
多个仓库独立印证（taskboard/with-chatgpt/cloader）：零运行时依赖的插件全用 type-only
import（9 个类型增强包），协议段进 systemPrompt 带 order，执行走 fresh 会话 + pinned 模型。

### 11.115 审批 answerer 完整模板（三方印证）
approval/request 瀑布接入：不匹配预设即 `next()`；转人工 `await next()` 并回记终态；
parseReason 解析 escalate 语义；callId 回溯 tool/call 取结构化路径；LLM 判定 fail-safe
超时；裁决学习沉淀规则；数据落 `$DSH_HOME`（env 优先回退 homedir，不拼 node_modules——
可能只读）。

### 11.116 settings 双轨兼容 + FEATURE DETECTION（catppuccin 印证）
<=0.1.6 用 installSection / >=0.1.7 用 Config.volatile + configForms——用**特性探测**
不解析版本号；可选 settings 用 ctx.inject 降级 localStorage（只做首帧种子）。

### 11.117 patch CRUD append-only 安全模板（mcp-panel）
loader 方言无 set/remove 动词——applyEntryPatches 只识别 insert + id 覆盖，set/remove 作为残余键被写进 target（无效不报错）；
"- set:" 的 id 为 undefined → warn "id is required"——"禁用即删除"（disabled:true）；绝不
合成 !!js；env/header 值永不进快照；写 patch 前审批 + 备份；callTool 走官方
`ctx.tools.execute(exec: ToolExecutionInput)` 单对象签名（含 name/arguments/callId/signal，非 (name,args) 二参）→ pre-execute/guard → dispatch → finalize 流水线。

### 11.118 headless persona 禁 ask_user_question 纪律
headless/无人值守组合里 `ask_user_question` 会卡死——persona 层禁用；stdio 帧协议
（PROTOCOL_VERSION + 帧类型判别 + capabilities 位图）+ MAX_COMMAND_BYTES/MAX_TOOL_OUTPUT
流控；resume 活性校验。

### 11.119 确定性研究的克制抓取（fund-research）
PoliteFetcher 克制抓取（限频/超时/礼貌头）；密封快照验证每个关键数字（claim ↔ 快照）；
溯源表可追溯；"研究不做交易"（只读域）。

### 11.120 只读审计插件的纪律（secure-audit）
严格只读（唯一写 = opt-in append-only JSONL）；宿主探测 fail-open 降级 n/a；报告先脱敏
（secret → redacted、大对象 sha256 指纹）；可选技能 ctx.get 探测。

### 11.121 bundle 行设计：裸包名行 = 客户端行，子路径行 = 宿主行（yolo）
client module registry 通过解析每个 LOADER ENTRY 名到 `<entry>/package.json`
读 dsh.client 声明——**裸包名解析到包根 → web client 行；子路径行解析不到 package.json →
故意不是 client 行**。没有裸包名行，`dsh web` 永远不挂浏览器 UI（零报错静默失效）。

### 11.122 persona 局部阴影而非替换（agency-agents）
summoned 子代理只覆盖自己的 `deployment:persona` 段（spawn/fork provider 的 persona
capability），带专家身份 + 普通工具集——不替换父 persona、不放开沙箱/审批。

### 11.123 动态插件不能扩展冻结的 presets 表（approval-gate patch 注释）
自定义权限预设必须在安装期间手动写进 profile 的 cordis.patch.yml（patch 注释明说：
"dynamic plugins cannot extend the frozen presets table"）——"装插件就有预设"不可行，
预设表是宿主编译期冻结的。

### 11.124 settings seam 换代特性探测双轨（catppuccin issue #15）
<=0.1.6 用 `ctx.settings.installSection` 注册命名空间 + `ctx.settingsScope`；
>=0.1.7 不注册，用 Config schema 的 `.volatile()` 字段投影成以 profile entry id
命名的表单，Client 读 `客户端 ConfigFormController（读 dsh-client-ui-settings 的 config-form.d.ts）；宿主 Context 只有 ctx.settings`。**选择用特性探测（installSection 在 0.2.0 已彻底移除（settingsScope 也不存在）；双轨探测应改为 SettingsForms 服务存在性检测）
不用版本解析**。

### 11.125 webServer 信任校验的 canonicalAuthority（skills-manager）
Host 只接受纯净规范 host[:port]（拒绝路径/userinfo/空白/非规范端口）；loopback 判定含
localhost/[::1]/127/8；带端口 trustedHosts 精确匹配、不带端口匹配同主机任意端口；
**端口归一化（隐式 80/443 派生）后再比较 Origin 同源**；写接口加自定义标记头
（迫使跨站 fetch 预检，且不回 CORS）。

### 11.126 IM 通道的 denyTools 与二维码 onboarding 过期重发（lark）
IM 场景无人类对话框：`denyTools: [ask_user_question, exit_plan_mode]`（unanswerable
here）；设备码过期重发是常态（操作者稍后回来）而非报错，但被拒授权必须停止。

### 11.127 可选服务依赖行不进默认 patch（lark invariant）
宿主默认组合没有 invariants 服务——放进默认 patch 会让整棵树启动失败（row 等缺席服务）；
可选服务依赖行按组合条件挂载（diagnostic 组合才加）。

### 11.128 patch 版本门控的唯一宿主信息源 = ctx.get('profileContext')?.installAnchor 是 dsh app 包内 package.json 的**绝对路径**（安装锚点，非版本号；ProfileContext 无版本字段）——版本门控需另读 package.json；且仅 dsh 启动的 profile 存在 —— 是安装锚点路径非版本号（ProfileContext.installAnchor: string，核心用 dirname()）；读版本须解析其 package.json；'唯一宿主信息源'措辞过绝对（process 全局可用）（llm-workbuddy）
patch 求值环境里唯一可用的宿主信息源是 `ctx.get('profileContext')?.installAnchor 是 dsh app 包内 package.json 的**绝对路径**（安装锚点，非版本号；ProfileContext 无版本字段）——版本门控需另读 package.json；且仅 dsh 启动的 profile 存在 —— 是安装锚点路径非版本号（ProfileContext.installAnchor: string，核心用 dirname()）；读版本须解析其 package.json；'唯一宿主信息源'措辞过绝对（process 全局可用）`——
读它做版本阈值判断（<0.1.7 禁用某行）；engines 用多段区间声明。

### 11.129 侧边栏/可选 UI 槽用 ctx.get 探测而非 inject（sidebar-qa）
可选 UI 槽（侧边栏）用 `ctx.get()` 探测，**inject 会在无原生侧边栏宿主 park fiber
导致 web boot 失败**；历史上下文三策略（inherit/compressed/trim）失败降级 degraded:true；
压缩超时硬上限 8s；locale 由客户端显式传。

### 11.130 外部 CLI 桥 dormant-safe（agy-link）
缺二进制不崩 profile = 休眠 + 状态报告（dormant-safe 探测）；bin/version 缓存 +
Semaphore 限并发；子进程 env 显式构造（透传 + 禁遥测 + 代理）；输出解析兼容多形态；
账号池 + 配额。

### 11.131 记忆注入五刷新点 + 自动沉淀分级（auto-memory）
记忆注入刷新点：启动 / session/created / turn/end（标准同族 turn/start、step/start、step/end） / 工具写入 / TTL；自动沉淀分级 +
按 turn 去重 + 寒暄跳过；反思要明确触发条件；独立配置文件 + API 形态；路由 loopback-only。

### 11.132 缓存版本键 + 启动清理旧格式（web-search-pro）
缓存 key 带 schema 版本（变更即淘汰）；启动时清理旧格式；volatile 热加载 dynamic 闭包
（所有操作读同一闭包）；可选 provider 注册 ctx.get 探测 + effect-scoped 幂等；store
close 挂 ctx.effect。

### 11.133 技能注入幂等（stock-watch）
安装时把包内技能复制进用户技能目录：幂等 + 已存在跳过 + 尊重用户版本；env 覆盖配置；
"插件树存在 ≠ 已安装"（技能扫约定根目录 .dsh/skills / .agents/skills，绝不展开 HOME）。

### 11.134 协议桥插件（ACP）的 drain tail 串行化（acp-interactive）
宿主拥有会话、桥只投影：drain tail 输出串行化；子代理事件经父卡片转发；静默期结算；
**invariant 伴生注册**（"模型可见 = 已记录"）；协议层错误码用封闭联合（只能在协议层转义）。

### 11.135 市场类插件安装计划强校验（plugins-store）
安装计划强校验：executable/source/args 形状断言 + 精确 args 段数；GitHub 命令钉 SHA；
验证状态同步。

### 11.136 皮肤：走变量覆盖，不打宿主源码补丁（beauty-skins 反面教材）
宿主源码 patch 型皮肤（直接改官方 client 文件 + install.sh 打补丁）不走 bundle 机制，
**宿主升级即碎**。正确做法：--dsw-alias-* 变量覆盖 / 主题 slot。

### 11.137 插件活目录的每日 compat 实测 + gzip 裁剪缓存（dsh-suite）
活目录每日跑 compat 实测（非静态声明）；目录 gzip 裁剪缓存 1h；更新检查分批并发（≤4）+
缓存 6h；score 与实测结果给用户排序。

### 11.138 cordis.yml 构建期占位符替换（wenshan）
用 `____PLUGIN_NAME__` 占位符在构建期替换真实包名（发布前注入）——同一模板仓库发多个
产品；!!js 跨平台工具链选择；agent preset 隔离业务。

### 11.139 协作扫描预算 + fail-open 措辞纪律（secure-audit）
长文本扫描用 `scanTimeoutMs` 毫秒预算限制运行期成本；预算耗尽按 `onTimeout` 显式降级
（allow/review/block）。fail-open 默认时输出必须显式标注"未命中规则 ≠ 确认安全"——启发式
漏检与安全保证要分开措辞。所有工具输出 schema 过 `assertObjectJsonSchema` 加载期闸。

### 11.140 零配置上手（admin-zero-config-onboarding）
空配置绝不弄崩启动：渠道为空只订阅不动作、解析问题只 warn + 跳过；新安装默认开启本机
管理台（终端打印链接），零 YAML 配置即用。patch 行默认值与编程式 resolveConfig 默认可以
不同（同一代码两套生效默认：patch 形态开 admin，程序化形态关）。

### 11.141 礼貌限频抓取（PoliteFetcher）
公开数据源（无 key 无登录）必须自带限频/重试/超时；数据源地址可配镜像。研究型插件输出
每个关键数字与密封源快照比对（可选服务 ctx.get + 内置回退双轨），版本化报告 + 溯源表。

### 11.142 MCP/管理面板的硬边界纪律（mcp-panel）
官方客户端保持唯一桥（每服务器一实例），面板只做体验层；工具试用走 `ctx.tools.execute`
（权限与审批保持生效）；写 profile patch 过审批门 + 自动备份 + append-only；**生成的
patch 不含 `!!js` 表达式**；**绝不编造连接状态**；配置 env/header 值永不进快照；
面板不注入提示词段。

### 11.143 纯 client 主题空 apply + 假数据事故
`function apply() {}` + named export 是零业务/纯 client 插件的合法形态（官方 trajectory
插件同款）。假数据事故复盘：浏览器端读不到宿主数据时**别用硬编码示例兜底**（顶栏卡片
永远显示仓库示例数字）——要么搭 client↔node 桥，要么删功能。

### 11.144 工具输出 schema 对齐语义（quant）
数组类输出的对齐语义（前 window-1 位为 null）写进 output schema：`oneOf: [number, null]`——
模型不会误解 null 前缀；description 写公式与对齐规则（模型正确使用所需全部信息）。

### 11.145 linked 插件改宿主事件目录的正确姿势（Ephemeral plugins）
改宿主 KNOWN_SESSION_EVENT_TYPES 类目录时，用
`createRequire(pathToFileURL(realpathSync(process.argv[1]))).resolve('@deepseek-ai/dsh-session')`
锚**运行中的 DSH**（realpath 后 import 绝对路径）——锚 checkout 副本会改错实例。

### 11.146 协议桥类插件骨架（acp-interactive）
inject 写全（agents/commands/llm/skills/tools/sessions/sessionPersistence/sessionQuery）；
session Map + 状态机簿记；outputTail promise 链串行化 notify；assertOpen 闭包守卫；
子代理 SubagentTracker；四段验证门禁（test:harness / check:profile / check:registry /
verify:packed）。

### 11.147 主题 UI 用 dsh.client.immediately:true 首帧生效
纯 JS 无构建最小形态：`immediately: true` 让 client 半首帧生效（不等待 lazy 加载）。

### 11.148 "patch" 三义辨析
cordis.patch.yml（profile 用户层固定名 PROFILE_PATCH_FILENAME；判定契约其实是 dsh.bundle.patch / dsh.client）/ git diff（源码补丁）/ patch-package（node_modules 补丁）是
三个不同的东西——**判定 DSH 插件只看第一种**（cordis.patch.yml 或 dsh.bundle.patch）。

### 11.149 市场插件验证管线（plugins-store）
固定源码 SHA（钉提交）+ 隔离沙箱验证管线（Linux 隔离跑安装/冒烟）——防供应链投毒；
聚合数据 schema 带版本戳与来源声明（schema_version / as_of / metrics_source）。

### 11.150 Slot 渲染器替换的 priority 语义（raw-html-v2）
keyed slots 同 key 同 priority 冲突会 throw，**低 priority 胜出**：官方 AssistantNodeView
priority=0，插件用 -10 替换——"替换官方渲染器"的正确姿势是负 priority 而非抢占注册顺序。
错误边界防 slot abdicate：渲染器崩溃会让全部消息退回官方渲染，必须包错误边界。

### 11.151 default export 禁令有版本语境（web-search-pro 反例）
社区多个仓库"严禁 default export"（Loader 折叠丢 inject），但 web-search-pro 源码用
`export default`——其注释说明 named export alone 在 rc.2 会丢配置表单。结论：该坑
**分版本、分 Loader 行为**；写插件时以当前装的主机 Loader 实测为准，不要盲从任一极端的
社区铁律。

### 11.152 skill-invocation 也算 userInitiated 轮次（echocat）
人为调用技能（source.kind === 'skill-invocation'）是 userInitiated 轮次——唯一耐用的
"人类主动调用"追踪信号；只认 user 源会漏掉 /name 触发类入口。

### 11.153 readJsonBody 超限后"停止收集继续消费 body 回 413"（easyrewrite）
请求体超限的正确姿势：停止收集但继续消费 body（不 destroy），响应 413——destroy 会让
连接悬挂；幽灵队列清理（/bubble/clean-ghost）防陈旧轮询堆积。

### 11.154 pending entry = FAILED PROFILE（agy）
静态 inject 的服务永不出现 → entry 永久 pending（设计内等待状态，不阻塞 root boot）。官方 inactiveEntries 区分 **pending（等服务/无 fiber）与 failed（import 失败/disabled 表达式失败/fiber FAILED）两种 outcome**，inactiveDiagnostic 分开渲染；插件 TUI 实测的 "1 entry did not activate" 属 failed 归类。web 面拆分必须用
`ctx.inject(['webServer'])` 懒取，缺席时 ACTIVE 但能力不发（ctx.get 探测降级；注意 inject 缺席是纤维 PENDING 不是 active-inert）——管理面走受保护 RPC 通道，
OAuth 回调才裸路由，loopback-only 注册栅栏。

### 11.155 npm-mirror 阴影是零依赖的最硬理由（taskboard）
从 npm-mirror 装到 shadow 的 dsh-tools 会破坏 base layer 的 agent loop——所以 sdk.ts
**自实现** defineTool/dshHomePath 而非 import 官方包；"零运行时 @deepseek-ai 依赖"的
动机不全是体积，是供应链隔离。

### 11.156 rank 语义是"低者胜"（CloudBase 印证）
技能/供应商注册的 rank 是"低者胜"：rank 400 用户技能覆盖 rank 600 bundled——与 slot
priority 同族：**覆盖他人 = 给更低的值**。

### 11.157 日志自激闭环 EPIPE 三纪律（auto-memory）
stdout/stderr 读端消失 → 处理器内 console.error 抛 EPIPE 再入 uncaughtException → 无限
自激满核空转。护栏三纪律：写前判流可用（destroyed / writableEnded / writable）、**绝不
rethrow**、同步重入闸。

### 11.158 loader 世代差异：duplicate id 行为分裂（trading）
0.1.5 世代 loader 对重复 entry id 抛 "duplicate loader entry id"；新世代用
Object.fromEntries **静默塌缩为最后一条**——兼容层必须测两个世代，不能只防抛错。

### 11.159 宿主默认禁 skill provider 的静默失效（capability-menu）
web 宿主默认禁用宿主技能 provider（需 `- id: skill-filesystem disabled: false` 重开）——
"装了插件但技能不出现"的源头之一是宿主默认关，不全是插件注册失败。

### 11.160 "广告不存在的动词" = 工厂产物与注册清单不对齐（ios WP57）
工厂创建但从未注册的工具会让模型相信一个不存在的动词（377s 会话 25 次 shell 绕路）——
注册清单必须与工厂产物对齐，未注册的工具要么不创建要么立即注册。

### 11.161 动态 import 守卫 + ready.catch 防炸宿主（dafeiyu/mirage）
link: 安装缺 node_modules 时动态 import 守卫降级 inert（不崩整树）；`ready.catch(() => undefined)`
防 unhandled rejection 炸宿主；手写 for(;;) 循环必须显式 iterator.return() 防 socket 悬挂泄漏。

### 11.162 双花括号模板变量净化（memory-evolve issue #53）
宿主把 `{{name}}` 当模板变量解析、未注册直接 throw——记忆/外部文本内容必须净化双花括号，
否则模型输入里出现未注册变量会崩。

### 11.163 createRequire 锚 ctx.baseUrl 是插件侧姿势（profiles/node_modules 扁平兜底需引擎显式挂 resolve.paths）（宿主自身用 new URL(path, ctx.baseUrl) + loader.import；createRequire 只锚 import.meta.url） + 扁平兜底解析（memsearch）
out-of-tree 包解析：createRequire 锚 `ctx.baseUrl`（profile 目录）+ `profile.dir/node_modules（默认 $DSH_HOME/profiles/<name>/node_modules，扁平挂包名）`
扁平兜底——开发包不经 npm 装也能被 loader 解析。

### 11.164 动作执行器只接受结构化动作、绝不接受命令字符串（gating-hub）
管理面板的动作接口只接受 {action, packageName, version, profile}；客户端出现
command/cmd/argv/exec/shell/script/run/spawn/bin 任一字段即 400；profile 只作回显——
面板能执行动作但不能注入命令的安全范本。

### 11.165 webserver/index-inject 是组合事件不是服务调用（550c-boot）
用 `ctx.on('webserver/index-inject', ...)` 挂首屏注入点（组合事件），不是调服务方法；
只声明 dsh.client 不可安装是市场提交门禁。

### 11.166 TOOL_RUNTIME_SCHEDULER 的 Symbol.for 全局注册表自愈（deepseek-flow）
模块副本分裂（同一工具被两个拷贝注册）的第三解法：Symbol.for 全局注册表——先查
Symbol.for('dsh.tool.scheduler') 已存在则复用，避免重复实例化。

### 11.167 供应链保护名单带原因链（gating-hub）
PROTECTED_MODULE_PATTERNS：基础设施行大名单 + 原因链（timer→HMR 失效、webserver→失联）——
保护名单不只是名单，每条都有"禁用会导致什么"的因果注释。

### 11.168 guard 单调求值与普通 JSON Schema 工具参数（host 契约）
- `ctx.tools.guard(ToolGuard)` 形如 `(execution) => string | undefined`，在 pre-execute 瀑布之后单调求值——**任何 guard 都不能 force-allow**（allow 分支仍跑 guardReason）。
- `PreToolDecision = allow | deny(reason,info) | cancel | ask(reason,displayReason)`。
- `approval.request({agent, toolName, callId?, reason?, signal?})` 非 `allowed-once` 即 deny；无 approval 服务时 fail-closed deny。
- defineTool 入参是 DSL spec（ParameterSchemaSpec/ValueSchemaSpec），运行时转 JSON Schema（z.object 被拒）；转发子集应经 assertSupportedJsonSchema。
