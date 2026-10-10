# DSH 双面客户端控制器深度架构与脱机纯内存状态机单测实践

> 本专题总结 DSH 双面（Dual-Face）插件浏览器半侧控制器的深模块（Deep Module）设计范式，以及如何利用 `node:vm` 轻量沙箱在无真实浏览器、无 DOM 环境下建立毫秒级脱机状态机单元测试。

---

## 一、浅组件反模式与架构摩擦

在 DSH 客户端插件开发中，配置面板（如挂载在 `plugins.bundle.config` 插槽）常因缺乏领域模型分层而退化为浅模块（Shallow Module）：

```
[浅组件反模式]
React 组件 (4+ 个 useState: pending, failures, keyword, localDraft...)
   │  多参数深传 (8 参泥球: form, t, names, op, setPending, setFailures, override, carry)
   ▼
散落的工具函数 (submit / switchOps)
   │  直接操控 React 更新器 + 直调 form.mutate
   ▼
宿主 ConfigForm (存在乐观锁冲突、状态撕裂与 disposed 假死)
```

### 核心痛点
1. **参数泥球与逻辑泄漏**：提交函数形参膨胀，底层逻辑必须知晓并直接调用 React 内部的 `setPending` 与 `setFailures`，控制流混杂；
2. **缺乏独立测试表面（Test Surface）**：业务逻辑与 React 运行环境强绑定；测试一个简单的“开关切换是否生成原子 ops”必须依赖 Python Playwright 启动真实 Chromium 进程，单次测试耗时数分钟，反馈极其迟缓；
3. **并发渲染状态撕裂（Tearing）**：在 React 18 并发渲染模式下，分散的 `useState` 与外部异步 `mutate` 回执无法保障原子一致性。

---

## 二、控制器深模块范式 (The Deep Controller Pattern)

按照深模块设计原则（小接口、深实现、高杠杆、强局部性），应将配置交互抽象为独立的领域模型类：

```
┌────────────────────────────────────────────────────────┐
│                   极简语义接口 (Interface)              │
│  toggle(id) | batchSet(op) | setOption(val) | reset()  │
├────────────────────────────────────────────────────────┤
│                   门后深实现 (Implementation)           │
│  - ConfigForm 订阅与状态映射 (getSnapshot)              │
│  - 单/批量操作扁平化拍平 (Flattening allOps)           │
│  - 历史废弃字段原子继承 (Legacy Carryover)              │
│  - 热卸载 disposed 假死前置拦截                        │
│  - 代际计数 (Generation Counter) 防幽灵更新             │
│  - 失败捕获、原生控制台堆栈输出与 UI 错误归集           │
└────────────────────────────────────────────────────────┘
```

### 标准控制器结构模板
```javascript
class PanelController {
  constructor(scope, options) {
    this._scope = scope;
    this._t = (options && options.t) || ((k) => k);
    this._allIds = (options && options.allIds) || [];
    this._pending = {};
    this._failures = {};
    this._generation = 0;
    this._listeners = new Set();
    this._unsubscribe = null;

    this._bindScope(scope);
  }

  _bindScope(scope) {
    if (this._scope !== scope) {
      if (this._unsubscribe) this._unsubscribe();
      this._scope = scope;
    }
    if (this._scope && typeof this._scope.subscribe === 'function') {
      this._unsubscribe = this._scope.subscribe(() => this._notify());
    }
  }

  updateScope(nextScope) {
    this._bindScope(nextScope);
    this._notify();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    this._listeners.forEach((fn) => {
      try { fn(); } catch (e) {}
    });
  }

  getSnapshot() {
    const snap = (this._scope && typeof this._scope.getSnapshot === 'function')
      ? this._scope.getSnapshot()
      : { status: 'loading', writable: false, value: {} };
    const value = snap.value || {};

    return {
      status: snap.status || 'ready',
      writable: snap.writable !== false && snap.mode !== 'memory',
      data: value,
      pending: this._pending,
      failures: this._failures,
    };
  }

  async _submit(affectedIds, ops) {
    // 1. 热卸载/假死前置拦截
    if (!this._scope || this._scope.disposed || typeof this._scope.mutate !== 'function') {
      const err = new Error(this._t('hostUnavailable'));
      console.error('[<plugin-id>] form.mutate failed:', err);
      this._setFailures(affectedIds, this._t('writeFailed') + ': ' + err.message);
      return false;
    }

    const currentGen = this._generation;
    this._setPending(affectedIds, true);
    this._clearFailures(affectedIds);

    try {
      // 2. 单次原子批处理提交
      const accepted = await this._scope.mutate(ops);
      if (accepted === false) {
        throw new Error(this._t('writeFailed'));
      }
      if (this._generation === currentGen) {
        this._clearFailures(affectedIds);
      }
      return true;
    } catch (error) {
      // 3. 防静默失败：控制台打印真实堆栈
      console.error('[<plugin-id>] form.mutate failed:', error);
      if (this._generation === currentGen) {
        const msg = this._t('writeFailed') + ': ' + String(error && error.message ? error.message : error);
        this._setFailures(affectedIds, msg);
      }
      return false;
    } finally {
      if (this._generation === currentGen) {
        this._setPending(affectedIds, false);
      }
    }
  }

  // 语义化动作定义
  toggleItem(id, enabled) { /* 构建原子 ops 并提交 */ }
  batchSet(enabled) { /* 扁平化拍平全量 ops 提交 */ }
  
  dispose() {
    this._generation += 1;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._listeners.clear();
  }
}
```

