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

## 五、宿主跨 Fiber 全局配置变更（如界面语言）的收敛点：`app-boot/config-reload`

### 5.1 跨插件 Fiber 事件隔离的致命盲区

在 DSH 架构中，宿主级配置（如 `dsh-client-locale` 的 `locale.preference`）属于其他独立插件的 Fiber。
Cordis 微内核规范严格规定：**`loader/volatile-update` 只在待更新字段所属插件自身的 Fiber 上定向广播，本插件的 Fiber 完全收不到该事件！**

**典型翻车场景**：
- 插件的 `SkillProvider` 实现了「未配置语言时自动跟随宿主界面语言」，并在内存中缓存了探测结果（如 `hostLanguageCache`）；
- 插件仅在自身的 `loader/volatile-update`（本插件配置变动）中调用 `invalidate()` 清空该缓存；
- 当用户在 DSH 设置中将界面语言从中文切换为英文时，由于 `locale` 的 volatile 更新事件不跨 Fiber 广播，本插件的缓存**永久停留在旧值**；
- 形成严重缺陷：宿主界面明明切成了英文，模型目录和斜杠唤出菜单中的技能介绍却死锁在中文，直到插件重启！

### 5.2 唯一通用收敛点：`app-boot/config-reload`

宿主在每次应用用户配置补丁（包括在设置中修改界面语言）后，会向全局广播 `app-boot/config-reload` 事件（`dsh-app-boot/lib/index.js`）。
所有需要动态跟随宿主级配置的插件，必须在该事件监听器中触发自身 Provider 的缓存与编目失效：

```typescript
// ✅ 正确：监听宿主全局补丁重载事件，收敛跨 Fiber 配置变更
ctx.on('app-boot/config-reload', () => {
  ctx.logger.debug('[plugin] host config reloaded, invalidating catalog cache')
  activeProvider?.invalidate() // 内部清空 hostLanguageCache 与目录快照
})
```

---

## 六、目录与文件扫描的 In-Flight 并发重入屏障（`scanPromise` 栅栏）

### 6.1 并发重入导致的内存状态损坏

异步目录扫描函数（如 `scan()`）通常包含遍历目录、读取文件属性、解析 Markdown frontmatter 等多步异步 I/O。
当遇到以下场景时，极易发生并发重入调用：
1. 多个会话或多子代理（Agent Teams）同时并行触发 `list()` 或 `get()`；
2. 宿主刚启动时同时进行工具注册和目录发现。

**破坏时序**：
- 任务 A 开始执行 `scan()`，读取了文件列表，开始逐个解析条目并写入 `this.entriesByName`；
- 任务 B 进入，若代码在开头直接调用 `this.entriesByName.clear()`，**任务 A 已经辛苦解析并写入到一半的 Map 被瞬间抹除！**
- 两个任务交替向同一个 Map 写入未解析完的对象，甚至因键已存在而错误判定为「技能重名（duplicate）」，发出虚假警告并导致真实技能从目录中被永久遗漏！

### 6.2 通用解决方案：In-Flight 任务合并屏障

在类内部持有一个进行中的 Promise 引用。一旦检测到已有任务正在扫描，后续并发请求直接 await 复用同一个 Promise，绝不重入：

```typescript
export class SkillCatalog {
  private scanPromise: Promise<void> | null = null

  async scan(options?: Options): Promise<void> {
    // 并发合并：已有扫描正在进行时直接复用，杜绝多次重入相互抹除
    if (this.scanPromise !== null) return this.scanPromise

    this.scanPromise = this.#scanInternal(options).finally(() => {
      this.scanPromise = null
    })
    return this.scanPromise
  }

  async #scanInternal(options?: Options): Promise<void> {
    // 真正的单任务扫描逻辑：重置 Map、遍历、解析、写入指纹...
  }

  invalidate(): void {
    this.scanPromise = null
    this.entriesByName.clear()
    // ...
  }
}
```

---

## 七、呈现投影变更与物理文件变更解耦（零磁盘 I/O 刷新）

### 7.1 现象与开销

在支持中英多语言或多种呈现视图的插件中，内存中的模型对象（如 `SkillDocument`）通常在单次读取时就已经完整解析并持有了全部语言字段（如英文 `description` 与中文 `description_zh`）。

如果将「语言偏好改变」简单粗暴地当作「需要全量重新读盘扫描」：
- 用户在界面每次点一下语言切换，磁盘就要全量遍历目录并重新把所有 `SKILL.md` 解析一遍；
- 不仅造成了无意义的高延迟和磁盘 I/O，还增加了触发文件锁竞争的风险。

### 7.2 正确姿势：双重失效判断

将**物理文件变动（需读盘）**与**呈现投影变动（仅需内存重映射）**彻底解耦：

