# Cordis Context Proxy 隔离内核参考

在 DSH 中，`Context` 对象本质是一个受保护的 JavaScript Proxy，属性访问通过服务解析器（Service Resolver）动态分发。本文件是 `plugin-anatomy.md` 第三节的底层补充，只讲三个隔离原语。

## `ctx.isolate(key)` 服务作用域物理隔离槽

当插件希望在子上下文中覆盖某个全局服务，但又不希望污染全局父级上下文时：

```js
// 在子上下文为 customCache 服务创建隔离槽
const childCtx = ctx.isolate('customCache');

// 隔离来自 isolate() 为 customCache 指派新 label（默认新建唯一 Symbol），子上下文注册的实现写入新 label 槽位，父上下文仍按旧 label 解析，因此互不可见
childCtx.plugin(MyIsolatedCachePlugin);
```

隔离键被记录在 `Context[symbols.isolate]` 映射表中，由此实现多 Agent 或多任务间的服务多租户隔离。

## `ctx.intercept(key, config)` 动态拦截代理

拦截的是服务配置而非方法调用：`inject` 声明的 config 写入 `Context.intercept`，`resolveConfig` 沿原型链自根向叶合并后交给服务自己的 `Config.merge`（不重写服务类）。

## `Context.is(value)` 全局跨 Realm 品牌检验

Cordis 用全局 Symbol 品牌做跨环境识别（`instanceof` 对 Context 本就不适用；自定义 `[Symbol.hasInstance]` 的是 Service 的继承链判定）：

```js
Context.is[Symbol.toPrimitive] = () => Symbol.for("cordis.is");
```

即便在多包 Monorepo、不同 npm 副本或不同 iframe / Worker Realm 下，跨环境的 Context 对象依然能被准确识别。
