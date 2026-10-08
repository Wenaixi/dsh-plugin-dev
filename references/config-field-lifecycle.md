# 配置字段的生命周期：新增、废弃、迁移与收敛

> 适用范围：插件要新增、废弃、重命名或迁移任何用户可持久的配置字段时。
> 核心命题：配置字段是插件唯一会被用户长期持有的状态。它的每次增删改都同时牵动**两个互相独立的面**——schema 声明面与写入面。两面不同步的后果不是编译错、不是启动失败，而是**界面照常渲染、点下去零写入、配置文件纹丝不动**。这是插件里最贵的一类缺陷：没有任何报错可查。

---

## 零、两个面

| 面 | 谁读 | 不同步的症状 |
|---|---|---|
| schema 声明面 | 宿主配置系统、Settings 写入闸门、快照投影 | 旧配置被丢弃 / 写入被拒 / 字段根本不出现 |
| 写入面 | 配置表单、补丁层、注册表、真实业务逻辑 | 值不落盘 / 值不生效 / 界面显示与实际行为不符 |

绝大多数「升级后功能坏了且零报错」都出在这两面之一上。改动配置字段时，先写下「这次动的是哪一面」，再动手。

---

## 一、新增字段：先回答一个问题

### 1.1 重启宿主后这个值需要保留吗

| 答案 | 字段形态 | 能否走配置表单写入 |
|---|---|---|
| 需要保留 | 非 volatile | **不能**，闸门会拒（见 plugin-config-card-architecture） |
| 不需要保留 | volatile | 能，改完立即生效，进程内活值 |
| 运行时推导 | 不进 schema | 不能，只读接口读取时计算 |

「不需要保留」这一类被低估了。展开/折叠状态、临时筛选、面板内的即时偏好，全都该是 volatile：用户改完立刻看到效果，重启丢失也无所谓。若把它们做成非 volatile 字段，功能上多了一次没必要的落盘与一次重启后的状态恢复。

### 1.2 三态字段：把「用户没管过」表达出来

单靠两个值表达不了「跟随宿主」这类语义——默认值与显式写入同值时，无法区分「用户选了默认值」和「用户没碰过」。

```ts
// 三态：undefined=缺失、'a'=锁定 a、'b'=锁定 b
language: Schema.union(['a', 'b']).required(false).volatile()
```

这是实现「跟随宿主界面语言」「跟随全局设置」的唯一办法。两侧都要按三态决策：

- 读取侧：`undefined` 时取宿主的当前值，显式值时取锁定值；
- 展示侧：`undefined` 时显示「跟随」，显式值时显示锁定目标；
- 切换侧：只发 `set`，不发 `undefined`（`undefined` 在写入语义上等同 unset）。

读取 volatile 字段必须调它的取值方法而不是直接当对象用——解析后它是带取值器的冻结引用，直接访问得到的是壳不是值。

### 1.3 新增字段的验收

1. 写入后回读描述接口的生效值与磁盘补丁，逐字段一致；
2. 完全重启宿主后值仍在（volatile 方案的唯一致命失败点）；
3. 文档只读时控件全禁且有明确横幅，不给用户可点的死控件。

---

## 二、废弃字段：两个标注都不能动

这是本篇最重要的一节。废弃一个字段时，直觉会驱动两个「清理」动作，而**两个都是错的**。

### 2.1 去掉 schema 声明 = 静默丢弃用户的历史配置

宿主配置系统按 schema 解析补丁。schema 里不认识的键，在组合与投影阶段被丢弃。

后果：用户 profile 里攒了很久的设置，升级后一次性消失，没有任何报错，插件看起来像「重置了」。

**规则一：废弃字段必须保留 schema 声明。**

### 2.2 去掉 volatile 标注 = 迁移批被整批拒绝

先看宿主写入闸门的实际实现（Settings 服务）：

```js
async mutate(ns, ops, expectedRevision) {
  await this.write(ns, /* 应用全部 ops */, expectedRevision, ops.map((op) => op.path))
}

async write(ns, change, expected, paths = []) {
  for (const path of paths) {
    if (path.length && !isVolatilePath(schema, path)) {
      throw new Error(`Config field "${path.join('.')}" is not volatile`)
    }
  }
  // ... 乐观并发校验 -> configEditor.edit（带文件锁的原子落盘）
}
```

两条关键事实：

