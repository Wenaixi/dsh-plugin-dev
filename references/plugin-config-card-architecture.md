# 插件配置卡架构：插槽位置、Settings 命名空间与 ConfigForms 生命周期

本文只描述 DSH 上「插件自带配置界面」的完整机制与判据。包名、版本号、事故叙述不进入本文。

## 零、先分清三个不同层次

配置界面上一次错误的迁移，几乎都源于把这三层当成一层。三层互相独立，任何一层缺失都会让界面静默消失。

| 层 | 回答的问题 | 谁提供 |
|---|---|---|
| 插槽 slot | 组件画在哪个界面位置 | 客户端 slot 系统 |
| Settings 命名空间 | 卡片读写哪份配置数据 | 宿主 `settings.register` |
| 生命周期观察 | 卡片何时存在、何时卸载 | 客户端 ConfigForms 服务 |

常见误解：以为「注册了插槽就等于有了配置界面」。实际前两者与第三者缺一不可，且第三者的触发条件不是「插件存在」。

## 一、位置层：配置卡的插槽形态

DSH 同一代宿主通常并存两代插件配置卡插槽：

| 插槽 | 世代 | 匹配键 | 数据面来源 |
|---|---|---|---|
| `plugins.bundle.config` | 新版插件详情页 | 包名 | `configForms.get(ns)` |
| `settings.plugin.item` | 旧版设置窗口 | 命名空间 | `settingsScope.bind({ namespace })` |

参考实现会同时挂两处，共享同一个数据面函数：

```js
const cardFace = () => ({
  hooks: { <domain>Settings: settings.store },
  set: (field, value) => { settings.set(field, value) },
})
```

要点：

1. `key` 用什么字符串，必须与宿主渲染该插槽时使用的匹配键一致。新版通常按包名，旧版按配置命名空间。写错不报错，卡片静默不出现。
2. `locale: <ns>` 让渲染器向组件注入取词函数，组件才能渲染双语。
3. `inject: cardFace` 是数据面，组件从 props 消费，不直接触碰 ctx。
4. 一个功能一个入口。多落点冗余等于 UI 污染，既有门禁通常直接判定失败。

## 二、数据层：Settings 命名空间注册

宿主侧必须在插件配置 schema 上注册命名空间：

```ts
ctx.inject(['settings'], (sctx) => {
  const service = sctx.settings
  if (typeof service?.register !== 'function') return
  service.register('<ns>', ConfigSchema)
})
```

契约要点：

- 用 `ctx.inject` 动态探测，不要写进插件的静态 `inject` 数组。宿主未装配 settings 服务时应静默降级，不阻断插件其余能力。
- 命名空间字符串是宿主、Settings 镜像与浏览器表单三方的连接键，一处写错则整条链断开。
- `ConfigSchema` 通常与插件 `Config` 导出同一个对象，保证宿主读到的字段与声明一致。
- 插件导出名与 Settings 命名空间是**两个独立命名空间**。插件名为 A 不代表命名空间为 A，声明了 `name` 也不会自动产生 Settings 命名空间。

## 三、生命周期层：ConfigForms 与 whileServed

Settings 域在客户端提供一个 Service（形如 `configForms`），提供两个关键能力：

```ts
class ConfigForms extends Service {
  get(entryId: string): ConfigForm
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void
  ): () => void
}
```

`whileServed` 的语义是：**当描述镜像中出现指定 namespace 时执行注册，namespace 消失时执行 disposer**。

由此得到三条硬判据：

1. 触发条件是 Settings 命名空间被提供，**不是**插件是否安装，**不是** Cordis 插件名，**不是** 插槽 spec 是否存在。
2. namespace 由别的插件拥有时也能工作（设计意图就是让「编辑他人命名空间的页面」按需出现）。
3. 宿主从未提供该 namespace 时，注册回调永不执行，界面完全不出现，且没有任何报错。

## 四、最关键的一条：ConfigForms 只能写 volatile 字段

Settings 域的写入实现有两道硬门槛（以当前版本源码为准）：

```js
async write(ns, change, expected, paths = []) {
  const form = volatileForm(schema)
  if (form === void 0) throw new Error(`has no volatile fields`)
  for (const path of paths) {
    if (path.length && !isVolatilePath(schema, path)) {
      throw new Error(`Config field is not volatile`)
    }
  }
  ... strip(value, node, path) {
  ...   if (isVolatilePath(schema, path)) return {}   // volatile 不落盘
  ... }
}
```

而 volatile 的定义是「由宿主运行时自己更新的引用」：

```js
function createVolatile(value) {
  return Object.freeze({ get: () => current, [write]: (v) => { current = v } })
}
```

由此得到不可回避的推论：

| 字段类型 | 可被 ConfigForms 写入 | 是否落盘 |
|---|---|---|
| volatile | 是 | 否，进程内活值 |
| 非 volatile | 否，抛错 | 是 |

所以：

