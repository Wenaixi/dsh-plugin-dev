# Context 上下文 API 与作用域

`Context` 是 Cordis 运行时的根基，也是每个插件与微内核交互的唯一媒介。整个 DSH 系统由树状上下文（Context Tree）维系。

## Context 核心方法

### 1. 插件挂载：`ctx.plugin()`

在当前上下文分支上挂载子插件：

```ts
// 挂载函数插件并传入配置
ctx.plugin(MyPlugin, { timeout: 5000 })

// 挂载类插件
ctx.plugin(MyServiceClass)
```

每次调用 `ctx.plugin()` 会生成一个关联的 `Fork` 句柄，用于控制该插件实例的销毁与重载。

### 2. 可逆副作用：`ctx.effect()`

注册受当前上下文生命周期管控的副作用清理函数：

```ts
ctx.effect(() => {
  const timer = setInterval(() => {
    // 定时轮询
  }, 1000)

  // 返回清理函数 (Disposer)
  return () => {
    clearInterval(timer)
  }
})
```

当包含该调用的插件被卸载时，返回的注销函数保证会被自动执行。

### 3. 事件派发与监听

- `ctx.on(name, listener, options?)`: 注册事件监听器。
- `ctx.once(name, listener)`: 单次监听。
- `ctx.emit(name, ...args)`: 同步广播。
- `ctx.waterfall(name, ...args)`: 瀑布流链式加工。
- `ctx.parallel(name, ...args)`: 并发异步等待。
- `ctx.serial(name, ...args)`: 串行异步等待。
- `ctx.bail(name, ...args)`: 短路阻断。

### 4. 上下文过滤与隔离：`ctx.isolate()`

Cordis 允许在特定上下文子分支上隔离特定服务，防止其污染全局或被外部意外消费：

```ts
// 在子上下文中隔离自定义数据库服务，仅当前分支可见
const isolatedCtx = ctx.isolate(['database'])
isolatedCtx.plugin(SubPlugin)
```

## DSH 专用作用域库 (@deepseek-ai/dsh-scope)

为了实现按 Agent / 会话维度的精确状态隔离（避免多 Agent 共享同一进程时的上下文污染），DSH 提供了零依赖基础库 `@deepseek-ai/dsh-scope`：

- `createScope(owner)`: 为指定的 Agent 实体创建专属作用域对象。
- `scopeOf(ctx)`: 解析当前调用栈所属的目标作用域。
- `scopeTarget(scope)`: 获取作用域绑定的宿主实例。

通过将 `ToolRuntime` 的 `register()`、`guard()`、`restrict()` 与作用域结合，系统可实现单进程内多个不同预设 Agent 拥有完全独立的工具集和拦截规则。