```typescript
async listCandidates(provider: string, rank: number, options?: { language?: 'zh' | 'en' }) {
  const language = options?.language === 'en' ? 'en' : 'zh'
  const needsRebuild = this.lastScanLanguage !== language
  const needsDiskScan =
    this.cachedCandidates === null ||
    this.lastScanProvider !== provider ||
    (await this.isDirModified()) // 基于 mtime 三键指纹的物理变动探测

  // 只有物理文件真的变了，才付磁盘 I/O 成本重新扫描
  if (needsDiskScan) {
    await this.scan(options)
  }

  // 物理变动或纯语言切换时，直接复用内存 Map 重新映射 Candidate 投影
  if (needsDiskScan || needsRebuild) {
    const list = []
    for (const entry of this.entriesByName.values()) {
      list.push(entry.document.toCandidate(provider, rank, language))
    }
    this.cachedCandidates = Object.freeze(list)
    this.lastScanLanguage = language
  }

  return this.cachedCandidates!
}
```

这样在语言切换时，完全免除磁盘 I/O，快照在微秒级完成重组并返回。

---

## 八、冷热读取一致性与作用域透传（Consistency Bug）

在设计具备内存快照与按需自愈加载的 Provider 时，存在一个极隐蔽的语言与维度撕裂陷阱：

### 8.1 陷阱成因：未命中分支参数漏传
在实现 `get(candidate, options)` 契约方法时：
- **热路径（快照命中）**：从内存 Map 命中条目，根据 `options` 传入的呈现维度（如 `language` 或 `scope`）进行投影：
  `return cached.document.toDefinition(providerName, language);`
- **冷路径（快照未命中或名称漂移自愈）**：从磁盘重新读取解析出文档对象后，代码漏传了呈现参数：
  `return doc.toDefinition(providerName); // ❌ 漏掉了 language 参数！`

### 8.2 破坏表征：冷热双重标准
由于契约对象的转换方法通常在参数缺失时回退到默认语言或默认投影：
- 当用户配置了非默认维度（如中文描述）时，命中缓存返回的是中文；
- 一旦发生自愈重读或缓存失效，返回的意外变成了英文！
- 导致“命中缓存与冷读取表现完全不一致”的偶发性严重缺陷。

### 8.3 规避铁律：管道同构与安全归一化
1. **入口统一归一化**：在 `get` 方法开头对外部入参做安全默认值折叠；
2. **分支同构调用**：无论走缓存命中分支还是自愈重读分支，调用下层契约转换方法时必须保证传参完全同构。

---

## 九、宿主缺省值（undefined）的缓存穿透与布尔探测标志位

### 9.1 陷阱成因：以 undefined 值为依据的缓存守卫
当插件需要向宿主全局设置服务探测当前环境（例如通过 `ctx.get('settings')?.describe()` 探测宿主界面语言或全局模式），并在内存中建立局部缓存以避免每轮高开销扫描时：
- 宿主在默认未配置状态下，探测计算出来的结果往往就是 `undefined`；
- 若代码采用常见的值守卫：
  ```typescript
  if (this.cachedLocale !== undefined) return this.cachedLocale;
  // ... 探测计算并赋值 this.cachedLocale = locale;
  return locale;
  ```

### 9.2 灾难表征：默认环境下的全量反射穿透
- 在宿主默认未配置环境下，`locale` 始终为 `undefined`，赋值后 `this.cachedLocale` 依然为 `undefined`；
- 下一次调用时，`if (this.cachedLocale !== undefined)` **恒为 false**！
- 导致缓存守卫在绝大多数默认用户的机器上形同虚设，后续每一次 `list()` 和每一次 `get()` 都全量穿透缓存，重复遍历宿主全部命名空间执行高开销的深拷贝与反射展开。

### 9.3 规避铁律：布尔标志位与生命周期闭环
必须引入独立的布尔标志位，显式区分“尚未探测”与“已探测完成但值为 undefined”：
```typescript
private localeProbed = false
private cachedLocale: 'zh' | 'en' | undefined

hostLocale(): 'zh' | 'en' | undefined {
  if (this.localeProbed) return this.cachedLocale
  let locale = computeHostLocale()
  this.cachedLocale = locale
  this.localeProbed = true // 标记已探测，即使为 undefined 也锁存
  return locale
}

invalidate(): void {
  this.cachedLocale = undefined
  this.localeProbed = false // 配置重载时同步复位
}
```

---

## 十、协作式取消信号（AbortSignal）在 I/O 异常块中的 rethrow 穿透规程

