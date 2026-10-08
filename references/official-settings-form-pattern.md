# 官方 SettingsForm 体系：设置页外壳、草稿模型与冲突栅栏

> 适用范围：任何带配置界面的 DSH 插件（`plugins.bundle.config` / `settings.section` / 自有设置页）的 UI 层实现。
> 核心命题：**别手写设置页外壳与「点一下写一次」的即时保存。** DSH 官方提供了一整套设置表单体系，外壳、草稿、保存、冲突保护全部内建；只有开关与带说明的单选需要你自写一层薄薄的控制器。
>
> 例外：**开关/单选这类无文本草稿的控件，也可以放弃草稿体系、走「操作即写」**（每个控件点击直接写宿主）。两者选型见 §八。

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

## 五之二、注入面的三个形状陷阱（组件看得见 ≠ 你以为它看得见）

注入面（`slots.register` 的 `inject` 字段）决定组件能拿到什么。这一节记三条会让「点一下毫无反应」「界面永久空白」或「键盘不可达」的形状错误。

### 5.2.1 注入面顶层是工厂函数，不是对象

`inject` 接受的是**函数**，渲染器在渲染时才调用它、拿到返回的 props。把面写成本身是对象不会立刻报错，`undefined` 会在更下游才炸。

```javascript
// 对：面顶层是工厂，渲染时产出 props
inject() {
  return {
    hooks: { myCard: this.store },        // 值是 store：渲染器直接绑成 useMyCard 选择器钩子
    edit: (field, value) => this.edit(field, value),
  };
}

// 错：把工厂调用提前到注册期（此刻 store 还没建好，且早于渲染）
inject: this.storeSnapshot           // 不是工厂，是快照本身
```

`hooks` 的值有两种形态，渲染器按「是不是函数」分流：值是 store 就直接绑定；**值是函数则当成延后工厂**，到渲染那一刻才调用（源码里 `typeof definition === "function"` 这个分流点）。所以需要「每次渲染拿到最新 store」时，把工厂放进 `hooks` 里是合法的。

### 5.2.2 闭包变量不会自动出现在 props 上

最容易踩的一种：注册时用 `slots.register({ ..., inject: () => ({ hooks: { s: store } }) }, Panel)`，而 `Panel` 里读 `props.scope.mutate(...)`。`scope` 是 apply 里的闭包变量，**从来没有被放进面里**，于是 `props.scope` 是 `undefined`，点击时抛 `TypeError: Cannot read properties of undefined`。

- **症状**：控件能点、没有任何报错文案、界面随后卡住（渲染树被异常打断）。
- **规矩**：组件只能消费 props。凡是它要用的东西，写操作的函数也要一并平铺进面里（`mutate: (ops, rev) => scope.mutate(ops, rev)`），不要指望闭包变量能穿透到组件。
- **自查**：面板里出现的每个 `props.X`，回到注册处确认面里真的有 `X`；反向也查一遍——面里有、面板没用的是死代码。

### 5.2.3 钩子的命名与签名由渲染器决定

- `face.hooks` 的每个键 `name` 会被转成 `use<Name>`（首字母大写）交给组件；
- 钩子的签名是**选择器**：`(selector, equal?) => 选中值`，不是「无参返回整快照」。`props.useMyCard(s => s)` 取整个快照，`props.useMyCard(s => s.value)` 只订阅其中一个字段（少写字段能显著减少重渲染）。

## 六、验收判据（逐条可复现）

1. **静态断言**：产物里只有允许的插槽名，配置卡 key 与包名一致（见 client-ui-placement-and-verification 的 configured 渲染门）。
2. **写入断言**：改一个字段 → Save → 回读 `settings/describe` 与磁盘补丁，逐字段一致。
3. **冲突断言**：草稿打开着，另一处把同一命名空间改掉（revision+1）→ 点 Save → 保存被拒、显示冲突、不覆盖。
4. **重启断言**：保存后完全重启宿主，配置仍生效。
5. **只读断言**：文档只读时显示官方只读横幅，控件全禁，Save 禁用。
6. **卸载断言**：禁用插件后配置卡与命名空间一起消失，无残影。

7. **热更新自愈断言**：插件卸载后重新安装（或热更新后），若前端页面未刷新，组件如仍持有旧表单引用，应有显式失败感知并能引导刷新，刷新后新表单实例应完全恢复可读可写。
8. **闸门断言**：人为让提交批次里一条 op 指向非 volatile 字段，观察到整批零写入且界面提示保存失败。这一条只在真机可测，它验证的是宿主写入闸门的真实行为，不是你的代码路径。完整清单见 [host-semantic-gates.md](./host-semantic-gates.md)。
9. **旧字段收敛断言**：带旧格式配置启动，触发任意一次写入后回读，旧键已消失且新键已落盘。迁移写法见 [config-field-lifecycle.md](./config-field-lifecycle.md)。
10. **操作即写接入断言**：点一个开关 → 不点任何保存 → 回读 `settings/describe` 的命名空间 `value` 已变；再回读磁盘补丁一致。每类控件（开关、单选、恢复默认）各验一条。恢复默认的期望值取 schema 默认值（与磁盘补丁 `base` 层一致），不是猜测。

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

