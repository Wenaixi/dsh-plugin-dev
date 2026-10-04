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
