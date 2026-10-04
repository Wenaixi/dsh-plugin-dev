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
- **聚合的 ok 必须与门禁的判定口径一致**：聚合字段漏判一个失败源（如 missingSkillMd），就变成「看着健康实则缺件」的死字段——未来有人拿它做判定会漏报；
- **每条新断言先做破坏实测**：在旧实现上跑新用例确认 FAIL（证明断言真的能抓缺陷），实现后确认 PASS，再把实现故意改错确认红、还原确认绿。写反一处比较逻辑就能证明断言非恒真；
- **边界断言要覆盖完整数据域**：自检样本只测一个前缀/扩展名时，其它形态的漂移永远不被感知；枚举全部形态各一条样本。

## 七、正则字符类要按真实数据域写，别抄模板

守卫/提取正则的字符类若与真实数据形态不符，会「静默放行全部漏网」且门禁全绿：

- 反例（真 bug）：标识符前缀分支写成 `[w-]+`（照抄某模板），而真实标识符是 kebab-case（每段可含数字与多连字符，如 `my-cool-plugin-v2`），一个都匹配不到——带前缀的调用全部逃逸守卫；
- 修法：先确认数据域的真实字符集（全仓枚举一次实际取值），再写字符类；两处语义相同的正则（自检样本与消费方）必须共用同一份定义，否则自检绿、消费方漏；
- 自检补钉的顺序价值：**先补断言、再修实现**，让缺陷以「自检红」的方式现形，而不是修复后断言永远绿；
- 手写「括号配平」类解析器是零守卫陷阱：字符串引号分支写错（`char === ''` 空串）会让字符串内符号参与配平，靠「数据恰好没有那种符号」幸存；能用「朴素边界 + 求值失败即报错」替代就不手写配平。