1. 校验是**逐条**对 `ops` 的每一条路径做的，`set` 与 `unset` 一视同仁；
2. 任一条不合法即抛出，**整批不落盘**。

于是「一次写入新字段 + 清掉两个旧字段」的迁移批里，只要有一条 `unset` 指向非 volatile 的旧字段，**连主写入一起失败**。

症状极具迷惑性：面板正常渲染、控件点得动、每次都提示保存失败、配置文件零变化、静态门禁与端到端脚本全绿。

根因是一次方向性误解：把 volatile 当成「是否可写」的开关。实际上它是「能否参与实时编辑面」的判定，且判定粒度是**路径**——`unset` 与 `set` 同样受检。

**规则二：废弃字段必须保留 volatile 标注。**

保留 volatile 不会导致它被面板写入：面板只发新字段的 `set` 与旧字段的 `unset`，两者的路径集合是显式声明的，不会波及未提及的字段。

### 2.3 完整判据表

| 意图 | schema 声明 | volatile 标注 | 面板发出的 op |
|---|---|---|---|
| 仍在使用 | 保留 | 按数据性质决定 | `set` |
| 已废弃，仅为读旧值 | **保留** | **保留** | 不发 |
| 已废弃，需收敛清理 | **保留** | **保留** | `unset` |

---

## 三、迁移策略三选一

### 3.1 启动期迁移

宿主启动时读旧字段、转换、写新字段、清旧字段。

- 适合：转换逻辑有歧义或必须无损（值域收窄、单位换算、拆分与合并）。
- 风险：迁移写失败时用户不在场，出错就是静默的数据损坏，且下一次启动还会再试一次。
- 必须配：幂等（重复执行结果相同）与可观测（失败要留日志，否则永远查不到）。

### 3.2 惰性迁移（默认推荐）

不做独立迁移步骤。把「写新字段」与「清旧字段」合成**同一次 mutate**：

```js
// 一个 ops 数组同时含主写入与清理，共用一次 revision 栅栏与一次落盘
const ops = [
  { op: 'set', path: ['newField'], value: next },
  ...legacyFields.map((field) => ({ op: 'unset', path: [field] })),
]
await form.mutate(ops)
```

优势有三：

1. **不存在半迁移态**。一次栅栏、一次落盘，要么全成要么全不成，不会留下「新字段已写、旧字段还在」的中间态。
2. **出错时用户在场**。他刚点了保存，出错立刻可见，不会烂在磁盘上等人发现。
3. **成本只付一次**，且由真实触发它的那次操作承担，不需要额外的启动路径。

读取侧要配套：新字段为空时才回退读旧字段。收敛后回退分支自然不再命中，无需额外的清理任务。

### 3.2.1 集合/字典型字段的惰性迁移陷阱：局部操作与原子继承（Atomic Carryover）

§3.2 展示的代码适用于「单值字段」（如字符串、数字、枚举）。当待迁移的字段是**集合或字典**（例如历史上的 `modelDisabled: Record<string, boolean>` 与 `userDisabled` 收敛为单一字典 `disabled: Record<string, boolean>`）时，惰性迁移存在一个极具破坏性的**局部操作陷阱**：

#### 陷阱场景

用户升级前在旧表禁用了条目 A、B、C。
升级后进入面板：
- 客户端若正确把旧表并集读出，条目 A、B、C 视觉上正确显示为禁用；
- 此时用户操作了条目 D（例如将 D 禁用）。
- 若变异组装逻辑直觉地生成了如下操作批：
  ```javascript
  // ❌ 灾难性代码：只写了当前被点击的单项 D，并全量 unset 了旧表！
  const ops = [
    { op: 'set', path: ['disabled', 'D'], value: true },
    { op: 'unset', path: ['modelDisabled'] },
    { op: 'unset', path: ['userDisabled'] },
  ]
  await form.mutate(ops)
  ```
- **严重后果**：新表 `disabled` 中只有单项 D，而承载 A、B、C 的历史旧表被彻底 `unset` 抹除！用户只点了一下 D，原本被禁用的 A、B、C **全部被意外瞬间复活**！

#### 通用规范：原子继承迁移（Legacy Carryover）

1. **读取侧**：新表为空时才回退读旧表并集，并建立 `legacyActive` 判定标记；
2. **变异组装侧**：若当前处于旧表状态（`legacyActive === true`），执行任何局部操作（如操作单开关）时，**必须将旧表中其余依然生效的项作为 `set` 一同打包写入新表**，再同批执行旧表的 `unset`：