---

## 三、React 18 原生无感接入 (`useSyncExternalStore`)

由于控制器实现了 `{ subscribe, getSnapshot }` 契约，React 18 组件消费它仅需 1 行代码：

```javascript
function ConfigPanel(props) {
  const form = props.actions.form;
  const controllerRef = React.useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new PanelController(form, { t: props.t });
  } else {
    controllerRef.current.updateScope(form);
  }

  React.useEffect(() => {
    return () => {
      if (controllerRef.current) controllerRef.current.dispose();
    };
  }, []);

  // 1 行接入响应式快照，零并发渲染撕裂 (Tearing)
  const state = React.useSyncExternalStore(
    (notify) => controllerRef.current.subscribe(notify),
    () => controllerRef.current.getSnapshot()
  );

  // 纯声明式渲染 state.data, state.pending, state.failures...
}
```

---

## 四、接口即测试表面：脱机纯内存状态机单测

DSH 客户端代码虽然包裹在 `window.__ModuleLoader__.load({ id, factory: ... })` 结构中，但**完全不需要真实的浏览器或 JSDOM**。
通过 Node.js 原生的 `node:vm` 模块，可以在内存沙箱中拦截并执行 `factory`，提取出控制器类进行毫秒级单测！

### 1. 纯内存模块提取器 (`client-test-loader`)
```javascript
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolve } from 'node:path';

export async function loadClientController(clientJsPath) {
  let capturedSpec = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (spec) => { capturedSpec = spec; },
    },
  };

  const code = await readFile(resolve(clientJsPath), 'utf8');
  vm.runInNewContext(code, {
    window: mockWindow,
    console,
  });

  if (!capturedSpec || typeof capturedSpec.factory !== 'function') {
    throw new Error('未能从 client.js 中捕获 ModuleLoader 工厂');
  }

  // 为 UI 库提供最小空桩，模型层不触碰任何真实 DOM 渲染
  const mockRequire = (id) => {
    if (id === 'react') return { createElement: () => ({}), useState: (v) => [v, () => {}] };
    return {};
  };

  const exports = capturedSpec.factory(mockRequire);
  return exports.PanelController;
}
```

### 2. 最小 MockScope (ConfigForm 桩)
```javascript
export function createMockConfigForm(initialValue = {}, options = {}) {
  let value = structuredClone(initialValue);
  let status = options.status ?? 'ready';
  let writable = options.writable ?? true;
  let disposed = options.disposed ?? false;
  const listeners = new Set();
  const historyOps = [];

  return {
    get disposed() { return disposed; },
    getSnapshot: () => ({
      status,
      writable,
      value: structuredClone(value),
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mutate: async (ops) => {
      if (disposed || !writable) return false;
      if (options.shouldReject) throw new Error(options.rejectReason || 'EIO');
      if (options.rejectAccept) return false;

      historyOps.push(structuredClone(ops));
      // 应用变更到内存快照...
      listeners.forEach((fn) => fn());
      return true;
    },
    __historyOps: historyOps,
  };
}
```

