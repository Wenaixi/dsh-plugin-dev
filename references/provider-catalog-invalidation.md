# 技能目录/注册表失效链路：invalidate 的正确姿势与两大反模式

> 适用于：自定义 SkillProvider 插件、管理 skill 候选集、目录扫描型 provider。具体方法和缓存行为以目标安装物的 `@deepseek-ai/dsh-skill` 实现为准。

## 一、先建立事实：`skills/change` 是什么

`ctx.skills` 是分层注册表（`SkillRegistry`）。它对以下三类事件统一走一条链路：

1. **provider 注册/注销**（`ScopedLayers.effect` 的 onChange）；
2. **目录/文件变化**（`dsh-skill-filesystem` 的 chokidar watcher 或 `fs/observed` 工具落盘）→ provider 自调 `control.invalidate()`；
3. **stale definition load**（`get()` 读到名字不符的条目）。

链路（源码级）：`invalidateCache()` → `revision += 1` + `collectCache.clear()` + **`notifyChange()`** → `dispatch("emit", ["skills/change"])`。

```js
// dsh-skill/lib/index.js（节选）
invalidateCache() {
  this.revision += 1;
  this.collectCache.clear();
  this.notifyChange();
}
notifyChange() {
  for (const callback of this.ctx.events.dispatch("emit", ["skills/change"])) try {
    const returned = callback();
    Promise.resolve(returned).catch(...);
  } catch (e) { ... }
}
```

**含义**：`skills/change` 可作为注册表变更后的**消费方通知缝**。提供者不应在该事件监听器中反向调用 `control.invalidate()`；官方树是否存在订阅者、哪些消费方订阅以及刷新策略，都必须按目标版本和 profile 实际检查。

## 二、反模式 1：在 `skills/change` 监听器里调 `control.invalidate()` —— 同步递归栈溢出

```js
// ❌ 错误：监听器内反向 invalidate
ctx.on('skills/change', () => {
  providerControl.invalidate();  // invalidateCache → notifyChange → 再次 emit → 再进监听器 → …
});
```

执行链：监听器调 `invalidate()` → `invalidateCache()`（`revision+1` + cache 清空 + `notifyChange()`）→ **再次 emit `skills/change`** → 再进监听器 → 同步无限递归 → `RangeError`。

`invalidate` 的守卫**只查「注册是否还存活」**，不抑制重入广播——防不住这条链。

**判定动作**：先 grep 官方 `dsh-skill` 的 `notifyChange()` 调用点，确认事件链再决定要不要订阅；把「反向调 invalidate」写进反向断言门禁（出现即 FAIL）。

## 三、反模式 2：provider 实例没被捕获 —— invalidate() 空转（静默失效）

```ts
// ❌ 错误：工厂返回值被丢弃，providerInstance 永远是 null
let providerInstance: Provider | null = null
ctx.skills.registerProvider((control) => new MyProvider(ctx, control, opts))  // 没赋回
// 后面某外部函数调 invalidate() 时，if (providerInstance) 恒为 false → 空操作（示例名；官方 API 是 control.invalidate() / registry.invalidateCache()）
```

`registerProvider(create)` 的 `create(control)` 是**同步工厂**，返回值就是 provider。**需要在 provider 外部触发失效时，必须在工厂内把它存进闭包变量（provider 内部变更点直接持 control 即可）**：

```ts
// ✅ 正确：捕获实例，UI 变更点直调
let providerInstance: MyProvider | null = null
ctx.skills.registerProvider((control) => {
  providerInstance = new MyProvider(ctx, control, opts)
  return providerInstance
})

// 任何影响候选集的变更点（用户改配置、UI 开关、重置）直调：
providerInstance?.invalidate()
```

**症状**：UI 改了配置（禁用技能/开关），模型侧目录摘要缓存 stale、表现「没反应」且零报错——典型的代码没被执行 / 契约被吞静默失效。

**判定**：grep 实例变量全部出现点，确认有赋值点；或直接单测（绕过 apply 构造 provider 后调 `invalidate()` 断言 `control.invalidate` 被调用）。

## 四、正确姿势

1. **提供者是 emit 源，不是消费方**：目录变更由 filesystem provider 自调 `control.invalidate()`（chokidar / `fs/observed`），注册表再广播给消费方。你的 provider 要做的是**在自己管的数据变更点直调 invalidate()**。
2. **你的 skillDir 变更可能永远不会触发 `skills/change`**：filesystem provider 的观察 roots 是 project `.dsh/skills`、`.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`、`customSkillDirs`、bundledSkillDir——插件包内 `../skills` 一般不在其中。别赌事件。
3. **list() 实时扫描无缓存时**（每次调用重新 readdir + 解析 frontmatter），invalidate 的收益有限；但 UI 侧「让模型目录立即刷新」仍需要它。
4. **未来真要热改**：把目录纳入 filesystem provider 的 `customSkillDirs`（宿主侧配置）复用其 chokidar，而不是自建 watcher 或订阅广播。

## 五、一句话清单

- `skills/change` = 消费方通知缝，提供者订阅它反向 invalidate = 同步递归栈溢出。
- `registerProvider` 工厂返回值必须捕获到闭包变量，否则 invalidate 空转。
- 提供者在自身数据变更点调用 `control.invalidate()`；具体控制对象与缓存行为以目标版本实现为准。
- 每条新断言做破坏实测：人为制造反模式，确认门禁变红，再还原。
