# DSH 与 Cordis 事件系统权威技术指南 (DSH 0.2.0-rc.2)

本文件是 DeepSeek Harness (DSH 0.2.0-rc.2) 与 Cordis 4.0.4 事件派发机制、宿主运行事件与持久会话事件（Persistence Catalog）的官方权威规范。

---

## 一、Cordis 五大事件派发模式 (Dispatch Modes)

DSH 构建于 Cordis 事件总线之上。Cordis 提供五种严格区分同步/异步、短路与环绕语义的派发模式：

| 模式名称 | 源码调度算法与返回值 | 适用场景与核心语义 |
| --- | --- | --- |
| `emit` | 同步顺序通知，返回 `void`，不等待 Promise | 纯状态广播与无返回值通知（如 `skills/change`、`agent/disposed`） |
| `waterfall` | **同步环绕中间件 (Around-Middleware)**<br>监听器接收 `(...args, next)`，外层先调，内部调 `next()` 驱动下游，返回最终值 | 拦截器、请求管道、动态上下文过滤与参数/结果整体替换。**绝非简单顺序传值链**！不调 `next()` 即短路。 |
| `parallel` | `Promise.allSettled` 并发等待**全部 settle**<br>返回 `Promise<void>`（**绝非结果数组**） | 异步资源关闭与并发收敛通知（如 `workspace/session-stop`）。若有失败项，全部 settle 后汇总抛出 `AggregateError`。 |
| `serial` | 串行依次 `await`，直到遇到首个 bail 值即短路返回<br>返回 `Promisify<ReturnType>`（**绝非结果数组**） | 异步短路链、优先处理者决策链（首个非 null/非 false/非 undefined 的 bail 值胜出）。 |
| `bail` | 同步按序调用，遇到首个 bail 值即同步短路返回<br>返回 `ReturnType` | 同步优先级匹配、首个命中即停的决策链。 |

### 1. Bail 值的严格判定准则 (`isBailed`)
在 `serial` 与 `bail` 模式中，返回值是否触发短路的判定逻辑为：
```ts
export function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined
}
```
- **重要边界**：数字 `0`、空字符串 `""`、空对象 `{}` 均被视作合法 bail 值并触发短路！
- 显式返回 `false` 会被视作非 bail 值，流水线将继续向下执行下一个监听器。

### 2. EventOptions、Disposer 与 thisArg 重载
- **监听器配置项**：
  ```ts
  export interface EventOptions {
    prepend?: boolean // 插入到该事件现有监听器队列的最前面
    global?: boolean  // 忽略上下文作用域过滤器 (Context.filter)，强制全局接收
  }
  ```
  在 `ctx.on(name, listener, true)` 中，第三个参数传布尔值即为 `{ prepend: true }` 的简写。
- **Disposer 注销函数**：
  `ctx.on()` 与 `ctx.once()` 返回一个可调用的注销函数（`fiber.effect` 包装）；调用它即卸载该监听器（内部 `unregister` 成功移除返回 `true`，未找到返回 `undefined`）。监听器由所属 Fiber 的 `effect` 生命周期自动托管，Fiber 卸载时全自动注销。
- **`thisArg` 首参重载**：
  所有五大派发方法均原生提供首参为 `thisArg` 的重载，支持显式指定监听器内部 `this` 绑定。

---

## 二、宿主核心运行事件 (Host Runtime Events)

| 事件名 | 派发模式 | 核心传参与生命周期语义 |
| --- | --- | --- |
| `workspace/session-activity` | **waterfall** | `({ sessionId }, next)`：Workspace 归档会话前询问活跃状态。四大活动族（`turn`、`subagent`、`job`、`schedule`）通过 `next()` 合并入数组。若数组非空，Workspace 立即拒绝归档。 |
| `workspace/session-stop` | **parallel** | 会话归档或强制停止时并发派发。各子系统以用户自身的停止方式取消当前活跃活动（如丢弃排队收件箱，记录 inbox splice）。宿主捕获 `AggregateError` 后逐条 `logger.warn`，归档不被中止，不向调用方抛出。 |
| `plan/mode` | **双重机制** | 持久化层为仅记日志的 SessionEvent `plan/mode`（整值替换）；运行时通过 `ctx.sessionProjections`（SessionProjectionRegistry）注册的 `plan` 单元推导 `{ active, pending }` 视图。注：`plan/mode` 事件本身不进模型 transcript，但带消息后缀的 `/plan <text>` 会经 `agent.steer()` 成为一条用户消息进入历史（不带附件的 `/plan` / `/plan off` 留在历史之外）。 |
| `skills/change` | **emit** | 技能注册表发生变动（增删改）时的全局失效广播，不带 diff。消费方收到后应重新调用 `ctx.skills.list()`。 |
| `agent/created` | **serial** | 活动 Agent 实例创建时广播（真实生命周期事件；`ready` 事件在 0.2.0-rc.2 中不存在）。 |
| `agent/disposed` | **emit** | Agent 实例销毁时广播（宿主防御性隔离，监听器抛错仅记日志）。 |

---

## 三、持久会话事件体系 (Persistence Catalog)

