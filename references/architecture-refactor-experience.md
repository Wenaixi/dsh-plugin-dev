# 配置/路由/状态重构的通用工程经验（深挖实战）

> 适用于：任何 DSH 插件从「入口大函数」走向「深模块」的重构，以及配置读写、HTTP 端点、优先级判定的可测化。

## 一、多实现漂移 → 收成唯一真源 + 反向断言

同一语义写多份（入口判定一份、诊断链一份、工具函数一份），靠注释「保持一致」必然漂移。

- **唯一真源**：入口与 UI 全部消费同一解析函数（如 `resolvePriority(...).effective`），删掉手写的 if/else 分支；
- **暴露差异的锁定测试**：断言「入口启动判定 == 唯一函数的输出」，覆盖大小写变体、非法值、缺失值；
- **反向断言**：门禁里断言「不再出现手写分支的关键字」。

### 归一化防垃圾态注入

- 用户可控的枚举值（配置、patch、env）在**写入状态前**必须归一化校验，非法值**拒绝写入**并落合法兜底；
- 反例（真 bug）：patch 显式值未归一化直接 `state.set()`，大小写变体/非法值把内存态与持久化文件同时写成垃圾；
- Schema 校验只拦「正常宿主路径」，防御场景（手写 patch、绕过 schema、直接调用）必须由代码自己兜住。

## 二、HTTP 配置端点：剥离成纯工厂 + 假 req/res 单测

把 `webServer.register` 的 handler 抽成独立工厂：

```ts
// src/xxx-http.ts
// 以下 Deps 字段均为本插件私有接口，与宿主 API 无关；与官方对接的只有 webServer.register(route) 与 node:http req/res
interface Deps {
  state: State
  readRawConfigMode: () => string | undefined
  invalidate: () => void   // 插件自有回调名；官方技能注册表 API 是 registry.invalidateCache()，提供者控制句柄是 control.invalidate()（dsh-skill）
  patchMode?: string
  logger: { info(msg: string): void }
  envRaw?: string
}
export function createConfigHttpEndpoint(deps: Deps):
  (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
```

- **依赖全注入、不碰 ctx**：handler 内部只用纯 Node `req/res` 与注入依赖，测试不 mock 整个 ctx；
- **假 req**：GET 用 `{ method: 'GET' }`；POST 因 handler 里 `for await (const chunk of req)`，假 req 补一个 `[Symbol.asyncIterator]`：

```js
{ method: 'POST', [Symbol.asyncIterator]: async function* () { yield JSON.stringify(payload) } }
```

- **假 res**：`node:http` 的 res 是 class（OutgoingMessage 子类）且带内部状态，但 handler 只触碰 `setHeader`/`writeHead`/`end` 这类方法时，普通对象即可冒充——`{ setHeader(){}, writeHead(c){status=c}, end(b){body=b} }`；
- **零为测试造抽象**：不需要为可测性新增 bodyReader 参数，stub async iterator 已够；
- 抽取时把 GET/POST 共用的响应组装（快照）收成一个函数，避免把重复代码搬家。

## 三、配置写盘：字段级 merge，别丢用户手写字段

- 反例（真坑）：配置写盘函数只重建两键对象，`cordis.patch.yml`（宿主唯一写盘目标）里用户手写的未知字段被静默丢弃；
- 正确：读原文（cordis.patch.yml / 插件自有 JSON）→ 字段级 merge → 写回（未知字段原样保留）；
- 非法值（defaultMode 未归一）**拒绝写盘并抛错中止**（SettingsConflictError 或校验 Error），原文件保持不变；
- 两个写函数骨架相同（mkdir+read+merge+stringify）时合并为一个 `write(patch)`；注意宿主侧配置写盘走 dsh-settings 的 write(ns, change, expected, paths)（mergeLayers 保留未知键），语义以「保留未知字段 + 拒绝非法值」为准；
- 补一条行为测试锁「未知键保留」——要防旧行为回归。

## 四、孤儿函数与失效类型

- 全仓 grep 调用方，确认零调用再删；导出名单同步清理（含 lib 产物）；
- 删完后把「该孤儿」从记忆库/债务表移除，避免下次再当候选扫描出来。

## 五、文件编辑的 CRLF 坑

Windows 上源码文件常为 CRLF。`old_string` 用 `\n` 分隔的精确匹配会反复失败——**先 `readFileSync` 按行读、按行号切割替换、按原行尾 join 写回**，或先 grep 确认行首尾字节。

## 六、可失败自检与破坏实测的复用写法（接口即测试表面）

