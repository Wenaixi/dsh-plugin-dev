# 官方 SettingsForm 体系：设置页外壳、草稿模型与冲突栅栏

> 适用范围：任何带配置界面的 DSH 插件（`plugins.bundle.config` / `settings.section` / 自有设置页）的 UI 层实现。
> 核心命题：**别手写设置页外壳与「点一下写一次」的即时保存。** DSH 官方提供了一整套设置表单体系，外壳、草稿、保存、冲突保护全部内建；只有开关与带说明的单选需要你自写一层薄薄的控制器。

---

## 零、先说结论：怎么选

| 你的字段类型 | 官方有什么 | 你要写什么 |
| --- | --- | --- |
| 文本 / 数字字段 | `SettingsFormModel` + `settingsTextField` / `settingsNumberField` | 只接线 |
| 开关（bool） | 只有 `Switch` 原子组件 | 自写 card controller（见 §四） |
| 枚举单选（带逐项说明） | 没有对应控件（`SegmentedControl` 不承载说明文字） | 自写控件 + 自写 card controller |

**官方 `SettingsFormModel` 只服务文本与数字字段**（`packages/client/ui-primitives` 的 settings-form）。bool 和枚举没有对应的 field spec，硬塞进去只会写出不可读的文本化表示。开关/枚举的正确形态是：官方 `SettingsForm` 外壳 + 自写 controller 产出官方要求的 `SettingsFormShell`。

官方自己的插件也是这样做的：`dsh-client-ui-settings-shell`（两个数字字段）用 `SettingsFormModel`；`dsh-client-ui-settings-subagent`（开关 + 模型多选）自写 controller。**以官方插件为模板，不要发明新模式。**

---

## 一、官方 SettingsForm 外壳（一切从这里开始）

`SettingsForm`（`@deepseek-ai/dsh-client-ui-primitives`）负责整个表单框架：

- `labels`：五个文案——`unavailable`（命名空间未服务）、`readOnly`（文档只读）、`saveFailed`、`save`、`saving`。文案由你从自己的 locale 词典取词传入。
- `state`：`SettingsFormShell`——`available` / `writable` / `dirty` / `invalid` / `saving` / `failed`。
- `onSave` / `onDiscard`：保存与丢弃动作。

它替你做了的事（不要重造）：

- 命名空间未服务时显示 `unavailable` 一行，**不渲染任何控件**；
- 文档只读时显示只读横幅；
- 保存失败时显示 `saveFailed`；
- `dirty` 为假、`invalid` 为真、或 `saving` 中，**自动禁用 Save 按钮**；
- 卸载（unmount）时自动调用 `onDiscard`——「离开即丢弃草稿」不用你写。

源码位置（0.2.0-rc.2）：`packages/client/ui-primitives/src/settings-form/SettingsForm.tsx`。`SettingsFormShell` 类型在同目录 `form-model.ts`。

**文案键别自创**：unavailable / readOnly / saveFailed / save / saving 的对仗句式官方插件（settings-shell、settings-subagent）已固定，直接抄它们的字典措辞，不要发明自己的变体。

---

## 二、官方 SettingsFormModel：边界要记死

```ts
new SettingsFormModel(scope, [
  settingsNumberField("timeoutMs"),
  settingsTextField("maxOutputBytes"),
])
```

- 每个 field spec：`field` 名 + `format(value) -> draft text` + `parse(text) -> write | undefined`。
- 空草稿 = 清字段（unset 回组合层）；解析不了的草稿返回 undefined → 表单 invalid → Save 被禁。
- 它产出：`shell()`（SettingsFormShell）、`field(name)`（某字段的 draft 状态）、`actions()`（edit/resetField/save/discard）、`bind(project)`（快照 store）。

**只用它服务文本/数字。** bool 与枚举字段没有合法文本表示，不要用 `settingsTextField` 把 true/false 变成字符串再解析——那是给用户看「true/false」的可读性灾难。

---

## 三、scope 从哪来：ConfigForm 与 SettingsFormScope 是同形契约

`SettingsFormModel` 的构造参数叫 `SettingsFormScope`（getSnapshot / subscribe / mutate(ops, expectedRevision)）。而浏览器侧 `configForms.get(ns)` 返回的 `ConfigForm`（`@deepseek-ai/dsh-client-ui-settings/client`）**恰好就是这个形状**：

```ts
form.getSnapshot()                       // { status, value, base, user, revision, writable, mode }
form.subscribe(listener)                 // -> disposer
form.mutate(ops, expectedRevision?)      // -> Promise<boolean>
```

