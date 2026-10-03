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
interface Deps {
  state: State
  readRawConfigMode: () => string | undefined
  invalidateSkills: () => void
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

- **假 res**：`node:http` 的 res 不是 class、无私有状态，普通对象即可冒充——`{ setHeader(){}, writeHead(c){status=c}, end(b){body=b} }`；
- **零为测试造抽象**：不需要为可测性新增 bodyReader 参数，stub async iterator 已够；
- 抽取时把 GET/POST 共用的响应组装（快照）收成一个函数，避免把重复代码搬家。

## 三、配置写盘：字段级 merge，别丢用户手写字段

- 反例（真坑）：配置写盘函数只重建两键对象，`config.json` 里用户手写的未知字段被静默丢弃；
- 正确：读原文 JSON → 字段级 merge → 写回（未知字段原样保留）；
- 非法值（defaultMode 未归一）**拒绝写盘返回 null**，不覆盖原文件；
- 两个写函数骨架相同（mkdir+read+merge+stringify）时合并为一个 `write(patch)`，语义以「保留未知字段 + 拒绝非法值」为准；
- 补一条行为测试锁「未知键保留」——要防旧行为回归。

## 四、孤儿函数与失效类型

- 全仓 grep 调用方，确认零调用再删；导出名单同步清理（含 lib 产物）；
- 删完后把「该孤儿」从记忆库/债务表移除，避免下次再当候选扫描出来。

## 五、文件编辑的 CRLF 坑

Windows 上源码文件常为 CRLF。`old_string` 用 `\n` 分隔的精确匹配会反复失败——**先 `readFileSync` 按行读、按行号切割替换、按原行尾 join 写回**，或先 grep 确认行首尾字节。