把规范校验做成模块导出接口的一部分，门禁脚本退化为纯声明式调度器：

- **自检写在模块里**：`static selfTest()`（纯内存临时目录构造，finally 清理），`verifySpecification()` 聚合多个模块的自检结果并返回 `{ total, passed, failed, ok }`；任何调用方（CI、CLI、别的插件）自动获得同一份保护；
- **聚合的 ok 必须与门禁的判定口径一致**：聚合字段漏判任一失败源（如「文件缺失」这类收集到的计数），就变成「看着健康实则缺件」的死字段——未来有人拿它做判定会漏报；
- **每条新断言先做破坏实测**：在旧实现上跑新用例确认 FAIL（证明断言真的能抓缺陷），实现后确认 PASS，再把实现故意改错确认红、还原确认绿。写反一处比较逻辑就能证明断言非恒真；
- **边界断言要覆盖完整数据域**：自检样本只测一个前缀/扩展名时，其它形态的漂移永远不被感知；枚举全部形态各一条样本。

## 七、正则字符类要按真实数据域写，别抄模板

守卫/提取正则的字符类若与真实数据形态不符，会「静默放行全部漏网」且门禁全绿：

- 反例（真 bug）：标识符前缀分支写成 `[w-]+`（照抄某模板），而真实标识符是 kebab-case（每段可含数字与多连字符，如 `my-cool-plugin-v2`），一个都匹配不到——带前缀的调用全部逃逸守卫；
- 修法：先确认数据域的真实字符集（全仓枚举一次实际取值），再写字符类；两处语义相同的正则（自检样本与消费方）必须共用同一份定义，否则自检绿、消费方漏；
- 自检补钉的顺序价值：**先补断言、再修实现**，让缺陷以「自检红」的方式现形，而不是修复后断言永远绿；
- 手写「括号配平」类解析器是零守卫陷阱：字符串引号分支写错（`char === ''` 空串）会让字符串内符号参与配平，靠「数据恰好没有那种符号」幸存；能用「朴素边界 + 求值失败即报错」替代就不手写配平。

## 八、反向断言要打产物，别打源脚本

- 反例（产物门禁真坑）：想给「lib/client.js 不含宿侧 Node API」加门禁，第一次写在 verify.mjs 里判断脚本自身是否含 `import.meta` —— verify.mjs 源码自己大量使用 `import.meta.url` / `process.exit`，断言立刻误红。**断言「产物不含 X」时，检查对象必须是产物的内容**（`readFile('lib/client.js')`），不是门禁脚本自身、也不是模板源码；
- 模板内插值的产物：模板字符串里「宿侧执行代码段」（写在模板内、构建期运行的 Node 代码）会**原样进产物**——「源码里没有 X」≠「产物里没有 X」；
- 写断言前先 grep 断言脚本本身，确认断言关键字不与脚本自身冲突；冲突就用 readFile 把检查对象分离出来。

## 九、TDD 测试形态必须与生产接线等价

- 反例（生产接线真坑）：默认档分裂测试第一次写成「dispatcher 注入正确闭包 → 断言切 lite」——这个理想形态 production 未修也绿，测的是「测试里自己组装的修复」，不是 production。真正红要经 apply 的真实接线（mock ctx.on 收集真实事件 handler → 喂消息 → 断言 flag）；
- 检查「红」用例是否有效：production 未修时它**真的失败**吗？测试代码里如果已经包含修复逻辑（手写了正确注入），它就不是回归测试；
- 测试里手写理想形态 = 恒绿 = 回归锁失效，比没有测试更糟。

## 十、删除模块时，测试 import 面与残留产物一起迁

- 反例（删除模块真坑）：把 46 行薄壳 runtime 内联进 state 时只改了 src 与文档，漏了三处——行为测试的 `import ... from '../lib/<deleted-module>.js'`（SyntaxError: does not provide an export）、verify.mjs 产物清单一行、lib/ 下旧编译产物（tsc 不清理，索引与磁盘双残留）；
- 删除模块的完整清单：src 文件 + lib 产物（git rm --cached + 物理删除）+ 测试 import + verify 清单 + 文档引用；
- 内联后若原导出被测试直接依赖，新宿主模块要**保持导出**（export 内联函数），否则测试 import 面破碎；
- 用 `git ls-files | findstr <模块名>` 列出索引残留，物理 `dir` 核对磁盘。

## 十一、测试测的是 lib/ 产物：改 src 必须 rebuild

