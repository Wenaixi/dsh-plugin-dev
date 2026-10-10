# 深度可逆生命周期、交互浮层深模块化与 Coordinator 架构规范

本指南提炼自生产级 DSH / Cordis 插件的架构重构实战，聚焦于**宿主服务安全猴补、非 React 交互浮层解耦、复杂输入外壳正交拆解与文档长青治理**等高频易踩坑领域，提供高度通用、可直接跨项目复用的工业级范式。

---

## 一、宿主服务猴补的 100% 深度可逆还原规范

### 1.1 痛点与致命陷阱
在开发拦截型或增强型插件时，常需包装宿主提供的全局单例服务工厂（例如 `service.sessionOf`、`service.getController` 等），并在其分发的实例方法（如 `controller.track`、`controller.handle`）上叠加增强逻辑。

**常见的致命反模式**：
```ts
// ❌ 浅层覆写反模式：卸载时仅还原顶层方法，遗漏已分发的活动实例
ctx.inject(['someService'], (raw) => {
  const service = raw.someService
  const origSessionOf = service.sessionOf
  service.sessionOf = (scope) => {
    const c = origSessionOf.call(service, scope)
    const origTrack = c.track.bind(c)
    c.track = (...args) => { /* 注入逻辑 */ return origTrack(...args) }
    return c
  }
  // 即使提供了清理：
  ctx.on('dispose', () => {
    service.sessionOf = origSessionOf
  })
})
```
**灾难后果**：
1. **旧闭包永久常驻**：插件卸载后，`service.sessionOf` 虽然被重置，但**在此之前已被分发给系统各个活动会话的实例仍持有被篡改的 `c.track` 闭包**；
2. **重复包装与雪崩**：当插件被热重载或重新激活时，同一会话实例被再次包装，形成多层嵌套闭包，引发性能雪崩或逻辑死循环；
3. **内存泄漏**：闭包引用了已销毁插件的 Context 和大对象，阻止垃圾回收。

---

### 1.2 黄金模式：四位一体深度可逆还原
为确保 100% 深度可逆且绝不引发 GC 泄漏，必须遵循「**全局 Symbol 防重入 + WeakRef 集合追踪 + 状态失活守卫 + 深度级联还原**」范式：

```ts
// ✔ 标准实现：100% 深度可逆猴补
const ORIG_TRACK = Symbol.for('dsh.plugin.origTrackMethod')

ctx.inject(['someService'], (raw) => {
  const service = (raw as Record<string, unknown>).someService as any
  const resolve = service?.sessionOf
  if (typeof resolve !== 'function') return

  ctx.effect(() => {
    let active = true
    // 使用 WeakRef 收集活动实例，绝不阻止 GC 垃圾回收
    const liveSessions = new Set<WeakRef<object>>()

    service.sessionOf = (scope: unknown) => {
      const controller = resolve.call(service, scope)
      if (controller === undefined || typeof controller.track !== 'function') return controller

      const c = controller as Record<symbol, unknown> & { track: (...args: any[]) => any }
      // 1. Symbol 守卫：防止同一实例被重复包装
      if (!c[ORIG_TRACK]) {
        c[ORIG_TRACK] = controller.track
        liveSessions.add(new WeakRef(controller))

        const origTrack = c[ORIG_TRACK] as (...args: any[]) => any
        controller.track = (...args: any[]) => {
          // 2. 状态守卫：失活后立即短路透传
          if (active && needEnhance(...args)) {
            return enhancedLogic(controller, origTrack, args)
          }
          return origTrack.apply(controller, args)
        }
      }
      return controller
    }

    // 3. 深度销毁回调
    return () => {
      active = false
      // 还原宿主顶层服务工厂
      service.sessionOf = resolve

      // 遍历解引用，逐一还原各活动实例的原方法并清理 Symbol
      for (const ref of liveSessions) {
        const c = ref.deref() as (Record<symbol, unknown> & { track: unknown }) | undefined
        if (c && c[ORIG_TRACK]) {
          c.track = c[ORIG_TRACK]
          delete c[ORIG_TRACK]
        }
      }
      liveSessions.clear()
    }
  }, 'dsh-plugin: safe reversible monkeypatch')
})
```