### 3. 核心单测断言示例 (`scripts/client.test.mjs`)
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('批量操作必须拍平为单次原子 mutate (拒绝 15 次并发竞争)', async () => {
  const PanelController = await loadClientController('src/client.js');
  const form = createMockConfigForm({});
  const controller = new PanelController(form);

  await controller.batchSet(false);

  // 核心断言：仅发起 1 次原子调用，操作数组完整包含所有变更
  assert.equal(form.__historyOps.length, 1);
  assert.ok(form.__historyOps[0].length > 1);
  controller.dispose();
});

test('防静默失败：form.mutate 抛错必须打印原生控制台堆栈', async () => {
  const PanelController = await loadClientController('src/client.js');
  const form = createMockConfigForm({}, { shouldReject: true, rejectReason: 'EACCES' });
  const controller = new PanelController(form);

  let capturedLog = '';
  const originalError = console.error;
  console.error = (...args) => { capturedLog = args.join(' '); };

  try {
    const ok = await controller.toggleItem('item-a', false);
    assert.equal(ok, false);
    assert.ok(capturedLog.includes('form.mutate failed:'));
    assert.ok(capturedLog.includes('EACCES'));
  } finally {
    console.error = originalError;
    controller.dispose();
  }
});
```

---

## 五、方案收益对比

| 评估维度 | 传统散落组件 + Playwright 测试 | 深度控制器 + node:vm 脱机单测 |
| :--- | :--- | :--- |
| **测试执行耗时** | **~180 秒（3 分钟）**（拉起宿主、拉起 Chromium） | **< 50 毫秒**（纯内存异步调度） |
| **测试依赖环境** | 强依赖 Python、Playwright、浏览器内核、GUI/Xvfb | **零额外依赖**，纯 Node 原生标准库 |
| **并发安全性** | React 多个 useState 存在状态撕裂与幽灵更新风险 | `useSyncExternalStore` + 代际计数彻底杜绝撕裂 |
| **断言精度** | 只能感知外层 DOM 按钮高亮，测不到底层 ops 数组形状 | 深度断言：精细验证 ops 扁平性、旧表迁移与 disposed 边界 |
| **开发反馈循环** | 慢速门禁，开发期极少全量运行 | 秒级即时 TDD 校验，可无缝接入门禁或 pre-commit |

---

## 六、跨 Realm 对象深比较断言陷阱与拍平范式 (Cross-Realm Equality Pitfall)

在纯 Node 环境下使用 `node:vm` 脱机运行客户端 Bundle 并测试 Controller 的返回值时，开发者极易遭遇一个极其迷惑的断言报错：

### 1. 典型假失败现象
```text
AssertionError [ERR_ASSERTION]: Values have same structure but are not reference-equal:
[
  { op: 'set', path: [ 'defaultMode' ], value: 'ultra' }
]
operator: 'deepStrictEqual'
```
控制台打印出来的数据结构与期望值逐字完全一样，甚至手写属性比对全部相等，但 `node:assert/strict` 却判定断言失败！

### 2. 底层根因分析：V8 独立 Realm 原型链隔离
`node:vm.createContext(sandbox)` 在 V8 引擎内部创建了一个全新的独立执行域（JavaScript Realm）。
- 沙箱内 `CardController` 执行返回的数组和对象字面量（`[]` 与 `{}`），其原型链指向沙箱 Realm 内部的 `sandbox.Array.prototype` 与 `sandbox.Object.prototype`；
- 测试用例代码处于宿主主进程的 Realm（指向 `globalThis.Array.prototype`）；
- `node:assert/strict` 的 `deepEqual` / `deepStrictEqual` 在进行深度结构比对时，会递归校验对象构造器与原型的恒等性（`actual.constructor === expected.constructor`）。跨 Realm 对象的构造器引用不同，因此被严格模式无情拒绝！

### 3. 标准通用解法：JSON 数据结构拍平范式 (Flattener Pattern)
在脱机单测中，我们关注的是 Controller 产出的**数据形状（Data Shape）与字段值**，而非 V8 内部的 Realm 原型链。

标准优雅的解法是在断言前引入单行拍平辅助函数：
```javascript
// 跨 vm 沙箱 Realm 统一经 JSON 结构拍平断言
const toJson = (v) => JSON.parse(JSON.stringify(v));

