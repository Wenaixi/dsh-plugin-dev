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
dsh-web 的 aggregate.yml 是唯一手写源：`patchFrom` 贡献 insert 行（递归展开、带源注释）、`deps` 拉入依赖、`rows:` 外部行（显式 semver + 直挂真实包名）、`tombstones:` 给退役子路径保留空壳导出（防 ERR_PACKAGE_PATH_NOT_EXPORTED）、`inactive:` 出厂默认关闭行（渲染尾部 disabled:true）。行 id 命名空间化（web-ui-* 前缀）防 duplicate entry；生成脚本必须 --check 幂等门禁。

### 1.6 多 bundle 套件 = 一个 patch 数组
clearai 用 `dsh.bundle.patch: ["./cordis.patch.yml", "./presets/clearai/clearai.patch.yml"]`；Openwrite 的 suite 形态按产出物切包；每个子插件行 `name` 用 `@scope/pkg/<family>` 子路径让官方列表每行独立标题。

---

## 二、版本兼容层：高迭代宿主下的存活术（64/86 提及，全生态共识）

### 2.1 能力探测优先于版本号分支
- 事件名新旧并存：0.1.6 起 agent 就绪事件是 `agent/created`（payload 带 source），旧版是 `agent/session-start` → 同时挂两个，用 `'source' in payload` 判别（agent-teams）。
- 方法探测：`typeof session.snapshotEvents === 'function'` 优先，回退 `session.events`；`typeof service.register === 'function'` 区分 Settings 新旧 API；`WEB_SERVER_KEYS = ['webServer', 'httpServer']` 新旧服务键并存。
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
- DSH 的 /api 网关接受 "loopback OR 已声明 authority"（`--trusted-host <name>` + 绑定 0.0.0.0 派生的 LAN 字面量）。
- **血泪坑（dsh-market #729）**：exact 路由赢过 /api fence 的 prefix 匹配，永远见不到它，必须自己决定 → 只信 loopback 会让所有经域名（反代/隧道/LAN 主机名）到达的部署写路由 403 而读路由正常，表现为"安装按钮点了没反应"。
- 正确做法：trustedHostsSource 从宿主的 connection 服务读（每次请求取 live 值），判定 = Host 头是 loopback 或属于 trustedHosts **且**浏览器跨站标记同源（Origin 与 Host 一致）。better-sidebar 把 /api 网关的 fence 逻辑整体复制过来（BSD-3 注明出处），不 import 内部模块。
- mutating 端点：same-origin POST + curated 来源白名单（dsh-market 安装路由）；`isTrustedRequest(req, mutation)` 两级（只 loopback vs 还要 Origin 校验）。

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
宿主 ui-settings 的 settings.section 槽期望 **React 渲染函数**（register(descriptor, () => createElement(...))）；写成"返回带 render() 方法的对象"会抛 React #130（slot entry crashed）白屏。官方 primitives（SegmentedControl/Switch/StateDot/Tag/Button）优先复用。

### 4.4 模块级可变状态会静默分裂
同包经多个入口 artifact 加载时每个入口持有自己的模块拷贝，模块级可变单例状态分裂（路由重复注册 + 另一个入口伺服空状态）→ 跨条目/跨拷贝状态一律走 globalThis Symbol 注册表（Symbol.for 键，跨仓库契约，改变键形状会互踩）。

### 4.5 客户端注册必须包 ctx.effect
所有 slots 注册/事件监听/定时器在 client 半区也按 Cordis 生命周期走，卸载时回收，否则 HMR 后重复注册。

---

## 五、事件、生命周期与状态（33/86 提及）

### 5.1 自定义 session 事件类型必须先注册词汇表（最危险的静默故障）
graph-memory + working-activity 双重印证：`session.append()` 无法标记事件可忽略；自定义 session 事件类型不在宿主的 `KNOWN_SESSION_EVENT_TYPES` 里，严格读取路径（恢复种子校验、持久化加载）会**拒绝整个会话**，导致"写进去没报错、下次打不开"。发布前必须注册到所有物理可达 dsh-session 副本的词汇表（realpath 去重）。

### 5.2 事件派发模式的坑
- `agent/pre-step` 用 `{ prepend: true }` 注册且挂在**具体 Agent 的 context** 上；根组合拿不到每 agent 钩子，需 agent/created + agent/session-start + session/event 三路兜底 + WeakSet 去重（graph-memory）。
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
- `ctx.llm.registerAdapter([providerId], {...})` 的行型对象**必须自带基类默认方法**：
  `providerInfo` / `providerRetryPolicy` / `prepareCall` / `imageRequestPricing`；
  漏实现任何一个都是**静默注册失败**（不抛错，只是没生效）。dsh >= 0.1.1 所有调用（含 replay）
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
