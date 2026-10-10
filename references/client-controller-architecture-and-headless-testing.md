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