- 反例（产物陈旧教训）：src 修完测试仍红/行为没变——behavior.test.mjs import 的是 `../lib/*.js` 编译产物，pnpm build 没跑；
- 调试纪律：测试跑前先确认产物最新；症状「改了 src 测试还红/还绿」八成是产物陈旧，不是逻辑错。

## 十二、git log -S 考古回归引入点

- `git log -S "关键字" -- <file>` 按字符串出现次数增删筛选提交，可快速定位死代码的引入点，比翻 git blame 更直接；
- 配合 `git show <sha> -- <file>` 看引入提交的 diff 上下文，确认是「新增即死」还是「删除时漏删」。

## 十三、删除能力 = 同步所有「对外承诺面」，最小残留清单（实测）

删除或移除一个功能时，最容易漏的不是实现，而是**所有在向外界承诺这个功能的地方**。移除实现只花十分钟，清残留面可能要查一整天。

**真实事故**：移除一个斜杠命令（类似 `/xxx hide-model`）时，同步改了 README、客户端面板文案与 locale，唯独漏了**技能本体文档 `skills/<name>/SKILL.md`**——而这份文档是安装后模型最先读到的操作指南，还在教模型调用不存在的命令。提交时没有报错、门禁全绿，缺陷随 npm 包直接发给了所有用户。根因：移除类提交的 diff 清单来自「改过哪些文件」，而不是「哪些文件承诺过这个能力」。

**必查残留面清单（按「谁会读到这个能力」排序）**：

| 承诺面 | 检查方法 |
| --- | --- |
| 技能本体 SKILL.md（若你的能力是技能） | grep 命令名/动词形态，注意只搜「命令动词」（hide/show/enable/disable），别被包名/路径里的同名子串骗过 |
| README.md 能力清单与操作章节 | grep 同上 |
| 客户端面板文案（双面插件） | 搜旧的提示文案 key 与字符串字面量 |
| locale 字典（宿主卡片/面板） | 搜旧的提示 key；注意 locale 与客户端内联文案是两条通道，要分别查 |
| 源码注释与类型文档（JSDoc/d.ts） | 注释会让人误以为功能仍在；直接 grep 命令名扫 src 与 lib |
| CHANGELOG 历史小节 | **不要改**——历史记录是事实；只有当前未发布小节才需要同步 |
| 记忆库/契约文档（CLAUDE.md 类） | 新增判据，不删历史 |

**根因修法（写进流程）**：发布清单里加一条——「移除或改名任何能力时，必须同步更新该能力的 SKILL.md 与 README 中对它的描述」，并把「全仓 grep 该能力名 + 动词形态」列为提交前必做。门禁若只断言「README 不得写死版本号」一类形态，拦不住能力残留——残留检查靠 grep 清单，不靠门禁。

## 十四、同一个小节内的数字要同口径：门禁计数随环境（实测）

门禁计数**不是单一真值，而是环境相关**：

- 校验脚本可能按 profile 状态分叉，导致本机与 CI 的检查数量不同；只看总数会误判。应比较每条断言和失败项，而不是把环境差异当作回归。
- 把裸数字写进文档容易过时或与校验环境冲突；需要数字时注明测量环境和统计口径，否则改为可复现的查询方法。
- 更稳的做法：文档里**根本不写计数**，只写命令语义（「仓库配置 + 安全检查」「manifest + 14 个技能结构校验」）——「14 个技能」是稳定信息，「85 项」是运行产物。
- 若门禁本身想防「文档写死版本号」，其正则只匹配点分版本串，**拦不住「85 项」这类计数**——别指望扩展它，删数字才是正解。
- 需要真值时的姿势：用**带完整环境变量**的进程跑（`USERPROFILE`/`HOME`/`DSH_HOME` 齐全），裸 node 沙箱可能因 env 为空把 `dshHome()` 解析成相对路径 `.dsh`，让 profile 分支走错。调试时先打印 `os.homedir()` 与 `process.env.USERPROFILE` 对比。

## 十五、缓存的收益要用实测数据裁决，别用直觉（实测）

「这里该加缓存」「这里缓存没生效」是插件开发的高频直觉，但**收益量级必须实测后再裁决**：

