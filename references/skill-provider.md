# 自定义技能发现 (SkillProvider) 与技能包契约

本文件覆盖两条技能路线：**消费**已注册技能（写 SKILL.md 让官方发现器扫到），以及**生产**技能（自己实现 `SkillProvider` 把任意来源包装成原生技能）。

官方默认发现器是 `@deepseek-ai/dsh-skill-filesystem`，它扫的是文件系统目录。要把自己的资源（打包在 npm 包内、来自远端、经过筛选或动态裁剪）变成和官方技能一模一样的原生技能，唯一入口是向 `ctx.skills` 注册一个 provider。

---

## 一、契约层与服务层（读 `@deepseek-ai/dsh-skill` 的类型声明）

```ts
// contract 包：@deepseek-ai/dsh-skill（seam，必须 peer 依赖，不能当 dependencies 拉进来）
// provider 包：@deepseek-ai/dsh-skill-filesystem（官方实现，通常由宿主 bundle 已装）
// 挂载：ctx.skills（复数，是注册表）
```

注册接口签名（`SkillRegistry`）：

```ts
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
```

- `create` 是**同步**工厂，返回的对象就是 provider；
- 返回值是 Cordis effect disposer，卸载即注销并连带清缓存。

`SkillProvider` 只有两个必实现方法：

| 方法 | 职责 | 硬性要求 |
| --- | --- | --- |
| `list(options)` | 返回本 provider 的候选技能摘要数组 | 可返回数组（完整结果），或返回 `{ candidates, complete: false }`（发现未完成） |
| `get(candidate, options)` | 宿主选中某候选后回取完整定义（含正文） | 必须回读 `candidate.locator`，不能假设候选仍是最新的 |

`SkillProviderControl` 提供 `invalidate()`：注册被 dispose 时 abort，同时**主动作废宿主侧已缓存的目录**。任何影响候选集的运行时变更（配置改了、文件变了、目录被过滤）都必须调它，否则宿主继续用旧缓存，用户改了配置却"没反应"——而且没有任何报错。

---

## 二、rank：决定重名的唯一依据

同名技能由 rank 小者胜，**只在同一层内比较**；跨层由层优先级先决。项目条目 > 运行时条目 > 用户条目。

官方常量（从 `dsh-skill` 源码读出，随版本漂移，写代码前以本地 `lib/index.js` 为准）：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `RUNTIME_RANK` | 250 | 运行时 `ctx.skills.register()` 直接注入的技能 |
| `BUNDLED_SKILL_RANK` | 600 | 打包/随仓库分发的本地 bundled 根目录 |

选择规则：

- 自己的技能要和官方 bundled 同名共存时，取 250 与 600 之间的值（例如 550），保证既能压过运行时注入，又不会盖过官方内置；
- 需要完全压过官方内置时才取 < 600，且必须给出理由，因为这类技能通常在抢同一个名字；
- rank 必须是**有限数字**，非法值由宿主抛错，不会静默降级。

---

## 三、候选对象（SkillCandidate）的必填字段与校验行为

宿主对 provider 返回的每个候选做强制校验，违反即抛错并中断整次发现：

