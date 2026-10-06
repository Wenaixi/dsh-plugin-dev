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

## 相关 DSH 源码

```text
packages/client/ui-primitives  <-  @deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2
  src/settings-form/SettingsForm.tsx / form-model.ts / fields.tsx
packages/client/ui-settings   <-  @deepseek-ai/dsh-client-ui-settings@0.2.0-rc.2
  lib/types/client/config-form*.d.ts（ConfigForm / ConfigFormSnapshot）
packages/client/ui-settings-subagent  <-  官方 bool/枚举控制器范本（subagent-model-selection-card-controller）
packages/client/ui-settings-shell     <-  官方 SettingsFormModel 用法范本
```