- 判断缓存收益：如果 `list()` 只缓存 frontmatter 摘要，而 `get()` 必须重新读取和解析正文，那么继续扩展摘要缓存未必值得。先在目标环境实测可省掉的读取、解析和一致性成本，再决定是否扩展缓存。
- 裁决方法：用 `performance.now()` 跑「冷 list + N 次 get」计时，中位数跑三轮；把 readFile 与 parse 分开计时，才能看出真正可省的部分。
- **缓存存什么决定缓存能不能复用**：如果缓存条目只存「摘要」（如候选对象），那需要「正文」的消费路径就必然要重读+重解析——这不是实现缺陷，是两段式契约的必然结果。把正文也塞进缓存会引入 stale-body 正确性窗口，且违背「正文按需读取」的架构契约。
- 给「半程缓存」类直觉下结论前先问：*能省的到底是哪一步？省下来的量级是多少？为了省它要引入什么正确性代价？* 三个问题答完再决定做不做。

## 十六、测试替身缺方法 = 生产代码的防御是必需的（实测）

看测试代码时，`fake ctx` 里没有某个方法（如没有 `ctx.get`）会让人以为「生产代码里 `typeof ctx.get === 'function'` 的防御是多余的」——**恰恰相反，那个防御正是为了让生产代码在测试替身下能跑**：

- 测试替身通常只实现被测路径需要的服务面；宿主真实环境服务齐全，测试环境面更少。防御性探测（`typeof ctx.get === 'function' ? ctx.get(...) : undefined`）是「精简宿主/测试替身下降级」的契约，不是重复代码。
- **同一个服务的两个不同能力面要用两个独立探测**：比如 settings 的 `describe()`（读表单）与 `configure()`（注册设置页）是同一服务的不同能力面，合成一个「settings 可用」判断会让「只缺 describe」与「只缺 configure」的宿主行为分叉被抹平——分别探测才是正确行为。这类「看起来重复」的探测**不要收敛**。
- 判断重复还是分叉的标准：两个调用点守卫的**谓词是否相同**。谓词不同（`describe` vs `configure`）就是两个契约；谓词相同才可能是重复。

## 十七、文件级拆分的判据：第二消费方 + 行为面已覆盖（实测）

「把大文件的纯函数抽成独立模块」是重构直觉，但**项目判据不支持时就是为拆而拆**：