| 字段 | 校验规则 |
| --- | --- |
| `name` | 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$`（小写、连字符分隔），非法直接被拒 |
| `description` | 必须是非空字符串 |
| `rank` | 必须是有限数字 |
| `invocation` | 缺省时宿主补 `{ modelInvocable: true, userInvocable: true }` |
| `locator` | 不透明句柄，`get()` 原样收回；宿主不会解释它，只能由 provider 自己解析 |
| `resourceBase` | 可选，`{ kind: 'directory', path }`，供技能正文解析相对资源 |

常见误用：

- 把 `locator` 塞成整个对象再指望宿主读字段——它只是往返凭据；
- `get()` 里按 `candidate.name` 去磁盘重新扫描，等于把发现成本翻倍且丢掉定位信息；
- `get()` 返回的 `name` 与候选不一致，宿主会当作加载失败静默丢弃，表现为"技能列出来了但加载没内容"。

---

## 四、发现未完成的正确表达：`SkillProviderObservation`

`list()` 返回数组等价于"发现完整"。当一次发现无法覆盖全部（例如目录还在枚举、远端拉取超时、当前正在被 abort），必须返回：

```ts
{ candidates: [], complete: false }
```

语义要点：

- `complete: false` 的结果**不进缓存**，宿主保留上次的好结果并在下一个请求边界重试；
- 绝不能用一个空数组假装"这次没找到技能"，那会被缓存成权威结果，技能凭空消失且无任何报错；
- 目录不存在、不是目录这类可预期情形，返回 `complete: false` 并打一条 warn，是正确姿势。

---

## 五、取消语义：AbortSignal 必须贯穿全程

`SkillLookupOptions` 带 `signal`。宿主在选择候选之后**还会再检查一次取消**，并把加载过程与取消赛跑，以免不合作的 provider 拖死调用方。

因此 provider 的三条纪律：

1. `list()` / `get()` **第一行**就 `options.signal?.throwIfAborted()`；
2. 目录遍历的**循环体内**继续探测，不要只在入口查一次（长目录中途被取消时仍会白跑）；
3. 底层 `fs` 调用把 `signal` 透传下去；`readFile` 抛的 `AbortError` 要**继续向上抛**，其余读取错误按"该技能不可加载"处理并跳过。

把 abort 吞成"跳过"会让宿主等满超时，是最难查的一类卡顿。

---

## 六、生产侧：写自己的 SKILL.md 发现器

若技能正文存放在磁盘目录，provider 要自己解析 frontmatter。四个易错点：

1. **BOM**：文件开头可能有 `﻿`，不剥离则首行 `---` 判定失败，技能整个不被发现；
2. **CRLF**：`---` 比较前要去掉行尾 `\r`，否则 Windows 上写的文件全部解析失败；
3. **闭栏**：必须找到正文里**第一行**独立的 `---`，找不到就返回"无 frontmatter"而不是把全文当正文；
4. **目录名即契约**：标准布局是 `<dir>/<skill-name>/SKILL.md`。frontmatter 的 `name` 与目录名不一致时，宿主按 frontmatter 的 `name` 参与去重，会出现"两个不同名技能抢同一个目录"的错觉；对齐两者，或显式 warn。

调用策略反例（都是性能陷阱）：

- 每次 `list()` 都全量读盘所有 SKILL.md 再解析 YAML：N 个技能 N 次读 + N 次解析；
- 在 `list()` 里就把正文塞进候选：会让候选对象体积暴涨，且 `get()` 的存在意义被架空。

正解：`list()` 只读 frontmatter 拿摘要，把路径放进 `locator`；`get()` 再读一次正文。若确定技能集合在一次注册期间**绝对不变**，可在 provider 内部做进程内缓存，并在 `control.invalidate()` 时清空。

---

## 七、Skill 包自身的契约（消费侧）

无论用官方发现器还是自定义 provider，技能包必须满足：

- `description` 是模型决定要不要加载的唯一依据，必须写清"做什么 + 什么时候用"，空泛描述直接导致技能永不被触发；
- 名称必须小写连字符形式，与目录名一致；
- 正文是 Markdown，注入模型上下文时宿主会按 `resourceBase` 渲染资源引用，并对嵌入的模型可见文本做转义；
- `whenToUse` 是可选的补充路由说明；`invocation` 控制模型/用户两侧的可见性，缺省两侧都开。

---

## 八、生命周期与失效的完整链路

```
配置文件/目录变化
   ↓  provider 主动调 control.invalidate()
宿主作废该 provider 的目录缓存（complete:false 的结果本就不缓存）
   ↓
下次 ctx.skills.list() 重新发现
   ↓
