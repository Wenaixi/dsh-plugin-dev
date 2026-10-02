# Cordis 4.0.4 Context Proxy 隔离内核剖析

在 DSH 中，`Context` 对象本质是一个受保护的 JavaScript Proxy，属性访问通过服务解析器（Service Resolver）动态分发。本文件是 `plugin-anatomy.md` 第三节的底层补充，只讲三个隔离原语。

## `ctx.isolate(key)` 服务作用域物理隔离槽

当插件希望在子上下文中覆盖某个全局服务，但又不希望污染全局父级上下文时：

```js
// 在子上下文为 customCache 服务创建隔离槽
const childCtx = ctx.isolate('customCache');

// 子上下文注册的实现仅对自己及后代可见，父上下文完全感知不到
childCtx.plugin(MyIsolatedCachePlugin);
```

隔离键被记录在 `Context[symbols.isolate]` 映射表中，由此实现多 Agent 或多任务间的服务多租户隔离。

## `ctx.intercept(key, config)` 动态拦截代理

允许针对特定服务的方法调用或属性读取挂载动态拦截器（Intercept Map），在不重写服务类的情况下实现切面监控或参数注入。

## `Context.is(value)` 全局跨 Realm 品牌检验

Cordis 废弃了脆弱的 `value instanceof Context` 判定，改用全局 Symbol 品牌：

```js
Context.is[Symbol.toPrimitive] = () => Symbol.for("cordis.is");
```

即便在多包 Monorepo、不同 npm 副本或不同 iframe / Worker Realm 下，跨环境的 Context 对象依然能被准确识别。