- 真实案例：一个技能 Provider 入口文件 719 行里有 160 行 frontmatter 解析纯函数。直觉是「抽成独立文件增加可测性」，核实后三个事实推翻：① 解析函数已被 list/get 集成测试 100% 行为覆盖（正常/BOM/CRLF/注释前导/YAML 错误/非法布尔/重名/mtime 窗口）；② 无第二消费方（「消除重复实现」是既有拆分判据，这里不成立）；③ 已发布的公开导出面里只有 `parseFrontmatter` 一个入口，抽文件不改变接口，收益只是文件位移。
- **有效拆分判据**：第二消费方出现（两处共用同一语义）；或存在共享可变状态需要在函数间协调（拆 apply() 正是为此）；或需要在进程外对某契约做独立回归（如对 vendored 快照做兼容性测试）。
- **无效判据**：行数多、看着乱、想加可测性但行为面已被集成测试覆盖——「换抽屉」不是「换行为」，门禁按纪律不读源码文本，纯位移的改动是门禁盲区。
- 判定动作：grep 全仓该函数的直接引用数（消费者数）+ 检查现有测试是否已覆盖其行为面（集成路径也算覆盖）；两者都满足「1 个消费者 + 集成已覆盖」时，拆分建议应标记 Reject 并记录判据，供未来评审不再重提。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.4
packages/settings/settings  <-  @deepseek-ai/dsh-settings@0.2.0-rc.2
packages/skill/skill  <-  @deepseek-ai/dsh-skill@0.2.0-rc.2
```

---

## 八、轮次拦截深模块架构：TurnCoordinator 模式

在很多涉及交互指令或动态提示词调整的插件中，宿主入口容易在 `agent/pre-step` 拦截点产生严重的**浅模块与逻辑泄露（Shallow Module）**问题。

### 1. 典型坏味道
一次普通的用户请求，入口处散落着多达 6~7 步的底层管道拼接：
1. 从复杂载荷中提取多层级会话 ID；
2. 展平消息块并调用指令分发器；
3. 亲自驱动下游 `await next()` waterfall 执行；
4. 检查下游决策并对比状态变动；
5. 构造增量系统提醒消息（`<system-reminder>`）；
6. 遍历消息数组检索并执行原地替换或追加；
7. 显式调用状态机标记已发射状态。

这使得命令分发器仅仅是一层薄薄的正则表达式壳子，而真正的**轮次拦截生命周期与消息管道控制**全部泄露在入口胶水代码中，理解一次交互需要在 3 个文件之间反复跳跃，缺乏 **Locality**。

### 2. 深模块重构方案：TurnCoordinator
将上述 7 步调用流完整封装进一个统一的高杠杆深模块中，对外仅暴露极窄接口（Narrow Interface）：
```ts
export interface TurnCoordinator {
  handlePreStep(payload: unknown, next: () => Promise<unknown>): Promise<unknown>
  handleSessionEvent(session: unknown, event: unknown): void
}
```

### 3. 必须严格捍卫的 6 大不变量（Invariants）
- **不断链不变量（Pass-through Invariant）**：无论内部解析还是渲染抛出任何异常，必须由 try/catch 记录 warn 且继续 `return await next()`，绝不能中断宿主执行；非 `enter` 决策原样透传。
- **KV Cache 保护不变量（Prompt Cache Protection Invariant）**：整个会话生命周期内顶层 SystemPrompt 前缀必须绝对不可变，所有动态变动严格限制在当前轮次尾部瞬态消息。
- **单通知幂等不变量（Single-Notice Idempotency Invariant）**：同轮消息流中带有更新标识的消息至多 1 条，流水线重试时就地替换，绝不盲目重复 push。
- **发射标记收敛时机不变量（Emission Timing Invariant）**：必须且只能在 `decision.kind === 'enter'` 且消息成功注入后才标记已发射，绝不在 pre-step 前半段提前标记。
- **多会话隔离不变量（Session Isolation Invariant）**：所有状态变更严格限定在当前 `sessionId` 作用域，严禁单会话切档污染全局或兄弟会话。
- **只读命令安全不变量（Read-only Intact Invariant）**：裸查询指令绝不触发状态写入或发射漂移。

### 4. 架构收益
- 宿主入口 `apply` 的两处事件监听直接缩减为两行极简委托；
- 测试面升级：测试用例直接以入站消息和下游桩作为输入，断言出站消息流的最终形状，真正实现 **"The interface is the test surface"**！

---

## 九、全状态存储虚拟化模式（StateStorageAdapter）

很多需要持久化状态（如 flag 标志、会话状态备份）的插件，往往会抽象一个简单的接口（如仅包含 flag 字符串读写的 `Storage`）。但后续当系统引入更复杂的状态文件（如 `session-states.json`）时，开发者容易图省事直接在模块内部硬编码调用 `node:fs` 的 `readFileSync/writeFileSync`。

### 1. 隐藏的物理磁盘耦合风险
- **单元测试内存隔离破损**：测试用例即使传入了内存 Storage 假桩，模块内部依然会去触碰真实物理磁盘；
- **并发与环境竞争**：多测试并行运行时会争抢写同一个磁盘文件，导致偶发脏数据测试崩溃；
- **无权限沙箱失败**：在受限沙箱或无写权限的只读容器下，直接抛错使核心生命周期瘫痪。

### 2. 解决方案：全状态存储契约虚拟化
将持久化适配器契约扩充为覆盖全量状态的抽象接缝（Seam）：
```ts
export interface StateStorageAdapter {
  // 基础 flag 存取
  readFlag(): string | null
  writeFlag(mode: string): void
  clearFlag(): void
  
  // 复杂会话状态字典存取（可选解耦抽象）
  readSessions?(): Record<string, SessionState>
  writeSessions?(sessions: Record<string, SessionState>): void
}
```
- **生产适配器**：`createDiskStorage(profileDir)` 代理物理磁盘文件的安全原子读写与异常兜底；
- **测试适配器**：导出 `createMemoryStorage()` 纯内存适配器，在内存字典中克隆往返，**物理磁盘 0 次触碰**；
- **引导期隔离原则**：一次性引导迁移（如旧路径向 profile 补丁导入）属于启动编排职责，坚决不硬塞进运行时状态引擎，保持运行时模块的纯粹与轻盈。

---

## 十、会话状态跃迁原子事务与防重试撕裂（Session Transition Atomicity）

在很多涉及多会话模式切换、动态配置通知或增量状态更新的插件中，开发者常常把**变动检测**与**已发射标记回写**拆散在调用方（如 `TurnCoordinator` 或 `agent/pre-step` 拦截器）中。

### 1. 典型坏味道与重试撕裂隐患
调用方逻辑通常如下：
```ts
// 坏味道：调用方承担状态机内部时序
const session = state.getSession(sessionId)
if (session.effectiveMode !== session.lastEmittedMode) {
  const noticeMsg = buildNotice(session.effectiveMode, session.lastEmittedMode)
  // 显式回调状态机回写标记
  state.markSessionEmitted(sessionId, session.effectiveMode)
  // 原地替换或追加通知消息
}
```
**隐患分析**：
1. **时序泄漏与缺乏 Locality**：状态机内部的字段比对（`effectiveMode !== lastEmittedMode`）与回写时机外泄，外部调用者必须深刻知晓状态机底层字段名；
2. **重试流水线撕裂**：在宿主触发同轮次管道重试、或发生异常重新入站时，若前置步骤抛出异常，发射标记已提前或未及时回写，容易引发重复追加通知消息，导致单通知幂等不变量被打破。

### 2. 深模块重构方案：原子跃迁消费接口
将比对、发射标记更新与上下文提取完整收拢在状态机深模块事务方法中：
```ts
export interface SessionTransitionResult {
  changed: boolean
  effectiveMode: string | null
  previousMode: string | null
}