// 深度校验原子 ops 数组形状与字段值：100% 免疫跨域原型链误伤
assert.deepEqual(
  toJson(controller.buildSetModeOps('ultra')),
  [{ op: 'set', path: ['defaultMode'], value: 'ultra' }]
);

assert.deepEqual(
  toJson(controller.buildResetOps()),
  [
    { op: 'unset', path: ['defaultMode'] },
    { op: 'unset', path: ['disabledSkills'] },
    { op: 'unset', path: ['skillDescriptionLang'] },
  ],
  '重置操作必须平铺为单次原子 mutate ops，杜绝并发乐观锁撕裂'
);
```

**避坑总结**：在任何基于 `node:vm` 的纯内存脱机单测中，只要断言沙箱输出的复合对象或数组，一律使用 `toJson()` 消除 Realm 差异，绝不应误判为“业务逻辑写错”或被迫回退去拉起笨重的真实浏览器！

---

## 七、React 18 合成事件微任务并发窗口缺陷与同步栈内存互斥防重锁模式

### 1. 现实痛点：为什么 `useState(busy)` 守卫必定发生并发撕裂？
在编写 DSH 双面插件配置面板时，开发者最常见的直觉是在 React 组件内定义一个忙碌状态：
```typescript
// 典型反模式：依赖 React 局部状态做互斥防重
const [busy, setBusy] = React.useState(false);

const handleToggle = async (item) => {
  if (busy) return; // 试图通过 busy 拦截二次点击
  setBusy(true);
  try {
    await form.mutate(buildOps(item), state.revision);
  } finally {
    setBusy(false);
  }
};
```

**底层缺陷根因剖析**：
1. **React 18 批量异步调度窗口 (Batched Updates Window)**：在 React 18 的合成事件系统中，`setBusy(true)` 不会立刻同步触发组件重新渲染，而是作为一个状态更新任务被加入微任务/事件循环队列。从用户第一次点击、到 React 实际完成下一次 Commit 渲染期间，当前闭包执行环境中的 `busy` 仍然是 `false`！
2. **微任务竞态穿透**：如果用户快速连续点击（如双击开关，或极快地连续切换两个选项），第二次点击会在第一次点击的异步请求返回之前、甚至在下次渲染生效之前被捕获，直接绕过 `if (busy) return` 守卫！
3. **宿主 Revision 乐观锁撕裂**：宿主底层 `ConfigFormController.mutate(ops, expectedRevision)` 收到显式版本号时会进行严格的版本栅栏比对（Revision Fence）。两次并发点击带着相同的当前版本号（如 `revision: 42`）进入宿主队列。前一个操作成功将宿主版本提升为 `43`，紧随其后的第二个操作带着旧版本号 `42` 到达宿主，被宿主检测到版本落后直接返回 `false`，触发 UI 报出不可逆的保存失败错误！

### 2. 标准解法：领域控制器同步栈内存物理互斥锁模式
互斥防重的本质是**同步执行锁**，绝不能依赖异步调度的 UI 渲染状态。必须将互斥锁下沉到领域控制器实例的物理内存属性上：

```typescript
export class PanelController {
  private form?: PageForm;
  private _busy = false; // 实例级同步布尔锁
  private _error: string | null = null;

  async toggle(id: string, next: boolean): Promise<boolean> {
    // 关键：在 JavaScript 主线程同步执行栈的第一行瞬间判锁并置位！
    if (this._busy || !this.isWritable() || !this.form) {
      return false; // 同步拦截，绝不生成异步 Promise，绝不进入网络队列
    }
    this._busy = true;
    this._error = null;

    try {
      const ops = this.computeAtomicOps(id, next);
      // 单次原子批处理提交，严格传递当前表单版本
      const ok = await this.form.mutate(ops, this.form.state.revision);
      if (!ok) this._error = this.t('saveFailed');
      return ok;
    } catch (e) {
      this._error = String(e && (e as Error).message ? (e as Error).message : e);
      return false;
    } finally {
      // 异步任务终结时释放锁
      this._busy = false;
    }
  }