19. **操作即写接入断言**：点一个开关 → 不点任何保存 → 回读 `settings/describe` 的命名空间 `value` 已变；再回读磁盘补丁一致。每类控件（开关、单选、恢复默认）各验一条。恢复默认的期望值取 schema 默认值（与磁盘补丁 `base` 层一致），不是猜测。

---

## 八、操作即写模式：开关/单选控件不套草稿

需求是「改动立即生效、不要保存按钮」时（开关、单选这类无文本草稿、点一下就是一个完整值的控件），可以不套官方草稿外壳，控制器改为直写：

### 8.1 什么时候选这个模式

| 判据 | 草稿 + 保存 | 操作即写 |
| --- | --- | --- |
| 字段类型 | 文本/数字（草稿有中间态） | 开关/单选（点击即完整值，无中间态） |
| 用户心智 | 批量改完再提交 | 点一下就是最终值（终端工具类偏好） |
| 冲突风险 | 草稿期被别处改掉 → 保存被拒 | 无草稿 → 每次写都基于最新 revision，天然无冲突窗口 |
| 失败恢复 | 保留草稿供修改 | 宿主镜像 `recover` 重读回滚，UI 值自动回落到真值 |

写错了「点一下写一次」= 重造轮子；写对了「操作即写」= 文本/数字以外控件的合理取舍。

### 8.2 控制器骨架：宿主快照读出 + 每次操作一个 mutate

```ts
class CardController {
  private scope                  // ConfigForm（同 SettingsFormScope 同形）
  private failed = false         // 最近一次写入是否未被接受
  private generation = 0         // dispose 后抑制迟到回执
  private unsubscribe

  constructor(scope) {
    this.unsubscribe = scope.subscribe(() => this.publish())
  }

  edit(field, next) {            // 立即写，不经过草稿
    if (this.scope.getSnapshot().status !== 'ready' || !this.scope.getSnapshot().writable) return
    this.failed = false
    this.publish()
    void this.write([{ op: 'set', path: [field], value: next }])
  }

  resetAll() {                   // 恢复默认：只写与当前值不同的字段
    const current = currentValue(this.scope.getSnapshot())
    void this.write(diffOps(DEFAULT, current))
  }

  async write(ops) {
    if (ops.length === 0) return
    const gen = this.generation
    let accepted
    try { accepted = await this.scope.mutate(ops) }   // 不传 expectedRevision：宿主用最新 revision
    catch { if (gen !== this.generation) return; this.failed = true; this.publish(); return }
    if (gen !== this.generation) return                // 已 dispose：丢弃迟到回执
    this.failed = !accepted
    this.publish()
  }

  dispose() { this.generation += 1; this.unsubscribe() }
}
```

快照投影：`values` 永远取**宿主当前值**（`currentValue(snapshot)`），不做本地乐观值——宿主 `acceptView` 折叠写入答案、`recover` 在拒绝后重读，快照本身就会回到真值，UI 不需要自己补偿。

### 8.3 四条要点（踩过才知道）

1. **失败只标 `failed`，不吞**：`mutate` 返回 false 或抛错都置 `failed`，UI 显式渲染保存失败提示。返回 false 与返回 true 都不告诉你失败发生在哪一层，判据是可观察的状态转移（失败提示可见、值回落到宿主真值）。
2. **连点不锁界面**：保存中不设 `saving` 锁（宿主写入队列串行 + revision 栅栏，最后操作胜出）；禁用条件只有 `!writable`。文本字段的草稿需要锁，开关/单选不需要。
3. **「保存」相关的能力面全部删除**：`save`/`discard` 动作、`saving` 状态、`dirty` 投影、`draftHint`（「改动会在点击保存后生效」）提示与 `save`/`saving`/冲突相关文案键一并删，删不干净会让界面出现永不触发的死按钮或自相矛盾的提示。
4. **恢复默认 = 写 schema 默认值**：`diffOps(DEFAULT, current)` 只写有差异的字段，与当前值全相等的默认恢复是 no-op（清 `failed` 即可）。

### 8.4 数据通路与验收

写入链路与草稿模式完全一致：`mutate(ops)` → `remote.settings` → 宿主配置控制器 → config-editor → 磁盘补丁。真值回读见 §六 第 10 条：点击后 describe 的 `value` 立即变化、磁盘补丁一致；失败时（人为制造拒写）显示失败提示且 `value` 回落到宿主真值，不显示本地乐观值。

---

## 九、批量操作的单次原子批处理（allOps）vs 并发 mutate 乐观锁竞争撕裂