// 状态机深接口：原子问询并完成消费
consumeSessionTransition(sessionId?: string): SessionTransitionResult {
  const session = this.getSession(sessionId)
  const previous = session.lastEmittedMode
  const effective = session.effectiveMode
  if (effective !== previous) {
    // 事务自闭环：原子更新发射标记并持久化
    session.lastEmittedMode = effective
    this.persistSessions()
    return { changed: true, effectiveMode: effective, previousMode: previous }
  }
  return { changed: false, effectiveMode: effective, previousMode: previous }
}
```

### 3. 架构收益
- **调用方极简**：调用方仅需 `const tr = state.consumeSessionTransition(sessionId); if (tr.changed) { ... }`，“问一次即完成消费”；
- **绝对幂等性**：后续同轮次重试或下一轮未变动时调用，原子返回 `changed: false`，彻底杜绝状态撕裂与多余通知注入。

---

## 十一、统一持久化通道接缝与消灭旁路直接写盘（Single Config Sink Seam）

当插件同时支持官方 Settings 服务补丁通道（首选）与本地文件回退通道（headless / CLI / 纯净环境）时，极易产生**双轨写盘与接缝击穿漏洞**。

### 1. 典型架构摩擦
在配置解析模块中，既导出了上层通用的路径工具和类型，又直接导出了底层裸写盘函数（如 `writeConfigFileDirectly`）。其他业务子模块（如命令行分发器、状态重置器）在调用时，容易直接调用裸写盘函数绕过官方 Settings 补丁通道。
结果：在拥有官方 Settings 服务的运行时环境下，配置被直接写进了磁盘文件，而宿主 Profile 补丁全然不知，造成严重的**多环境数据撕裂**。

### 2. 解决方案：Single Sink Seam 范式
1. **统一抽象 Sink 接缝**：定义统一的配置通道接口 `PluginConfigSink`（具备 `readConfig`、`writeConfig`、`reset` 等标准正交方法）；
2. **物理磁盘 I/O 独占收归 FileSink**：所有底层的物理文件读取、字段级合并（merge）与崩溃安全原子写盘逻辑，**完全且独占**内聚在 `createFileSink` 内部；
3. **配置定义模块彻底纯化**：将配置定义模块纯化为 100% 无副作用的纯类型、纯常量与路径计算模块；若为了向后兼容必须保留旧函数签名，内部坚决改为委托给 `createFileSink()` 处理，彻底封死旁路直接写盘后门。

---

## 十二、多通道宿主上下文目标解构的单一真源与依赖拓扑消环 (Context Target Resolution & DAG Topology)

在 Cordis / DSH 插件体系中，宿主回调（如 `agent/pre-step`、`session/event`、`systemPrompt.section` 等）传入的上下文载体（Payload / Context）存在多层异构变体（例如 `payload.agent?.session?.id`、`payload.scope?.session?.id`、或直接 `payload.session?.id`）。

### 1. 典型坏味道与循环依赖陷阱
各个消费子模块（如轮次拦截协作者 `TurnCoordinator`、提示词引擎 `SystemPromptSection`、事件监听器等）极易在内部各自手写复杂的内联可选链探针。
当试图消除这处重复代码时，开发者通常直觉地在轮次协作者模块中定义并导出提取函数（如 `resolveSessionTarget`），并在提示词模块中反向导入它。
**致命架构陷阱**：
由于轮次拦截协作者往往需要导入提示词引擎的动态提醒构造函数（如 `renderModeNotice`），若提示词引擎反向导入轮次协作者的会话提取函数，就会在标准 ESM 模块系统下引发**不可调和的双向循环依赖 (Circular Dependency)**，在打包构建或某些测试运行时下导致未初始化的导出变量或不可预测的死锁！

### 2. 标准架构范式：单一真源下沉与单向有向无环图 (DAG)
1. **下沉至最底层无状态模块**：将多通道上下文提取器抽取为零副作用纯函数 `resolveSessionTarget(target: unknown): string | undefined`，下沉至基础常量/配置工具模块中，成为全仓该契约的**唯一真源**；
2. **上层消费者单向引用**：提示词引擎直接从底层模块单向导入，消除内联脏探针；
3. **拦截器向前兼容重导出**：轮次协作者模块同样从底层导入，并通过 `export { resolveSessionTarget }` 重导出，保持公开 API 表面稳定；
4. **依赖拓扑绝对单向无环**：
   ```text
   PromptEngine -----> BaseConfig (resolveSessionTarget)
        ^                     ^
        |                     |
   TurnCoordinator -----------+
        ^
        |
   HostEntry (apply)
   ```

---

## 十三、Windows PowerShell 自动化脚本环境下的命令链分号兼容规范 (PowerShell Chaining Semicolon Rule)

在 DSH 插件的自动化测试、构建门禁脚本或 CI 执行器中，经常需要依次执行多条连续的 Git/CLI 终端命令（如提交并推送、打包并测试）。

### 1. 致命语法报错机制
在 Linux/macOS Bash 环境下，惯用 `cmd1 && cmd2` 实现前序命令成功后执行后序命令。
但在 Windows 平台下，若调用环境是早期 Windows PowerShell（如 PowerShell 5.1）或某些受限的执行管道解析器时，`&&` 操作符会被标记为非法语法符号并直接抛错：
```text
ParserError: 标记“&&”不是此版本中的有效语句分隔符。
FullyQualifiedErrorId : InvalidEndOfLine
```

### 2. 标准工程准则
在面向跨平台与 Windows 宿主环境编写自动化工具或流水线命令时：
1. **优先使用标准分号 `;` 分隔**：`git add . ; git commit -m "..."`，语法在全版本 PowerShell、pwsh 及跨平台环境中均能原生兼容；
2. **或拆分为独立的命令调用执行**：在自动化脚本中分别调度 `tools.pwsh`，并根据前一个调用的 `exitCode === 0` 显式裁决是否继续执行后续步骤，从根源杜绝命令行解析器方言带来的意外中断。

---

## 十四、对称具名安装器装配范式 (Symmetric Named Installer Pattern)

### 1. 现实痛点：apply() 闭包变量膨胀与生命周期纠缠
在 Cordis / DSH 插件开发中，随着功能增多，入口函数 `apply(ctx, config)` 极其容易退化为一个长达数百行的“上帝闭包”：
```typescript
// 典型反模式：数十个生命周期变量混杂在一个 ctx.effect 中
export function apply(ctx: Context, config: Config) {
  ctx.effect(() => {
    let disposed = false;
    let timerA: NodeJS.Timeout | undefined;
    let isFeatureASyncing = false;
    let unregisterA: (() => Promise<void>) | undefined;
    // 嵌套 80 行实现 Feature A...

    let featureBState = false;
    const disposeB = ctx.on('event-b', () => { ... });
    // 嵌套 60 行实现 Feature B...

    return () => {
      disposed = true;
      clearTimeout(timerA);
      if (unregisterA) void unregisterA();
      disposeB();
      // 注销链条极其脆弱，只要漏写一个变量就会发生内存或事件泄漏！
    };
  });
}
```

**架构危害**：
1. **内聚局部性丧失**：Feature A 的临时变量与 Feature B 的监听器并列存在于同一函数作用域中，开发者阅读 Feature A 时必须在大脑中过滤掉混杂的无关变量；
2. **生命周期可逆性难以审查**：无法直观判断某个副作用是否真正拥有对称的清理函数，重载时极易产生悬挂监听器；
3. **无法独立单元测试**：由于所有逻辑深嵌在 `apply` 的闭包内部，无法在不启动全量宿主环境的情况下对单个能力进行隔离测试。

### 2. 标准解法：对称具名安装器 (Named Installer)
将每一个独立的能力或副作用提炼为专门的**具名安装器函数**。每个安装器遵循统一的契约范式：
- **明确入参**：显式传入所需的宿主上下文与 getter 依赖，杜绝隐式作用域捕获；
- **对称返回**：统一返回单一清理函数 `() => void`，或 `[triggerFn, disposeFn]` 元组；
- **内部自闭环**：该功能所有的重试定时器、防抖标志位、注销 Promise 独占内聚在安装器内部，绝不外溢。

```typescript
/** 具名安装器示例：预设模式管理器 */
function installPresetMode(ctx: Context, options: {
  getMode: () => string;
  getPresets: () => any;
}): [() => void, () => void] {
  let disposed = false;
  let unreg: (() => Promise<void>) | undefined;
  let timer: NodeJS.Timeout | undefined;

  const sync = async () => {
    if (disposed) return;
    // 内部自闭环处理注册与重试...
  };

  void sync();

  return [
    () => { void sync(); }, // 触发接口
    () => {                 // 清理接口
      disposed = true;
      clearTimeout(timer);
      if (unreg) void unreg().catch(() => {});
    },
  ];
}