所以官方插件直接把 `configForms.get(ns)` 传给 `SettingsFormModel`。**自写 controller 时同样把 `ConfigForm` 当 scope 用**——不要自己包一层转发，直接消费。

`ConfigFormSnapshot` 与 `SettingsFormScopeSnapshot` 字段几乎一一对应，差异只有命名：`value` / `base` / `user` / `revision` / `writable` / `status`。写 controller 时按 `ConfigFormSnapshot` 读即可。

---

## 四、自写 card controller（bool / 枚举的标准形态）

形态抄官方 `dsh-client-ui-settings-subagent` 的 `SubagentModelSelectionCardController`（client.js 的 subagent-model-selection-card-controller.js 段）。骨架：

```ts
class CardController {
  private scope                 // ConfigForm / SettingsFormScope
  private draft: Values | undefined        // 编辑中的草稿；undefined = 展示宿主当前值
  private draftRevision: number | undefined // 建草稿时的 revision，保存时作 expectedRevision
  private saving = false
  private failed = false
  private conflicted = false
  private generation = 0                    // 代际计数：dispose 后抑制迟到回执
  private unsubscribe

  constructor(scope) {
    this.unsubscribe = scope.subscribe(() => {
      this.detectConflict()   // revision 前进且草稿未过期 -> 冲突
      this.publish()
    })
  }

  edit(field, next) {         // 只改草稿，不写宿主
    if (scope.getSnapshot().status !== 'ready' || !writable || this.saving) return
    this.beginDraft()
    this.draft = { ...this.draft, [field]: next }
    this.publish()
  }

  async save() {
    const snapshot = this.scope.getSnapshot()
    // 1) 冲突栅栏：草稿期间文档被别处改过且草稿未过期 -> 拒绝保存
    if (this.draftRevision !== undefined && snapshot.revision !== this.draftRevision) {
      this.conflicted = true; this.publish(); return
    }
    // 2) 只写差异字段
    const ops = diffOps(draft, currentValue(snapshot))
    // 3) 代际 + 写 + 回读逐字段比对
    const gen = this.generation
    this.saving = true; this.publish()
    const accepted = await this.scope.mutate(ops, this.draftRevision)
    if (gen !== this.generation) return           // 已 dispose：抑制迟到回执
    this.saving = false
    this.failed = !accepted || !equal(currentValue(scope.getSnapshot()), draft)
    if (!this.failed) this.clearDraft()           // 落盘成功才清草稿；失败保留供修正
    this.publish()
  }

  dispose() { this.generation += 1; this.unsubscribe() }
}
```

五条铁律（每条都有实测出处）：

1. **冲突时把 `invalid` 置 true**——`SettingsForm` 会因此自动禁用 Save，防止覆盖他人改动。不要只弹提示。
2. **保存回读逐字段比对确认落盘**，不能只信 `mutate` 的返回值——宿主把答案折进镜像后，`getSnapshot().value` 就是真值，逐字段相等才清草稿。
3. **`saveGeneration` 代际计数**：dispose 后任何迟到的 mutate 回执必须静默丢弃，否则卸载后还改状态。
4. **草稿过期判定**：revision 变了但草稿内容与当前值逐字段相等 → 直接清草稿（不冲突）；不等 → 冲突。等于用户「白改了」和「改了但别人也改了」的区别。
5. **草稿与当前值一致时保存是 no-op**：清草稿即可，不触发 mutate。

`dirty` 投影：`draft !== undefined && !prefsEqual(draft, current)`。`values` 投影：`draft ?? current`（无草稿时展示宿主当前值）。

---

## 五、把 controller 接进插槽

```ts
// inject 面：hooks 放快照 store，动作平铺
inject() {
  return {
    hooks: { prefsCard: this.store },   // 渲染器把 hooks 映射成 usePrefsCard 选择器钩子
    edit: (f, v) => this.edit(f, v),
    save: () => this.save(),
    discard: () => this.discard(),
  }
}

// 注册
ctx.slots.register(
  { name: 'plugins.bundle.config', key: '<包名>', locale: NS, inject: () => controller.inject() },
  CardComponent,
)
```

组件侧：`const snap = props.usePrefsCard(s => s)`；`snap.values` 渲染控件值，`snap` 直接当 `SettingsForm` 的 `state`。

快照 store 用 `createSnapshotStore`（`@deepseek-ai/dsh-client-store`）或自写 `getSnapshot/subscribe/set` 三件套都行——slots 的 `hooks` 契约只要求 `HostObservable`（getSnapshot + subscribe），`set` 只是你发布新快照的途径。