### 10.1 陷阱成因：无差别 catch 吞没取消异常
在文件系统变动探测函数（如 `isDirModified(signal)`）中：
- 内部虽然在文件遍历与 stat 处严谨调用了 `signal?.throwIfAborted()`；
- 但外层通常为了防范文件暂时不可读而使用了宽泛的异常捕获：
  ```typescript
  try {
    signal?.throwIfAborted();
    // ... 检查文件 mtime ...
    return false;
  } catch {
    return true; // ❌ 吞没了所有错误，误将取消判定为「需要重读」
  }
  ```

### 10.2 灾难表征：取消失效与无效重 I/O
当外部会话超时或用户取消操作时，`signal.throwIfAborted()` 正确抛出了 `AbortError`。但上述 catch 块盲目将该异常捕获并返回了 `true`。上层调用者接收到 `true` 后误以为文件已被修改，强行启动了昂贵的全量磁盘扫描（`scan()`），使得本已被取消的任务继续无谓消耗大量 I/O 和计算资源，取消信号彻底失效。

### 10.3 规避铁律：取消信号优先重抛
所有涉及变动探测与状态推导的 catch 块，必须优先检查取消状态：
```typescript
} catch (err: unknown) {
  if (signal?.aborted || (err as DOMException)?.name === 'AbortError') {
    throw err; // 取消信号必须畅通穿透，立刻中止调用链
  }
  return true; // 仅常规 I/O 错误才走回退分支
}
```

### 10.4 陷阱延伸一：遍历循环内无差别 catch 导致取消异常误分类为业务损坏
在遍历文件目录、多资产扫描或批量条目解析的循环体内：
```typescript
for (const item of items) {
  signal?.throwIfAborted();
  try {
    const doc = await parseItemAsync(item, signal);
    results.set(item.name, doc);
  } catch (err: unknown) {
    // ❌ 致命陷阱：无差别 catch 将取消异常误当成「条目损坏/业务解析失败」
    logger.warn(`skip ${item.name}: parse failed — ${err}`);
    this.loadErrors.push({ name: item.name, error: String(err) });
    continue;
  }
}
```
- **灾难表征**：
  1. 当外部调用者在读取第 N 个条目的 I/O 期间触发中止（`signal.abort()`）时，抛出的 `AbortError` 被内层 catch 捕获，当成“这个文件语法坏了”记录到 `loadErrors` 脏状态中；
  2. 若该条目恰好是循环中的最后一个，`continue` 退出循环后函数居然继续执行下游的指纹落盘或缓存写入，并向调用方**误报为正常执行成功**！调用方无法感知任务已被取消，内存中还残留了虚假的损坏报错。
- **规避铁律**：循环内部 catch 块首行必须执行取消守卫：
  ```typescript
  } catch (err: unknown) {
    if (signal?.aborted || (err as DOMException)?.name === 'AbortError') {
      throw err; // 取消异常绝不是业务失败，必须立即向外重抛中断循环！
    }
    // 仅常规业务解析失败才记录 loadErrors 并 continue
  ```

### 10.5 陷阱延伸二：仅校验名称导致的自定义 Abort Reason 吞没
在单条目自愈按需重读（如 `get(candidate, options)`）中：
```typescript
} catch (err: unknown) {
  if ((err as DOMException)?.name === 'AbortError') throw err; // ❌ 隐藏漏洞
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
  logger.warn(`read failed: ${err}`);
  return undefined; // 吞没错误回退
}
```
- **漏洞成因**：
  根据 Web 标准与 Node.js 现代规范，当外部调用者使用携带具体原因的中止控制器（例如超时控制器 `controller.abort(new Error('fetch timeout'))`）时，底层抛出的异常其实例名称是 `'Error'` 而非 `'AbortError'`！
  上述代码仅检查了 `err.name === 'AbortError'`，导致判断为 false，错误被当作普通读取异常记录警告并吞没返回了 `undefined`。
- **规避铁律**：必须组合检查入参信号状态与错误类型：
  ```typescript
  if (options?.signal?.aborted || (err as DOMException)?.name === 'AbortError') throw err;
  ```


---

## 十一、一句话清单

- `skills/change` = 消费方通知缝，提供者订阅它反向 invalidate = 同步递归栈溢出。
- `registerProvider` 工厂返回值必须捕获到闭包变量，否则 invalidate 空转。
- 宿主全局配置（如语言）变更不跨 Fiber 广播，收敛点必须监听 `app-boot/config-reload`。
- 异步多 I/O 扫描必须加 `scanPromise` In-Flight 屏障，防止并发重入相互清空 Map 丢失技能。
- 仅呈现维度切换时解耦物理扫描，直接复用内存文档对象生成投影，实现零磁盘 I/O 刷新。
- 每条新断言做破坏实测：人为制造反模式，确认门禁变红，再还原。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/skill/skill  <-  @deepseek-ai/dsh-skill@0.2.0-rc.2
packages/skill/skill-filesystem  <-  @deepseek-ai/dsh-skill-filesystem@0.2.0-rc.2
```