在具有列表开关、多选配置或批量重置场景的面板中，处理批量变更存在一个极易踩入的工业级架构陷阱。

### 9.1 并发 mutate 的乐观锁撕裂（State Tearing）陷阱

- **反模式写法**：
  ```javascript
  // 危险：多项变更并发触发多次独立 mutate
  var work = Promise.all(names.map(function (name) {
    return form.mutate(switchOps(name, op));
  }));
  ```
- **宿主锁机制与冲突根因**：
  DSH 的 `ConfigFormController` 与宿主 `SettingsService` 严格维护单调递增的版本号（`revision`）作为乐观并发控制（OCC）。
  当并发发起 N 次 `form.mutate` 时，N 个请求在同一微秒到达宿主。第 1 个请求被宿主接受后，宿主磁盘与内存中的 `revision` 立即自增；其余并发请求携带的基线版本号瞬间过期，被宿主判定为版本冲突并直接短路返回 `accepted === false`！
- **后果与灾难表征**：
  界面上表现为**状态撕裂（State Tearing）**——前 1~2 个开关成功更新，后续的开关全部爆红报错；同时产生 N 次远程 RPC 往返、N 次磁盘 I/O 抖动与 N 次宿主全量快照重读广播。

### 9.2 宿主事务级原子批处理契约

DSH 官方 `ConfigForm.mutate(ops: PatchOperation[])` 接口原生接收一个操作数组：
- **事务级全量校验**：宿主配置闸门在处理一组 `ops` 时，会逐条校验其 `path` 是否全部落在对应 Schema 的 `volatile` 声明节点下。**任一条操作非法，整批操作立即被整体拒绝，零写入**；
- **单次原子提交**：全量校验通过后，宿主在单一事务内一次性提交草稿并持久化，`revision` 仅自增 1 次，广播仅触发 1 次。

### 9.3 客户端扁平拍平设计范式（Flattening Pattern）

无论当前用户操作的是单个条目还是批量条目，客户端提交前统一将其组装为一个扁平的操作数组，仅调用一次 `form.mutate(allOps)`：

```javascript
function buildSwitchOps(names, op) {
  var list = Array.isArray(names) ? names : [names];
  // 1. 批量生成目标字段的操作
  var ops = list.map(function (name) {
    return op === 'disable'
      ? { op: 'set', path: ['disabled', name], value: true }
      : { op: 'unset', path: ['disabled', name] };
  });
  // 2. 关联字段或历史废弃字段的清理：在末尾统一追加 1 次 unset，杜绝重复冗余
  LEGACY_FIELDS.forEach(function (field) {
    ops.push({ op: 'unset', path: [field] });
  });
  return ops;
}

function submit(form, t, names, op, setPending, setFailures, opsOverride) {
  // 设置 pending 忙碌态...
  var ops = opsOverride || buildSwitchOps(names, op);
  
  // 核心：单次原子批处理提交
  form.mutate(ops).then(function (accepted) {
    if (accepted === false) throw new Error(t('writeFailed'));
    setFailures(clear);
  }).catch(function (error) {
    // 铁律：防静默失败必须输出原生控制台堆栈
    console.error('[plugin-name] form.mutate failed:', error);
    setFailures(function (prev) {
      var next = clear(prev);
      var message = t('writeFailed') + ': ' + String(error?.message || error);
      names.forEach(function (name) { next[name] = message; });
      return next;
    });
  }).finally(function () {
    setPending(clear);
  });
}
```

### 9.4 核心收益
1. **彻底消除乐观锁竞态**：1 次往返，版本锁递增 1 次，绝无并发冲突；
2. **状态完全一致**：全成功或全失败，失败时统一回退至宿主快照真值，彻底避免局部更新撕裂；
3. **RPC 负载大幅压降**：历史废弃字段去重后，批量更新 15 项时的 payload 从 45 条操作压减至 17 条操作，网络和 I/O 耗时降低 70% 以上。

---

## 相关 DSH 源码

```text
packages/client/ui-primitives  <-  @deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2
  src/settings-form/SettingsForm.tsx / form-model.ts / fields.tsx
packages/client/ui-settings   <-  @deepseek-ai/dsh-client-ui-settings@0.2.0-rc.2
  lib/types/client/config-form*.d.ts（ConfigForm / ConfigFormSnapshot）
packages/client/ui-renderer  <-  @deepseek-ai/dsh-client-ui-renderer@0.2.0-rc.2
  lib/client.js（bindInjectSources：hooks 键转 use<Name>、bindSnapshotSelector：选择器签名）
packages/client/ui-slots    <-  @deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2
  lib/index.js（standardHookPropName：use<Name> 命名规则）
packages/client/ui-settings-subagent  <-  官方 bool/枚举控制器范本（subagent-model-selection-card-controller）
packages/client/ui-settings-shell     <-  官方 SettingsFormModel 用法范本
```