---

## 二、声明式样式与插槽监听器的生命周期管理

### 2.1 规则 1：样式标签必须注册卸载 Disposer
在浏览器端注入自定义 CSS 规则时，严禁裸调 `document.head.appendChild(style)`：
```ts
// ❌ 错误：HMR 热重载或插件禁用后，旧样式在 <head> 中不断累积叠加
document.head.appendChild(style)

// ✔ 正确：声明式注册销毁回调
ctx.effect(() => {
  document.head.appendChild(style)
  return () => { style.remove() }
}, 'dsh-plugin: stylesheet injection')
```

### 2.2 规则 2：插槽注入返回值必须回收
在 Cordis 客户端体系中，`ctx.slots.inject(...)` 注册了插槽的全局 Root 监听并返回一个 Disposer 函数。若裸调用而丢弃该返回值，热重载时宿主插槽容器内的回调数量将成倍膨胀。
```ts
// ❌ 错误：丢弃 Disposer，导致重复注入与卸载时监听器泄露
ctx.slots.inject('conversation.input.right', () => ctx.slots.register(...))

// ✔ 正确：使用 ctx.effect 妥善收集并自动执行
ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register(...)), 'dsh-plugin: input slot')
```

### 2.3 规则 3：严格使用注入子上下文（Sub-Context）
`ctx.inject(['someService'], (subCtx) => { ... })` 中，回调函数首参提供的 `subCtx` 绑定了被注入服务的生存周期。所有附属副作用必须注册在 `subCtx.effect` 而非父级的 `ctx.effect` 上，确保依赖服务重启时其挂载的逻辑能被协同注销。

---

## 三、非 React DOM 交互浮层的深模块化与离线单测模式

### 3.1 为什么交互浮层有时不能使用 React
在编辑器增强插件中，当弹出的悬浮列表（如快捷提示、命令选择器、自动补全）需要满足以下严苛约束时，React Portal 往往不适用：
1. **焦点锁定**：键盘光标必须严格留在底层的富文本宿主节点（contenteditable 或 textarea），不能被 React 弹层抢夺焦点；
2. **事件拦截时序**：必须在全局 `keydown` 捕获阶段（Capture Phase）以极高优先级短路按键，不允许经历 React 合成事件管道的重排延迟；
3. **轻量无开销**：弹层不需要复杂的组件树重绘，纯粹由数据快照直接投射为 DOM。

### 3.2 浅模块反模式 vs 独立控制器深模块
- **浅模块反模式**：在 `feedback.ts` 等文件中散落定义模块级全局变量（`let popupPanel: HTMLDivElement | null = null`、`let popupRefs: any = null`），向 `document.body` 突变 DOM，逻辑中硬编码读取宿主专属选择器。
  - *后果*：多实例竞态、测试产生污染、双向逻辑穿透，且测试必须依赖真实浏览器或庞大的 Playwright。
- **深模块控制器模式**：抽象出独立的 `OverlayController` 类，将 DOM 结构、ARIA 属性绑定、视口计算与外部点击监听彻底封装。

### 3.3 核心实现架构与纯函数算法提炼
把**业务纯算法**与**DOM 副作用**做物理切分，使核心逻辑在纯 Node 环境下无需任何假 DOM 即可完成毫秒级单测：

```ts
// 1. 纯算法：关键词高亮切片（零 DOM 依赖）
export function splitHighlighted(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query || !text) return [{ text, match: false }]
  const segments: Array<{ text: string; match: boolean }> = []
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  let cursor = 0, hit = lower.indexOf(needle)
  while (hit >= 0) {
    if (hit > cursor) segments.push({ text: text.slice(cursor, hit), match: false })
    segments.push({ text: text.slice(hit, hit + needle.length), match: true })
    cursor = hit + needle.length
    hit = lower.indexOf(needle, cursor)
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false })
  return segments
}

// 2. 纯算法：视口边界避让与坐标计算（零 DOM 依赖）
export function calculatePanelTop(anchor: { top: number; bottom: number } | null, h: number, vh: number): number {
  if (!anchor) return 8
  const above = anchor.top - h - 6
  const top = above >= 8 ? above : Math.min(anchor.bottom + 6, vh - h - 8)
  return Math.max(8, Math.min(top, vh - h - 8))
}

// 3. 深模块控制器：内聚生命周期
export class OverlayController<T> {
  private panel: HTMLElement | null = null
  private refs: T | null = null

  public isOpen(): boolean { return this.panel !== null }
  public render(data: RenderView, refs: T): void {
    if (!this.panel) this.mount()
    // 更新列表、ARIA aria-activedescendant、预览与高亮
    this.updateDom(data)
  }
  public hide(): void {
    if (this.panel) {
      document.removeEventListener('pointerdown', this.onOutsideClick, true)
      this.panel.remove()
      this.panel = null
    }
  }
  public destroy(): void { this.hide() }
}
```