```javascript
function switchOps(names, op, legacyCarry) {
  const list = Array.isArray(names) ? names : [names];
  const ops = [];

  // 关键继承：首次在旧表状态下操作局部单项时，把旧表中其余有效项一并迁移写入新表
  if (legacyCarry) {
    Object.keys(legacyCarry).forEach((key) => {
      if (legacyCarry[key] === true && !list.includes(key)) {
        ops.push({ op: 'set', path: ['disabled', key], value: true });
      }
    });
  }

  // 正常生成当前操作项的 set / unset
  list.forEach((name) => {
    ops.push(op === 'disable'
      ? { op: 'set', path: ['disabled', name], value: true }
      : { op: 'unset', path: ['disabled', name] });
  });

  // 同一批原子清空全部旧表字段
  return ops.concat(LEGACY_FIELDS.map((field) => ({ op: 'unset', path: [field] })));
}
```

如此一来，无论用户是点单开关还是批量按钮，首次写入都会无缝、无损、原子地将全部历史配置完整带入新表，杜绝配置静默丢失。

### 3.3 只读兼容

保留旧字段读取路径，新字段优先，**不做写入收敛**。

- 只在旧字段确实无法被 unset 时选它（例如该字段由另一个插件拥有）。
- 风险：配置面长期存在两条真值。必须在代码里写清「哪条优先、何时收敛」，否则后来者会同时改两条，最后谁生效取决于读取顺序这种不该成为事实的东西。

### 3.4 三条策略的共同点

不管选哪条，都要满足：

- 读取侧对旧格式永远向后兼容，直到你确认主分支不再读它为止；
- 写入侧只有一条路径在写，写入点与失效通知点必须在同一处；
- 迁移逻辑有独立自检（喂旧格式、断言输出新格式），不依赖端到端环境。

---

## 四、批次的失败范围

一批 ops 共享三样东西：一次 revision 校验、一次带文件锁的原子落盘、一次 volatile 校验。由此得到四条实践。

1. **同一批里的 op 要么全合法，要么别放同一批。** 「主写入 + 迁移清理」放一起的前提是两者路径都通过 volatile 校验。
2. **一次发完，不要循环单发。** 循环会产生 N 次栅栏校验，中途任何一次被别人抢先改都会让整轮部分失败。
3. **不要指望部分成功。** 客户端的 mutate 失败后会做一次恢复读，把表单镜像刷回宿主真值——界面会「弹回」原值，看起来像没点过。
4. **并发靠栅栏不靠锁。** 传 `expectedRevision` 让宿主拒绝过期写，而不是指望客户端知道自己过时了。缺省该参数等于放弃并发保护。

---

## 五、验收判据（每条都可在隔离实例上复现）

| 判据 | 动作 |
|---|---|
| 写入 | 改一个字段 → 回读生效值与磁盘补丁，逐字段一致 |
| 迁移 | 带旧格式配置启动 → 触发任意一次写入 → 回读：旧键已消失、新键已落盘 |
| 闸门 | 人为把批里一条 op 指向非 volatile 字段 → **必须观察到整批零写入** |
| 重启 | 完全重启宿主后新字段仍生效 |
| 只读 | 文档只读时控件全禁且有明确横幅 |
| 双向 | 界面显示与真实注册表/存储逐行一致（两侧各自取证） |

第三条必须实测。你无法从静态断言推断闸门是否真的在，也无法推断它拦的是整批还是单条。

---

## 相关 DSH 源码

```text
packages/settings/settings   <-  @deepseek-ai/dsh-settings@0.2.0-rc.2
  lib/index.js（write 的 volatile 路径校验、乐观并发栅栏、configEditor.edit 原子落盘）
packages/boot/config-editor <-  @deepseek-ai/dsh-config-editor@0.2.0-rc.2
  lib/index.js（带文件锁的配置补丁写入）
```

配套阅读：

- [plugin-config-card-architecture.md](./plugin-config-card-architecture.md)：ConfigForms 只写 volatile 的两道硬门槛与接线形态。
- [config.md](./config.md)：补丁四层落点、`!!js` 表达式、bundle patch 与 schema 双向同步的反向闸门。
- [official-settings-form-pattern.md](./official-settings-form-pattern.md)：表单控制器的保存铁律与代际计数。
- [config-field-migration-selfcheck.md](./config-field-migration-selfcheck.md)：迁移逻辑的可失败自检写法。