选中候选 → ctx.skills.get() → provider.get(candidate) → 正文入上下文
```

- `registerProvider` 的返回值交给 `ctx.effect` 托管，插件卸载时自动注销；
- `invalidate()` 在注册被 dispose 时会被宿主 abort 掉，实现里要容忍"被 abort 后再被调用"；
- 想让用户改配置后立刻生效，**配置写入点和 invalidate 调用点必须在同一处**，否则必然出现"改了不生效且零报错"。
### 屏蔽技能的官方唯一通道：覆盖 invocation，不剔除条目

插件要「关掉某个技能」时，**不要从 `list()` 的返回里过滤掉它**。正确做法是把该候选的 `invocation` 两个布尔改掉：

```ts
// 覆盖而不是剔除
candidate.invocation = { ...candidate.invocation, modelInvocable: false }
// 等价于在该技能的 SKILL.md 里写 disable-model-invocation
```

| 做法 | 后果 |
| --- | --- |
| **覆盖 `invocation` 布尔**（正确） | 技能仍占注册表名额与同名裁决权；语义与写 frontmatter 完全一致；改回去即恢复 |
| 从 `list()` 结果里 filter 掉（错误） | 丢失同名裁决权；`get()` 若未同步过滤仍能取到；宿主侧 `skill` 工具的报错从「该技能对当前不可见」退化为「未知技能」，用户拿不到有效诊断 |

**两处都必须套用**：`list()` 与 `get()` 都要按同一份屏蔽表改写。只改 `list()` 会让模型目录里看不到它，但 `skill` 工具调用依然成功，这是「看起来生效了其实没生效」的典型形态。

**热生效要双失效**：想让运行时改开关立刻生效，必须同时让「注册表的目录缓存」与「你自己的候选快照」双双作废。前者靠 provider 的 `control.invalidate()`（宿主据此广播 `skills/change`），后者靠你自己在数据源变化时清快照。缺任一方都表现为「UI 已更新而模型侧目录不变」。

**验证要分两侧取证**：宿主侧用真实 `SkillRegistry` 复核「模型可见集」与「用户可见集」，UI 侧逐行比对显示值与宿主目录。只看界面等于没验。

---

## 九、自检清单

| 检查项 | 判定动作 |
| --- | --- |
| provider 真的挂上了 | 运行时 `ctx.get('skills')` 非 undefined，且 `skills/change` 事件能收到 |
| 候选没被静默丢弃 | `ctx.skills.list()` 的返回里能数到自己技能的 name |
| rank 选得合理 | 与官方 bundled 同名时，rank < 600 且 > 250 |
| 取消不拖死 | 中断后 provider 的 promise 立即 settle，而不是等超时 |
| 失效及时 | 改配置后不重启即可在 list 结果里看到变化，否则漏了 invalidate |
| 正文能加载 | 走 `ctx.skills.get(candidate)` 能拿到非空 content，name 与候选一致 |

---

## 十、常见误解

| 误解 | 事实 |
| --- | --- |
| 技能必须放在用户目录的固定位置 | 只是官方默认发现器的约定；任意来源都可以经自定义 provider 变成原生技能 |
| `list()` 返回空数组表示"没有技能" | 空数组会被当作完整结果并缓存；"未发现完"必须显式 `complete: false` |
| 改了目录文件宿主会自动感知 | 缓存不会自己失效，必须由 provider 调 `control.invalidate()` |
| `locator` 会被宿主解析 | 它是不透明往返凭据，只有 provider 自己知道含义 |
| 只要 peer 依赖 `@deepseek-ai/dsh-skill` 即可 | 宿主还需要有**实现方**（如 `dsh-skill-filesystem`）；契约包与实现包分离，只装契约包服务存在但无提供方 |
| skill 描述写长一点更安全 | description 是路由依据，不是说明文档；写清触发条件比堆字数有用得多 |