---

## 六、验收判据（六条，逐条可复现）

1. **静态断言**：产物里只有允许的插槽名，配置卡 key 与包名一致（见 client-ui-placement-and-verification 的 configured 渲染门）。
2. **写入断言**：改一个字段 → Save → 回读 `settings/describe` 与磁盘补丁，逐字段一致。
3. **冲突断言**：草稿打开着，另一处把同一命名空间改掉（revision+1）→ 点 Save → 保存被拒、显示冲突、不覆盖。
4. **重启断言**：保存后完全重启宿主，配置仍生效。
5. **只读断言**：文档只读时显示官方只读横幅，控件全禁，Save 禁用。
6. **卸载断言**：禁用插件后配置卡与命名空间一起消失，无残影。

7. **热更新自愈断言**：插件卸载后重新安装（或热更新后），若前端页面未刷新，组件如仍持有旧表单引用，应有显式失败感知并能引导刷新，刷新后新表单实例应完全恢复可读可写。

---

## 七、ConfigFormController 生命周期陷阱：热重载失效、whileServed 守卫与写入队列截断

### 7.1 表单控制器的生命周期与 disposed 标志

DSH 客户端通过 `ctx.configForms.get(namespace)` 获取的表单控制器对象（`ConfigFormController`）拥有严格的生命周期状态：

```javascript
// 官方 dsh-client-ui-settings 源码行为
enqueue(operation) {
    if (this.persistence === "memory" || this.disposed) return Promise.resolve(false);
    // ... 正常排队发起远程 RPC 写入
}

async dispose() {
    this.disposed = true;
    this.writeGeneration += 1;
    this.unsubscribe?.();
    await this.tail;
}
```

当插件在宿主侧被热卸载（remove/unload）时，宿主注销对应的 entry，客户端配置管理器会调用该表单的 `dispose()`，将其 `this.disposed` 置为 `true`。

### 7.2 热重载下的「假死短路」陷阱

- **现象**：插件通过界面或命令行热更新后，用户在尚未刷新的旧前端页面中点击开关或提交修改，完全无反应，后端未收到任何网络请求，磁盘配置文件未发生任何改变。
- **成因**：前端 SPA 页面若未重新加载，React 组件闭包中依然持有已被置为 `disposed=true` 的旧表单控制器实例。调用 `form.mutate(ops)` 时，底层的 `enqueue` 检查到 `this.disposed` 为真，**直接短路返回 `Promise.resolve(false)`**，连远程 RPC 请求都不会发出！
- **应对规范**：
  1. **检查返回值并暴露失败**：所有表单提交逻辑（例如封装的 `submit` 函数）不能假设 `form.mutate` 一定发送了请求，必须检查返回的 `ok / accepted` 结果。当返回 `false` 时，必须将其视同写入失败，在 UI 区域显式抛出提示；
  2. **感知生命周期**：对于挂载到全局插槽的持久化卡片，可参考官方插件的 `whileServed` 模式；
  3. **验收规程**：在端到端真机验收清单中，热重载后应包含页面重新加载重绑活跃表单的标准动作。

### 7.3 whileServed 命名空间状态守卫机制

官方多个设置卡片（如 agent-loop、shell、subagent）均采用 `ctx.configForms.whileServed` 守卫插槽注册：

```javascript
ctx.effect(() => ctx.configForms.whileServed([MY_NAMESPACE], (served) => {
    return ctx.slots.inject("plugins.item", () => ctx.slots.register({ ... }));
}));
```

- **运行原理**：`whileServed` 内部监听客户端的设置镜像快照（`SettingsDescribeMirror`）。只有当宿主当前真实服务的 `namespaces` 列表中包含指定命名空间时，才执行注册函数；一旦宿主卸载了该插件，它会自动触发注册时返回的清理函数（disposer），使配置项在界面上平滑退场，绝不残留未服务的死引用。

---

## 相关 DSH 源码

```text
packages/client/ui-primitives  <-  @deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2
  src/settings-form/SettingsForm.tsx / form-model.ts / fields.tsx
packages/client/ui-settings   <-  @deepseek-ai/dsh-client-ui-settings@0.2.0-rc.2
  lib/types/client/config-form*.d.ts（ConfigForm / ConfigFormSnapshot）
packages/client/ui-settings-subagent  <-  官方 bool/枚举控制器范本（subagent-model-selection-card-controller）
packages/client/ui-settings-shell     <-  官方 SettingsFormModel 用法范本
```