---

## 四、输入交互外壳的 Coordinator 模式与 Hooks 正交解耦

### 4.1 痛点：组件的发散式变化（Divergent Change）
一个输入增强插件组件（如 `InputHistory.tsx`）常常横跨 4 个正交领域：
- 划词浮动复制/引用工具栏；
- 终端风格右键直接粘贴；
- 键盘历史快捷键拦截与动作派发；
- 宿主会话消息流 AST 实时吸收与去重。

把全部逻辑写在单一组件内部，行数轻易膨胀至 350+ 行。每当修改其中一项行为，都必须触碰相邻的无关逻辑，且在 `draft` 等高频变动状态下，全局事件监听器极易陷入“频繁解绑-重新绑定”的事件颠簸。

### 4.2 协调器（Coordinator）模式规范
1. **单一实时可变引用（Live Context）**：组件维护稳定的 `liveRef = useRef<LiveContext>({ ... })`，每轮渲染同步最新草稿与动作，避免闭包捕获陈旧状态。
2. **正交专属 Hooks 拆解**：
   ```ts
   export function InputEnhancer(props: Props): null {
     const liveRef = useRef({ draft, actions, phase })
     liveRef.current = { draft, actions, phase }

     const engine = useEngine()
     const overlay = useOverlayController()

     // 正交挂载 3 个单一职责 Hooks，依赖项全部固定为 [] 或稳定单例引用
     useSelectionToolbar(liveRef)
     useRightClickPaste(liveRef)
     useKeyboardHotkeys({ engine, overlay, liveRef })

     return null
   }
   ```
3. **架构收益**：
   - **零运行时开销**：Hook 仅为函数调用，无多余 Fiber 节点与 DOM 层级，JIT 自动内联；
   - **零重绑颠簸**：依赖项不含随打字高频变化的 `draft`，`document` 捕获期监听器仅挂载一次，极大减轻浏览器事件系统负担；
   - **极佳局部性**：每个 Hook 仅 40~60 行，职责单一，逻辑自闭环。

---

## 五、非必要说明文档与门禁中的“硬编码版本与度量指标去中心化”

### 5.1 痛点与文档债务
开发者常在面向使用者的说明文档（如 `README.md`）正文中写死具体的小版本号或测试数字：
- ❌ `### 6. 行内斜杠补全（v2.2.2 新增）`
- ❌ `test/ # 纯函数单元测试集（48 项测试全绿）`

**危害**：
1. **散弹式修改（Shotgun Surgery）**：每次版本升级或单测扩充，都必须散弹式地修改多份双语文档；
2. **陈旧信息误导**：一旦漏改某处，文档中的写死数字与代码实际脱节（例如实际跑了 68 项单测，文档仍写 48 项），让文档沦为误导性负资产。

### 5.2 黄金准则
1. **README 面向最终用户**：展示长久自洽的功能介绍，坚决剔除任何历史版本标注（如 `（vX.Y.Z 新增）`），直接描述该特性做什么；
2. **CHANGELOG 独占版本演进**：所有新增、修复、重构细节，严格且唯一地收敛于 `CHANGELOG.md` 与 Git Tag 注释中；
3. **门禁脚本为单一真源**：文档仅指示执行命令（如 `node --test test/*.test.ts`），具体通过的用例数由自动化输出权威作证，文档不写死阈值。