  isBusy(): boolean {
    return this._busy;
  }
}
```

**机制优势**：
- **零微任务延迟**：只要在同步栈第一行执行 `this._busy = true`，任何在同一事件循环轮次、微任务交错期进入的二次调用，都会在第一行被同步拦截并立即返回 `false`；
- **100% 根除版本冲突**：由于微任务窗口被物理闭合，底层宿主 `form.mutate` 绝不可能在前序操作未完成前收到并发调用，彻底消除乐观锁撕裂。

---

## 八、Ponytail 极简工程裁决——单页面板何时果断砍掉自建事件总线与 useSyncExternalStore 脚手架

### 1. 架构场景判据：单页面板 vs 跨组件共享面板
在评估是否需要在控制器中引入 `_listeners = new Set()`、`subscribe()`、`useSyncExternalStore` 与 `Generation Counter` 等重型脚手架时，必须首先判定宿主的挂载架构：

| 挂载场景 | 宿主分发行为 | 是否需要自建事件总线？ | Ponytail 裁决 |
|---|---|---|---|
| **场景 A：跨组件共享全局控制器**<br>(如独立的全局浮层、多个分立插槽共用同一控制器实例) | 控制器作为跨组件单例存在，状态变动需主动通知多个分散组件刷新 | **需要**自建订阅与外部存储接入 | 遵循通用模板实现完整发布订阅模式 |
| **场景 B：宿主单页面板**<br>(如挂载于 `plugins.row.config` 或 `plugins.bundle.config`) | 宿主上层已经在全局监听配置变动；每次变动宿主都会给组件传入全新的 `props.form` | **坚决不需要**自建事件分发器 | **果断砍掉！** 控制器只需作为轻量无状态/轻状态领域模型 |

### 2. 避免过度工程的设计实践
在场景 B（宿主单页面板）中，若机械照抄通用控制器的全量模板，会带来明显的过度设计：
- 引入了 50+ 行从不被多调用方使用的 `subscribe` / `_notify` 胶水代码；
- 增加了 React 闭包与外部订阅的生命周期解绑开销。

**最高杠杆的极简落地方式**：
1. **组件内轻量持有控制器**：
   ```typescript
   function Panel(props: PanelProps, fallbackT: Translate): React.ReactElement {
     const t = props.t ?? fallbackT;
     const [, setTick] = React.useState(0);
     
     // 直接实例化轻量控制器并随时同步最新 props
     const [controller] = React.useState(() => new PanelController(props.form, t));
     controller.update(props.form, t);

     const snap = controller.getSnapshot();
     if (snap.status === 'loading') return React.createElement('div', null, t('loading'));

     // 触发操作时驱动极薄重绘
     const trigger = (action: () => Promise<boolean>) => {
       setTick((v) => v + 1); // 立即驱动 busy 禁用态重绘
       action().finally(() => setTick((v) => v + 1)); // 异步完成后驱动解锁重绘
     };

     // 组件退化为 100% 声明式纯视图渲染 snap.skills, snap.loadMode...
   }
   ```
2. **收益总结**：
   - 控制器仅需约 70 行代码，没有任何冗余抽象；
   - 彻底摆脱了复杂的事件分发管理，纯状态机直接暴露给纯 Node 脱机测试（毫秒级执行）；
   - 代码行数负增长，圈复杂度降至最低。

---

## 九、React 18 useSyncExternalStore 快照未缓存无限重渲染死循环与事件驱动缓存模式

### 1. 现实痛点：为什么点击插件卡片会导致界面瞬间冻结卡死（CPU 100%）？

在 DSH 双面插件配置面板中，当开发者将领域控制器接入 React 18 的 `useSyncExternalStore` 时，常会遭遇一个灾难性的生产故障：
**在插件管理页点击插件卡片展开详情时，整个宿主界面瞬间失去响应、CPU 跑满 100%、浏览器提示页面无响应（Page Unresponsive）并最终崩溃**。

#### 核心机理剖析：React 18 快照引用恒等检查
在 React 18 的并发与同步外部存储订阅机制中，`useSyncExternalStore` 会在组件渲染（render）与提交（commit）阶段持续校验外部状态一致性：
```javascript
// React 内部 checkIfSnapshotChanged 伪代码
function checkIfSnapshotChanged(inst) {
  const latestGetSnapshot = inst.getSnapshot;
  const prevValue = inst.value;
  try {
    const nextValue = latestGetSnapshot();
    return !Object.is(prevValue, nextValue);
  } catch (error) {
    return true;
  }
}
```
- 若控制器的 `getSnapshot()` 未做引用缓存，每次调用都会通过对象字面量重新组装并返回一个全新的对象 `return { status, writable, data: ... }`；
- 每次调用后 `Object.is(prevValue, nextValue)` 恒为 `false`；
- React 误判外部存储在组件渲染期间发生了并发突变，立即调度下一次重新渲染以确保数据一致性；
- 下一次渲染再次调用 `getSnapshot()` 又得到全新引用，导致组件陷入无限同步重渲染死循环（`Maximum update depth exceeded`）。

#### 致命复合陷阱：Render 期调用 updateScope 无条件触发 _notify()
更隐蔽的死锁陷阱发生在组件重新渲染时控制器与作用域的同步逻辑中：
```javascript
function PluginConfigPanel(props) {
  const form = (props?.actions?.form) ?? props?.form;
  const modelRef = React.useRef(null);
  if (!modelRef.current) {
    modelRef.current = new PanelModel(form);
  } else {
    modelRef.current.updateScope(form); // 致命陷阱：在组件 render 函数体内直接执行
  }
}
```
若控制器的 `updateScope(nextScope)` 没有做作用域恒等检查，而是无条件执行 `this._notify()`：
- `_notify()` 会在 JavaScript 同步执行栈中直接遍历调用 `useSyncExternalStore` 注册的订阅监听器；
- 在 React 正在进行渲染计算的周期内，强行向 React 派发重绘信号；
- 这一同步更新信号与未缓存快照的死循环产生共振，瞬间把浏览器主线程彻底锁死！

---

### 2. 标准解法：事件驱动失效快照缓存模式 (Event-Driven Snapshot Memoization)

外部存储控制器（Observable Store）的本质是**事件驱动模型**。在底层数据源未派发变更通知、且用户未发生主动交互前，快照对象的引用必须保持**绝对恒等**。

#### 核心状态机生命周期契约
快照缓存（`_cachedSnapshot`）**仅在以下四类离散事件发生时置空失效**：
1. **底层数据源变动事件**：`this.scope.subscribe` 注册的回调被宿主触发；
2. **作用域真实跃迁**：`updateScope(nextScope)` 检测到 `this.scope !== nextScope`；
3. **用户主动交互导致内部状态变更**：如搜索关键词过滤变更、开关操作中等待态（pending）开启/解除、错误信息字典更新等；
4. **数据提交完成或失败回滚**。

其余任何时间调用 `getSnapshot()`，必须直接返回已存在的 `_cachedSnapshot` 引用。

---

### 3. 通用标准控制器实现模板

```javascript
export class PanelModel {
  constructor(scope, options) {
    this.scope = scope;
    this.t = (options && options.t) || ((k) => k);
    this.keyword = '';
    this.pending = {};
    this.failures = {};
    this.listeners = new Set();
    this.unsubscribe = null;

    // 快照缓存字段
    this._cachedSnapshot = null;

    this._bindScope(scope);
  }