- **持久化配置不能走 ConfigForms 写入。** 强行接上后卡片能显示，但点击写入会抛 `has no volatile fields`。
- 把持久化字段改成 volatile 会让用户配置在进程重启后丢失。
- 运行时推导值（诊断链、生效来源、优先级判定、实时统计）本质上不是配置，更不能进 Settings。

## 五、参考实现的完整接线

```js
// 客户端静态注入只声明必需服务
module.exports = { name: '<pkg>', inject: ['slots', 'locale'], apply }

function apply(ctx) {
  // 可选服务一律动态获取并在回调内判空
  ctx.inject(['settingsScope'], (raw) => {
    const binder = raw.settingsScope
    if (binder === undefined) return
    c.effect(() => settings.attach(binder.bind({ namespace: NS })))
    c.slots.inject('settings.plugin.item', () =>
      c.slots.register({ name: 'settings.plugin.item', key: NS, locale: NS, inject: cardFace }, LegacyCard))
  })

  ctx.inject(['configForms'], (raw) => {
    const forms = raw.configForms
    if (forms === undefined
        || typeof forms.get !== 'function'
        || typeof forms.whileServed !== 'function') return
    c.effect(() => settings.attach(forms.get(NS)), 'config forms')
    c.effect(() => forms.whileServed([NS], () =>
      c.slots.inject('plugins.bundle.config', () =>
        c.slots.register({ name: 'plugins.bundle.config', key: PKG, locale: NS, inject: cardFace }, PluginCard)),
    ), 'plugins-page card')
  })
}
```

两个易错点：

- 把 `configForms` 从 `ctx.inject` 挪进静态 `inject` 数组，会把「服务不存在就静默跳过」变成「服务不存在则 apply 不生效」。
- 只搬 `whileServed` 外壳而不搬 `forms.get(ns)` 与 `cardFace`，等于把「有数据面的卡片」降级成「空壳卡片」。

## 六、数据性质与实现路径对照表

先给每个字段定性，再选实现路径。这一步做错，后面全是返工。

| 数据性质 | 例子 | 应走路径 |
|---|---|---|
| 持久化用户配置 | 默认档、启停开关 | 自有存储（文件 / localStorage / Settings 非 volatile 落盘路径） |
| 进程内运行时偏好 | 展开/折叠、临时选择 | Settings volatile 字段 |
| 运行时推导值 | 生效来源、优先级链、实时统计 | 只读接口，读取时计算，不落盘 |
| 动作 | 重置、重新载入、清空 | 命令式接口，返回最新状态 |

同一张卡片同时消费多类数据是正常的：写入走 Settings，读取与动作走自有接口。判据是「用户可感知的一致性」，不是「数据源是否统一」。

## 七、迁移前必答的五个问题

1. 这个字段是持久化还是进程内？依据是什么（重启后是否需要保留）？
2. 若走 ConfigForms，它能否被标为 volatile 而不丢用户数据？不能则走自有存储。
3. 卡片需要哪几类数据？把每类归到上表某一行。
4. namespace 字符串在哪几处出现？能否保证三方法（宿主注册、浏览器表单、插槽 key）完全一致？
5. 卸载时谁负责清理？宿主命名空间消失后 `whileServed` 会调 disposer；自有存储路径需要自己的 disposer。

## 八、验收判据

界面「构建通过」不等于「界面可用」。必须逐条证明：

1. 静态断言：客户端产物里只有允许的插槽名，且配置卡 key 与声明一致。
2. 服务断言：宿主命名空间注册存在，且运行时能读到该 namespace。
3. 生命周期断言：断开命名空间后卡片消失；恢复后卡片回来。
4. 写入断言：真实点击一次写入，**回读持久层**确认落盘，不能只看 UI 变化。
5. 重启断言：重启宿主后配置仍然生效（volatile 字段会在这里露馅）。
6. 冲突断言：两个页面同时改同一配置，验证 revision 冲突处理。

第 5 条与第 6 条是 Settings 与自有存储的真正分界线：前者天然具备，后者在自有路径上通常缺失。

## 相关文档

- [settings-and-plugin-ui.md](./settings-and-plugin-ui.md)：设置窗口 Tab 与插件管理中心元数据契约。
- [client-ui-placement-and-verification.md](./client-ui-placement-and-verification.md)：插槽静默失效三分法与真机取证。
- [web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)：插槽树、主题变量与国际化。
- [silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)：零报错失效的根因分类与门禁设计。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/settings/settings  <-  @deepseek-ai/dsh-settings@0.2.0-rc.2
packages/boot/config-editor  <-  @deepseek-ai/dsh-config-editor@0.2.0-rc.2
packages/client/ui-slots  <-  @deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2
packages/client/ui-plugin-manager  <-  @deepseek-ai/dsh-client-ui-plugin-manager@0.2.0-rc.2
packages/boot/app-boot  <-  @deepseek-ai/dsh-app-boot@0.2.0-rc.2
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@0.2.0-rc.2
```