/** 具名安装器示例：特权工具运行期拦截守卫 */
function installToolGuard(ctx: Context, options: { getTools: () => any }): () => void {
  return ctx.on('agent/created', (agent) => {
    // 内部自闭环挂载 tools.restrict 与 tools.guard...
  });
}
```

### 3. apply() 蜕变为极薄的装配层编排器
提炼具名安装器后，入口 `apply()` 彻底脱胎换骨为极简高可读的装配层：
```typescript
export function apply(ctx: Context, config: Config) {
  ctx.effect(() => {
    // 四大具名安装器同构对称装配
    const [runtime, disposeRuntime] = installSkillRuntime(ctx, runtimeOptions);
    const [, disposeWatcher] = installSkillsWatcher(ctx, watcherOptions);
    const [syncPreset, disposePreset] = installPresetMode(ctx, presetOptions);
    const disposeToolGuard = installToolGuard(ctx, guardOptions);

    // 统一串联清理函数，可逆性一目了然
    return () => {
      disposeToolGuard();
      disposePreset();
      disposeWatcher();
      disposeRuntime();
    };
  });
}
```

---

## 十五、全链路 AbortSignal 取消信号无死角穿透与快照发布闭环

### 1. 取消信号断路陷阱 (Signal Truncation Trap)
在许多 DSH 插件中，开发者在最底层的 I/O 方法（如 `readFile(path, { signal })` 或 `provider.list({ signal })`）中接入了取消信号支持，但在上层代码中却常常出现断路：
```typescript
// 典型反模式：上层封装丢弃取消信号
class Runtime {
  async listNames() {
    // 错误！底层明明支持 signal，这里却传递了空配置 {} 丢掉了上下文！
    const list = await this.provider.list({});
    return list.map(item => item.name);
  }
}