  _bindScope(scope) {
    if (this.scope !== scope) {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      this.scope = scope;
      this._cachedSnapshot = null; // 作用域切换立即失效缓存
    }
    if (this.scope && typeof this.scope.subscribe === 'function' && !this.unsubscribe) {
      this.unsubscribe = this.scope.subscribe(() => {
        this._cachedSnapshot = null; // 外部变更广播驱动失效
        this._notify();
      });
    }
  }

  // 严密的作用域恒等守卫：未变动绝不广播，杜绝 render 期死锁
  updateScope(nextScope) {
    if (this.scope !== nextScope) {
      this._bindScope(nextScope);
      this._cachedSnapshot = null;
      this._notify();
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    this.listeners.forEach((fn) => {
      try { fn(); } catch (e) {}
    });
  }

  // 事件驱动快照读取
  getSnapshot() {
    // 只要缓存有效且当前处于可订阅状态，直接返回稳定缓存
    if (this._cachedSnapshot && this.scope && typeof this.scope.subscribe === 'function') {
      return this._cachedSnapshot;
    }

    const raw = (this.scope && typeof this.scope.getSnapshot === 'function')
      ? this.scope.getSnapshot()
      : { status: 'loading', writable: false, value: {} };

    // 执行领域数据提取与归一化计算...
    const cleanData = this._extractData(raw.value);

    this._cachedSnapshot = {
      status: raw.status || 'ready',
      writable: raw.writable !== false && raw.mode !== 'memory',
      data: cleanData,
      keyword: this.keyword,
      pending: this.pending,
      failures: this.failures,
    };
    return this._cachedSnapshot;
  }

  // 交互状态驱动失效
  setKeyword(query) {
    const next = String(query || '');
    if (this.keyword !== next) {
      this.keyword = next;
      this._cachedSnapshot = null;
      this._notify();
    }
  }

  _setPending(id, isPending) {
    const next = Object.assign({}, this.pending);
    if (isPending) next[id] = true;
    else delete next[id];
    this.pending = next;
    this._cachedSnapshot = null;
    this._notify();
  }

  // 属性解构防御性支持：安全解构 props 中的 form
  dispose() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.listeners.clear();
    this._cachedSnapshot = null;
  }
}
```

---

### 4. 纯 Node 原生脱机单测断言范式

依托 Node.js 原生 `node:test` 与 `node:assert/strict`，无需真实浏览器或 DOM，即可在 5ms 内对快照引用稳定性建立不可破坏的静态断言：

```javascript
test('TC-Snapshot: getSnapshot 引用稳定性与 updateScope 零无谓广播', async () => {
  const { PanelModel } = await loadClientModel('src/client.js');
  const form = createMockConfigForm({ items: { 'item-a': true } });
  const model = new PanelModel(form);

  // 1. 核心断言：未发生变更时连续多次读取必须返回完全恒等的对象引用
  const snap1 = model.getSnapshot();
  const snap2 = model.getSnapshot();
  assert.equal(snap1, snap2, '未发生任何配置变更时，getSnapshot 必须严格引用恒等');
  assert.equal(snap1.data, snap2.data, '嵌套数据字典引用也必须保持稳定');

  // 2. 核心断言：updateScope 传入相同 scope 时绝不能触发 _notify 广播
  let notified = false;
  const off = model.subscribe(() => { notified = true; });
  model.updateScope(form);
  assert.equal(notified, false, 'updateScope 传入相同实例时绝不能广播，防止 render 期死锁');
  off();

  // 3. 核心断言：发生真实变更后快照必须正确更新为全新引用
  await model.toggle('item-a', false);
  const snap3 = model.getSnapshot();
  assert.notEqual(snap1, snap3, '数据发生真实变更后快照必须更新为新引用');

  model.dispose();
});
```

---

### 5. 视图层插槽注入属性防御性提取

在 DSH 的 Web 插槽体系中（如 `plugins.bundle.config` 与 `plugins.row.config`），宿主在不同页面或不同入口下注入的参数形状可能略有差异（例如某些场景通过 `props.actions.form` 传递，另一些直接传递 `props.form`）。

组件顶层严禁使用裸解构 `const form = props.actions.form`，一律采用防御性空值合并：
```javascript
function ConfigPanel(props) {
  // 防御性解构：安全兼容不同插槽调用面，彻底免疫 TypeError: Cannot read properties of undefined
  const form = (props && props.actions && props.actions.form) || (props && props.form);
  const t = props?.t ?? ((k) => k);
  // ...
}
```