在 DSH 会话存储层中，所有日志以仅追加（Append-Only）的 `SessionEvent` 形式持久化（JSONL 或 SQLite）。由 `gen-persistence-catalog.ts` 维护的已知事件全貌严格包含 **59 个核心类型**（0.2.0-rc.2 实测）。

### 1. 表面事件 (SurfaceEventType，严格 5 大类)
在 59 个事件中，**唯有以下 5 类事件代表模型可见表面节点**（产生 LLM 上下文历史）：
1. `system/message`：系统消息；
2. `developer/message`：开发者指令；
3. `user/message`：用户输入；
4. `assistant/message`：模型响应；
5. `tool/result`：工具执行结果。

### 2. `surfaceOp` 操作语义
只有上述 5 类表面事件允许携带 `surfaceOp`，其余 54 个事件在类型定义中强制 `surfaceOp?: never`：
- `'append'`：向当前模型上下文表面末尾追加节点；
- `{ op: 'replace', startSeq: SessionSeq, endSeq: SessionSeq }`：用于会话压缩（Compaction）与历史修剪，声明被替换的表面事件序号范围，被遮蔽节点不再进入模型上下文。

### 3. `ignorable` 向前兼容性契约
- **缺席 = 必需 (Required)**！
- 当反序列化器读取会话日志时，如果遇到不在已知 59 个类型集合中的事件：
  - 若该事件**未携带** `ignorable: true`，反序列化器**必须抛出异常并拒绝重建会话 (fail-fast)**，防止因静默丢失关键事件造成状态推导错误；
  - 若该事件标记了 `ignorable: true`，则视为安全的向前兼容扩展，仅作为日志存储保留，跳过表面重建。

### 4. SHA-256 结构指纹
Persistence Catalog 为每个事件类型自动计算 SHA-256 结构指纹：
- 严格针对属性名、属性类型、可选性以及元组内元素顺序计算哈希；
- 注释、声明位置、字段别名和 `readonly` 修饰符不改变指纹；用于 CI 自动化拦截未经版本迁移的破坏性事件结构变更。

---

## 四、监听器的防御性隔离：永不抛，且 waterfall 必须放行

派发模式决定了坏监听器的爆炸半径，而它们互不相同：

| 模式 | 监听器抛异常的后果 |
| --- | --- |
| `emit` | 异常同步冒泡到派发方，可能打断派发方正在做的事 |
| `waterfall` | **不调 `next()` 即短路**，抛异常等于替你决定「这条链到此为止」，下游全部不执行 |
| `serial` | 第一个抛异常的监听器让整条链失败，后续监听器不执行 |
| `parallel` | 全部 settle 后汇总抛 `AggregateError`，调用方拿到的是异常而非结果 |
| `bail` | 同步冒泡，同 `emit` |

由此得到两条通用写法（对外扩展类插件的硬性要求）：

1. **监听器体整体包 try/catch，异常只记日志不外抛**。宿主核心生命周期事件（agent 创建、会话流转）往往走 `serial`/`parallel`，一个第三方插件抛错就足以让整次会话创建失败。catch 里用 `ctx.logger(...).warn()` 留下可检索的痕迹，不要静默 `catch {}`。
2. **waterfall 监听器无论业务成功还是失败都必须 `return await next()`**。业务失败时也不要直接 return，那等于短路掉所有下游中间件，等于用一次异常劫持整条管线。正确形态是「记录失败 → 仍然放行 → 让下游决定后果」。

```js
// 反例：异常即短路，下游全丢
ctx.on('some/hook', async (payload, next) => {
  const value = await doWork(payload)   // 抛错就短路
  return next(value)
})

// 正例：失败可见，但不劫持管线
ctx.on('some/hook', async (payload, next) => {
  try {
    await doWork(payload)
  } catch (err) {
    ctx.logger('my-plugin').warn(`hook 处理失败（仍放行下游）: ${String(err)}`)
  }
  return next()
})
```

判据：这段插件的失败**是否应该让整个宿主跟着失败**？绝大多数情况答案是否，那就必须隔离。

---

## 五、事件监听代码实战

```js
export const inject = ['tools']

export function apply(ctx) {
  // 1. 同步广播监听（注意：`ready` 事件不存在；真实生命周期事件是 `agent/created`）
  const unbindReady = ctx.on('agent/created', ({ agent }) => {
    ctx.logger('my-plugin').info('Agent 已创建: ' + agent.id)
  })

  // 2. waterfall 环绕中间件（拦截工具前置决策）
  ctx.waterfall('tools/pre-execute', async (exec, next) => {
    // 检查是否受保护
    if (exec.name === 'dangerous_tool') {
      // 短路拦截，不再调用下游
      return { kind: 'deny', reason: '此工具已被策略拦截' }
    }
    // 正常放行至下游监听器
    return next()
  })

  // 3. 监听会话活动检测
  ctx.waterfall('workspace/session-activity', (target, next) => {
    const list = next() || []
    if (hasPendingJob(target.sessionId)) {
      list.push({ kind: 'job', items: [{ id: 'my-job-1' }] })
    }
    return list
  })
}
```