async function publishCatalog(runtime: Runtime) {
  // 当大型目录扫描耗时较长、用户或宿主发出取消时，这里完全无法响应！
  const names = await runtime.listNames();
  await settings.update(namespace, { catalog: names });
}
```

**危害**：
1. **外部取消无法中断**：当技能目录包含成百上千个文件或网络磁盘发生高延迟时，上层无信号参数导致扫描任务必须完整跑完才能退出，浪费计算资源与 I/O；
2. **外部取消被误判为物理损坏**：如果底层抛出 `AbortError`，而在异常捕获层盲目执行 `cache.delete(path)` 或记为读取失败，会将一次正常的主动中止错误地当作磁盘文件损坏，甚至误删合法的 mtime 缓存！

### 2. 标准全链路贯穿规范
必须保证取消信号从入口流水线一直无死角透传至底层文件系统：

1. **上层抽象显式透传**：
   ```typescript
   export interface SkillRuntime {
     // 接口必须支持可选的 signal
     listNames(signal?: AbortSignal): Promise<string[]>;
   }

   // 实现层严格透传
   async listNames(signal?: AbortSignal) {
     const listed = await provider.list({ signal });
     return listed.map(c => c.name);
   }
   ```

2. **异常捕获必须优先识别并重抛 AbortError**：
   ```typescript
   function isAbortError(error: unknown, signal?: AbortSignal): boolean {
     if (signal?.aborted) return true;
     return error instanceof Error && error.name === 'AbortError';
   }

   try {
     const text = await readFile(path, { encoding: 'utf8', signal: options.signal });
   } catch (error) {
     // 铁律：优先检查是否为取消错误！
     if (isAbortError(error, options.signal)) {
       throw error; // 必须原样重抛，绝不吞没，绝不执行 cache.delete！
     }
     // 真正的文件读取损坏才走降级和日志
     cache.delete(path);
     logger.warn('file read failed: ' + String(error));
   }
   ```

**总结**：全链路贯穿 `AbortSignal` 并严密保护异常判断，能够彻底确保系统在处理高并发、长遍历及协作式取消时表现出极强的健壮性与防抖抗性。
