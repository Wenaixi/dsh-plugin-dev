# 依赖注入与服务契约

## 核心判断

把依赖分成必需能力和可选能力。必需能力通过正式注入声明；可选能力才允许延迟查找，而且降级结果必须可观察。延迟查找不能用来掩盖必需依赖的拼写错误或激活失败。

## 核对顺序

1. 找到真实提供方和挂载名。
2. 读取目标版本的类型声明与实现，确认服务实例、注册表和控制器的区别。
3. 确认依赖何时就绪、何时失效、方法如何取消。
4. 用最小运行时探针确认实例形态，不凭示例猜测。
5. 测试缺失依赖、延迟就绪、服务替换和卸载后的消费行为。

## 提供共享能力

共享能力应隐藏实现复杂度，只暴露稳定接口。注册、监听和缓存属于提供方的生命周期；消费方不应依赖注册顺序、内部对象或隐式全局状态。接口应说明输入、输出、错误、取消和幂等语义。

## 读「未 inject 服务」的两条路：属性读 vs ctx.get

插件有时要读一个不在 `inject` 声明里的可选服务（例如 headless/CLI 组合装配不上、不能因它而 PENDING 的
`settings` 服务）。两条路语义完全不同，选错就是「运行时永远 undefined、行为静默回退」：

| 写法 | 真实语义 | 什么时候有效 |
| --- | --- | --- |
| `ctx.settings`（属性读） | 走 cordis get trap 的 isolate 隔离查找，**兄弟 fiber / 未注入服务会抛 `cannot get property "settings" without inject`** | 只在「当前 fiber 自己 provide 过」或属性在该 fiber 可见范围内有效 |
| `ctx.get('settings', false)` | Service.get 直接查 store（`_getImpl`），不要求 inject、不抛错，缺失返回 undefined | 任意服务，含兄弟 fiber 提供的；`strict=false` 连「提供方 fiber 未激活」也放行 |

实战教训（双面插件、宿主侧）：启动期把 `ctx.settings` 属性读缓存进闭包，之后每次求值都用它——
在真实宿主上该属性读被 get trap 隔离抛错、try/catch 吞成 undefined，于是「读宿主其他命名空间做初始对齐」
的功能**恒回退默认值且零报错**，只有隔离验收的运行时回读能暴露。

正确写法（宿主侧读可选服务）：

```ts
function readOptional<T>(ctx: Context, name: string): T | undefined {
  try {
    const c = ctx as unknown as { get?: (n: string, strict?: boolean) => unknown }
    if (typeof c.get === 'function') {
      const v = c.get(name, false)
      if (v !== undefined && v !== null) return v as T
    }
  } catch {
    // 兜底走属性读
  }
  try {
    return (ctx as unknown as Record<string, unknown>)[name] as T
  } catch {
    return undefined
  }
}
```

判据：跨 fiber 读服务、且该服务是「可选能力」时，一律 `ctx.get(name, false)`；属性读只用于你自己 provide 的
对象或同 fiber 可见面。

## 常见失效

- 服务名称的单复数或命名空间混淆。
- 注入声明与实际消费不一致。
- 服务已注册，但方法契约和错误语义没有核验。
- 把动态查找当成必需依赖的替代品。
- 把宿主能力直接带入浏览器运行面。
- 用启动期缓存的属性读拿「会动态变化的可选服务」，导致行为恒回退默认值且零报错。

验收重点是消费者拿到的行为正确，而不是插件入口曾经执行过。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.4
vendor/loader  <-  @deepseek-ai/cordis-plugin-loader@1.0.5
```
