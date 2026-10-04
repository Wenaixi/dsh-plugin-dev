# DSH Web GUI 全量插槽树、主题系统与 i18n 国际化实战指南 (DSH 0.2.0-rc.2)

本文件是辅助开发 DeepSeek Harness (DSH 0.2.0-rc.2) 客户端双面 UI 插件的权威技术规范。
详细梳理了主界面全量插槽（右侧栏、会话头、输入框、消息流、全局外壳）、官方主题设计系统（CSS 变量与深浅色模式）、以及多语言国际化（i18n）的实战开发指南。

---

## 一、Slot 层级树见 three-roles.md

DSH 的 Web GUI 采用组件化微前端插槽体系，**所有 UI 扩展一律通过 `ctx.slots.inject` 注入**，挂载与样式回收由宿主负责。

Slot 标识清单、cardinality（single/list/keyed/chain）与 scope（root/session-maybe/session）的完整对照表见 [three-roles.md](./three-roles.md) 的「常用 Slot 标识清单」；本文件只讲各插槽的注册实战与样式/i18n 配套。

下图是**布局示意**（非完整标识表）：

```
┌────────────────────────────────────────────────────────────────────────┐
│                              DSH Web GUI 插槽拓扑                      │
└────────────────────────────────────────────────────────────────────────┘

 [shell.leading] (全局顶部横幅)
 ────────────────────────────────────────────────────────────────────────
 ┌───────────────┬──────────────────────────────────┬───────────────────┐
 │ 左侧导航/活动栏│ 主对话区 (main，key conversation；注意无 main.chat 槽)             │ 右侧边栏面板      │
 │ (sidebar.*)   │                                  │ (sidebar.right.*) │
 │               │  [conversation.session.header.   │                   │
 │               │   utilities] (会话顶部快捷按钮)  │  [sidebar.right.  │
 │               │ ──────────────────────────────── │   pane.tab]       │
 │               │  [conversation.chat.node]        │  (侧边独立选项卡，│
 │               │  (消息流链式拦截/自定义气泡渲染) │   如文件树/编辑器) │
 │               │ ──────────────────────────────── │                   │
 │               │  [conversation.composer]         │                   │
 │               │   ├─ [conversation.input.right]  │                   │
 │               │   │  (输入框右侧挂件,如历史记录) │                   │
 │               │   └─ [conversation.input.        │                   │
 │               │       attachments] (附件栏工具)  │                   │
 └───────────────┴──────────────────────────────────┴───────────────────┘
 [shell.overlay] (模态弹窗 / 浮层)
 [settings.section] (全局设置窗口，见 settings-and-plugin-ui.md)
```

---

## 二、主界面核心插槽注册契约与实战范例

### 1. 右侧边栏扩展 (`sidebar.right.pane.tab`)
适用于在主界面右侧提供抽屉或独立面板（如 Better Sidebar、文档预览器、Git 图谱等）。

- **Slot 属性**：`kind: "keyed"`，`scope: "session"`（每个会话独立拥有当前打开的 tab 状态）；
- **实战注册范例**：
```jsx
import React from 'react'

export function apply(ctx) {
  // 1. 注册右侧边栏的主体内容
  ctx.slots.inject("sidebar.right.pane.tab", () =>
    ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: "my-custom-sidebar", // 选项卡唯一标识
        // 可选：通过 inject 为组件提供当前会话上下文
        inject: (sessionId) => ({ sessionId })
      },
      MySidebarPanelComponent
    )
  );

  // 2. （可选）注册该选项卡的标题栏定制
  ctx.slots.inject("sidebar.right.pane.tab.title", () =>
    ctx.slots.register(
      {
        name: "sidebar.right.pane.tab.title",
        key: "my-custom-sidebar"
      },
      () => <span>我的侧边扩展</span>
    )
  );
}
```

---

### 2. 会话顶部工具栏按钮 (`conversation.session.header.utilities`)
适用于在会话顶部右上角增加快捷操作按钮（如“导出对话”、“会话统计”、“一键清屏”等）。

- **Slot 属性**：`kind: "list"`，`order` 控制按钮从左到右排序；
- **实战注册范例**：
```jsx
export function apply(ctx) {
  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "my-plugin:export-button",
        order: 50 // 排序权重
      },
      (props) => (
        <button
          className="my-header-btn"
          title="导出当前会话"
          onClick={() => alert('点击了会话顶部按钮！')}
        >
          📥
        </button>
      )
    )
  );
}
```

---

### 3. 输入框挂件与附件扩展 (`conversation.input.right`)
适用于在模型输入框右下角、发送按钮旁增加辅助按钮（如历史记录弹出菜单、语音输入麦克风等第三方注入）。

- **实战注册范例**：
```jsx
export function apply(ctx) {
  ctx.slots.inject("conversation.input.right", () =>
    ctx.slots.register(
      {
        name: "conversation.input.right",
        id: "my-plugin:history-trigger"
      },
      InputHistoryIconComponent
    )
  );
}
```

---

### 4. 消息流链式拦截与自定义渲染 (`conversation.chat.node`)
适用于在聊天对话流中，对特定类型的消息卡片进行自定义包装或替换（例如高亮渲染代码、增加气泡水印、拦截显示特殊结果）。

- **Slot 属性**：`kind: "keyed"`、scope `session`（**不是 chain**；0.2.0-rc.2 中本槽按 key 注册，客户端用 `useChatNode(key)`/`useChatNodeProcess(key)` 渲染；chain 槽真实存在的是 `conversation.composer` 与 `shell.quota-notice`，chain 注册必须提供 `select`，缺失即抛错）。
- **实战注册范例**：
```jsx
export function apply(ctx) {
  ctx.slots.inject("conversation.chat.node", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "my-plugin:bubble-decorator", // keyed 槽必须提供 key（不是 id）；注意 keyed 只看 priority，order 无效
      },
      ({ node, hookContext }) => {
        // keyed 渲染函数按 key 命中；没有 next()，按需返回包装
        if (node.type === 'assistant' && node.text?.includes('【特批】')) {
          return (
            <div className="special-badge-wrapper">
              <span className="badge">官方特批回复</span>
              {node.content}
            </div>
          );
        }
        return null; // null 即该节点空渲染；fallback 仅在该 key 无注册者时出现（未知表面 JsonBlock），不是默认消息渲染
      }
    )
  );
}
```

---

## 三、国际化多语言系统 (i18n / Locale)

DSH 客户端内置了响应式的 `ctx.locale` 统一管理中文（`zh`）与英文（`en`）。

### 1. 字典定义与命名空间注册
在插件客户端入口中，定义字典对象并注册到唯一的命名空间（Namespace）：

```js
const NS = 'dsh-my-plugin';

const zh = {
  nav: '我的插件',
  btnLabel: '点击运行',
  hint: '这是一个运行在浏览器中的插件'
};

const en = {
  nav: 'My Plugin',
  btnLabel: 'Click to Run',
  hint: 'This is a browser-side plugin'
};

export function apply(ctx) {
  // 1. 注册字典（使用 ctx.effect 管理生命周期，卸载时自动注销）
  ctx.effect(() => {
    return ctx.locale.register(NS, { zh, en });
  }, 'dsh-my-plugin: dictionaries');

  // 2. 绑定当前命名空间的取词函数
  const t = ctx.locale.bind(NS);

  // 3. 在插槽注册中使用翻译文本
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'my-plugin',
        order: 90,
        label: () => t('nav') // 动态返回 "我的插件" 或 "My Plugin"
      },
      MyPanel
    )
  );
}
```

### 2. 语言边界：静态文案进词典，内容数据保持单语

客户端面板的文案分两层，语义不同、通道不同：

| 层 | 例子 | 处理 |
|---|---|---|
| 界面静态文案 | 标题、按钮、提示、占位、标签、空态 | 进 `zh`/`en` 词典，经 `t()` 取词，随宿主界面语言切换 |
| 内容数据 | 列表条目的名称与描述（技能/插件/记录，可能来自磁盘目录或远端） | 固定单一语言，不进词典，不做条目级翻译 |

把列表内容塞进词典是常见的过度设计：内容由业务方维护，与界面语言是两套变更周期；面板只负责展示，`t()` 不应承担翻译业务数据的职责。界面换语言时条目文字原样保留，这符合「界面 UI 双语、内容数据单语」的默认取舍。

### 3. 声明 `locale:` 让渲染器注入 t 席位

`ctx.slots.register` 的 options 里声明 `locale: NS` 后，渲染器会把该命名空间的类型化 `t` 作为标准席位注入组件 props——组件里 `const t = props.t` 直接用，**不需要**自己在 apply 里 `ctx.locale.bind(NS)` 再手动把 t 传进 inject 面：

```js
ctx.slots.register({ name: "xxx", key: "my-plugin", locale: NS, inject: () => ({ ... }) }, Panel)
// Panel(props) 里 props.t 已就绪：t("modelInvocable")、label: t("xxx") + " " + item.name
```

未声明 `locale:` 的条目拿不到 t 席位；声明了却缺失 locale 服务（宿主未装配 locale 插件）是装配失败。

### 4. 缺词是静默失效：t() 找不到键返回 key 字符串

官方 `LocaleRuntime` 的查词链：入口词典 -> common 词典 -> **原样返回 key 字符串**。新增或改名一个 key，漏同步 `zh`/`en` 任一册，界面上直接显示裸 key（如 `modelInvocable`），零报错、零控制台告警。双语对称是硬要求：`register(ns, { zh, en })` 一次注册两册，两册 key 集必须完全一致。

手写 CJS factory（无 `LocaleNamespaceMap` 类型合并）没有类型检查兜底，双语对称只能靠静态门禁：断言渲染路径不存在裸字符串字面量、每个 key 在源码中至少出现两次字典声明（双语各一）。这类断言同样必须做破坏实测——见 silent-failure-and-gate-design.md。

---

## 四、官方主题设计系统与 CSS 样式安全规范

DSH 前端提供了一套标准的主题 CSS 变量，支持自动跟随深色（Dark）和浅色（Light）模式无缝切换。

### 1. 官方核心颜色变量矩阵
开发插件 UI 时，**严禁硬编码 `#ffffff` 或 `#000000`**，必须优先使用官方设计令牌（Tokens）。

下表每一行都经本地官方包源码全量扫描核实。数量口径（统一剔伪影）：全官方包 `lib/client.js` 提及 `--dsw-*` 去重 414 个（若把 runner 里的 `--dsw-alias-` 截断残片计入为 415）；按 js+css 全口径为 417 个；其中真正由 `dsh-client-ui-theme` 定义在 `body/:root` 上、**照抄即可生效**的是 403 个（全库 js+css 口径与 theme 定义数之差仅 14 个（如 primitives HoverCard 的 --dsw-hovercard-bg），引用它们宿主 body 未定义）——**下表只列 403 个已定义变量中的常用项**：

| CSS 变量名 | 语义作用 |
| :--- | :--- |
| `var(--dsw-alias-label-primary)` | 主要文字颜色（最高对比度正文） |
| `var(--dsw-alias-label-secondary)` | 次要文字颜色（副标题、辅助信息） |
| `var(--dsw-alias-label-tertiary)` | 弱化文字颜色（占位符、小字提示） |
| `var(--dsw-alias-bg-layer-1)` | 分层背景色（卡片、列表行底色） |
| `var(--dsw-alias-bg-layer-2)` | 次级分层背景色 |
| `var(--dsw-alias-bg-layer-3)` | 三级分层背景色（Tag 底色） |
| `var(--dsw-alias-border-l2)` | 常规分割线与细边框 |
| `var(--dsw-alias-border-l3)` | 强调边框（控件描边） |
| `var(--dsw-alias-border-l4)` | 强边框（Tag 描边） |
| `var(--dsw-alias-state-business-primary)` | 品牌高亮 / 主按钮激活色 |
| `var(--dsw-alias-state-success-primary)` | 成功态（done / success） |
| `var(--dsw-alias-state-warn-primary)` | 警告态（attention / warning） |
| `var(--dsw-alias-state-error-primary)` | 错误态（failure / danger） |
| `var(--dsw-alias-state-idle-primary)` | 空闲态圆点 |
| `var(--dsw-alias-interactive-bg-hover)` | 悬浮背景 |
| `var(--dsw-radius-sm)` / `--dsw-radius-md` | 小 / 中圆角 |

**常见误写（这些名字官方并不存在，写上去会静默失效、样式退化成浏览器默认）**：

| 错误写法 | 正确写法 |
| :--- | :--- |
| `--dsw-alias-surface-primary` | `--dsw-alias-bg-layer-1` |
| `--dsw-alias-surface-secondary` | `--dsw-alias-bg-layer-2` |
| `--dsw-alias-border-subtle` | `--dsw-alias-border-l2` |
| `--dsw-alias-accent-primary` | `--dsw-alias-state-business-primary` |

CSS 变量未定义时不会报错，只会用兜底值——**所以别给 `var(--x, #fff)` 写硬编码兜底**，那等于把错误藏起来。变量拼错时应当直接在 DevTools 里查 Computed Style 确认真实值。

#### 令牌的三层结构与两条硬事实

`--dsw-*` 分三层，**只用语义层（alias）**：

```text
--dsw-static-*   原始色板常量（调色板本身，不随主题变）
      ↓
--dsw-alias-*    语义层（浅色/深色两套取值，主题切换时整组换）
      ↓
组件级令牌      官方组件自己的变量
```

**硬事实一：颜色变量定义在 `body` 上，不是 `:root`。** 所以在 `document.documentElement` 的 computed style 里查不到颜色变量，必须查 `body`（或元素本身）。落在 `:root` 的只有 `--dsw-radius-*`、`--dsw-font-family*`、`--dsw-corner-shape`、`--dsw-focus-ring-width` 与 shiki 相关变量。

**硬事实二：主题切换是 `body[data-ds-dark-theme]` 属性。** 不是 `data-theme`，不是 `.dark`。想在自己的验收脚本里模拟深色，就给 `body` 加这个属性。`--dsw-static-*` 的浅深两套取值几乎相同，**引用它等于放弃主题联动**。

#### 三条容易踩的令牌事实

| 事实 | 说明 |
| --- | --- |
| **不存在间距令牌** | 没有 `--dsw-space-*`，一律用裸 px。官方实际使用的间距阶梯约为 2/4/6/8/10/12/14/16/18/20/22/24/28/32 |
| **状态色命名反直觉** | 信息色叫 `state-business-primary` 而不是 info；错误色叫 `state-error-primary` 而不是 danger |
| **别名可能只在官方组件的局部作用域里存在** | 某些名字官方 CSS 引用了却没在 `body` 上定义，写上去等于写空值。判定办法：在 DevTools 里选中该元素看 Computed Style，值为空即不存在 |

**排版统一走字阶令牌**（形如 `--dsw-font-xxxs-11`、`--dsw-font-xxs-12`、`--dsw-font-xs-13`、`--dsw-font-s-14`、`--dsw-font-base-16`），名字末段基本是字号；例外 `--dsw-font-m-18` 实为 `500 16px/28px`（末段 18 与字号不符，用前先在 DevTools 确认）。写成 `font-size: 13px` 而不带 line-height 会丢掉官方行高节奏。

**行分隔用相邻兄弟选择器**：官方（ui-conversation）是 `.row + .row { box-shadow: inset 0 1px 0 var(--dsw-alias-border-l1) }`；`0.5px solid + var(--dsw-alias-border-l2)` 组合官方在多处做描边（ui-deliverables/jobs/schedule/settings-account/shortcuts/sidebar-browser/sidebar-documentpreview/agent-team 等 9 处），只是不用它做行分隔——不要给每行自带 border-bottom，后者会在末行多出一条线。

### 2. 样式安全注入与 HMR 自动回收铁律
为避免插件卸载或热重载时样式残留，推荐使用标准的 **带标识 `<style>` 标签注入法**：

```js
const PLUGIN_CSS_ID = 'dsh-my-plugin-style';

const CSS_RULES = `
  .my-custom-container {
    background-color: var(--dsw-alias-surface-primary);
    color: var(--dsw-alias-label-primary);
    border: 1px solid var(--dsw-alias-border-subtle);
    border-radius: 8px;
    padding: 16px;
  }
`;

export function apply(ctx) {
  // 安全挂载样式并由 ctx.effect 托管清理
  ctx.effect(() => {
    let tag = document.querySelector(`style[data-plugin-css="${PLUGIN_CSS_ID}"]`);
    if (!tag) {
      tag = document.createElement('style');
      tag.dataset.pluginCss = PLUGIN_CSS_ID;
      tag.textContent = CSS_RULES;
      document.head.appendChild(tag);
    }
    // 返回清理函数
    return () => {
      tag?.remove();
    };
  }, 'my-plugin: inject styles');
}
```

### 3. 首选官方 primitives，而非手写控件

DSH 把跨插件复用的 UI 控件沉淀在 `@deepseek-ai/dsh-client-ui-primitives` 包里，官方插件无一例外地复用它——**手写开关、分段控件、状态点、标签、按钮都是重复劳动，且必然与宿主观感不一致**。

引入方式：在 factory 内 `require` 即可；官方 50 个 require primitives 的客户端包中仅 5 个在 `dsh.client.inject` 里列出它，列不列均可。

```json
{
  "dsh": {
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-primitives"]
    }
  },
  "peerDependencies": { "react": "^18.2.0" }
}
```

```js
// lib/client.js（CJS factory 内）
const P = require("@deepseek-ai/dsh-client-ui-primitives")

// 分段选择器：完全受控，onChange 只在值真的变化时触发
P.SegmentedControl({
  id: "my-mode",
  label: "运行模式",
  value: mode,
  options: [{ value: "a", label: "甲" }, { value: "b", label: "乙" }],
  onChange: (next) => setMode(next),
})

// 开关：label 是无障碍必需项，不可省
P.Switch({ checked: on, onChange: (n) => setOn(n), label: "启用某功能" })

// 状态点 + 标签：配对表达「生效中 / 被覆盖 / 未设置 / 故障」
P.StateDot({ state: "done", size: 10, appearance: "dot" })   // done|warning|ongoing|error|idle
P.Tag({ tone: "success" }, "生效中")                        // outline|solid|neutral|quiet|success|info|warning|danger
P.Button({ variant: "outline", size: "sm", onClick: reset }, "恢复默认")
```

常用契约（取自 `lib/index.js` 实现与 JSDoc（发布物无 lib/types 目录，types 字段指向不存在的 .d.ts））：

- `SegmentedControl`：`options` 至少两项；每段 id 为 `<id>-<value>`。
- `Switch`：`label` 必填（无障碍），`title` 用于说明为何被锁。
- `StateDot`：自身 `aria-hidden`，**必须与文字配对使用**。
- `Tag`：只读标签，语义由 `tone` 承载，文字由渲染方给。

用 primitives 之后，插件代码里应**只剩布局**（flex / gap / 宽度），不再有任何颜色、圆角、字号定义；视觉随宿主主题与官方版本自动演进。

### 4. 客户端产物必须只有一个来源

同一个文件被两条构建链产出（`tsc` 编一份、再被构建脚本覆写一份）时，**两份产物必然漂移**，且漂移时机取决于构建顺序，极难排查。

正确做法：选一条链。若产物必须是无法由 `tsc` 直接生成的 CJS factory 形态（DSH 客户端的硬要求），就把生成逻辑放进构建脚本，并**删掉同名 TypeScript 源文件**，让 `exports` 只指向生成物。

同时检查所有静态门禁脚本里对该源文件的路径引用——删源文件后门禁会因 `ENOENT` 直接崩溃，务必同步改为指向新的唯一来源。

### 5. 直接复用：先查组件目录，再决定自绘

「UI 要符合 DSH 风格」的可执行含义不是**模仿**宿主配色，而是**复用宿主组件**。宿主把跨插件复用的原子组件沉淀在一个零 Cordis、零 slot 知识、只经 `--dsw-*` token 上色的包里；任何插件都不能 import 另一个插件的组件，所以这是控件唯一能共享的地方。

**决策顺序（先查表再动手）：**

| 你要画的东西 | 落点 |
| --- | --- |
| 按钮 | `Button`（variant：primary / ghost / outline / toolbar；size：md 36px / sm 28px） |
| 开关 | `Switch`（36x20，`label` 必填） |
| 几选一的模式切换 | `SegmentedControl`（互斥、带滑动指示块、自带 tab 键盘模式） |
| 视图切换 / 筛选器（可同时激活多个） | `Pill`（独立 chip，`active` + `onClick`） |
| 只读状态徽标 | `Tag`（8 种 tone，文字由渲染方给） |
| 生效中 / 被覆盖 / 未设置 / 故障 | `StateDot` + `Tag` 配对 |
| 输入框 | `Input`（ref 指向原生节点，卸载时自动清空） |
| 复选框 | `Checkbox` |
| 悬浮菜单 | `Menu` / `MenuItemButton` / `MenuSurface`（键盘走位与焦点归还已内建） |
| 悬停提示 / 预览 | `Tooltip` / `HoverCard`（含视口钳制） |
| 模态框 | `Modal`（与设置外壳共用 Esc/Tab 与焦点归还） |
| 即时横幅 | `Toast`（顶部居中，`holdMs` 由持有方给） |
| 折叠行 | `DisclosureRow`（固定 24px 紧凑排版） |
| 敏感操作二次确认 | `RiskConfirmation`（显式复选框把关） |
| 渲染模型 Markdown / 代码 / diff / 终端输出 | `MarkdownText` / `CodeBlock` / `DiffBlock` / `TerminalBlock` / `JsonTree` |
| 文件路径展示 | `PathLabel`（目录弱化、文件名主色、溢出保留尾部） |
| 插件卡片插画 | `PluginArtwork*`（没有自有插画就用 `PluginArtworkDefault`） |

**规则**：

- 复制这里的控件等于制造第二份必然漂移的实现，属于明确禁止的动作；
- 第二个插件需要同一个控件时，正确动作是让它住进这个共享包，而不是各自造一份；
- 只有需求确实特殊（形状、语义都不是通用控件）时才在自己包里写组件，并且**只用 token，不自定义色值**。

### 6. 四组容易混淆的组件（选错就是视觉不一致）

| 组合 | 判据 |
| --- | --- |
| `Tag` vs `Pill` | 11px 只读徽章用 `Tag`；可点选的胶囊（或必须落在 24px 文本行上）用 `Pill`。尺寸与可交互性同时是判据，不可互换 |
| `Pill` vs `SegmentedControl` | 一排 `Pill` 是彼此独立的 chip，可同时激活多个；`SegmentedControl` 是互斥模式，带指示块与 tab 键盘语义 |
| `DisclosureRow` vs 卡片 | 前者固定 24px 左右排列；名称叠在描述之上的卡片是另一种布局，属于功能包（例如插件管理中心的 `PluginCard`） |
| `StateDot` 与文案 | 圆点本身 `aria-hidden`，**必须与文字配对**；`appearance="step"` 用实心勾/空心圆表达步骤态 |

### 7. 文案必须由渲染方提供（不是可选项）

这些原子组件**读不到 locale**，所以每一段面向用户的文案都要通过 label prop 传入。各功能包负责把带类型的 `t` 席位映射到 primitive 的 label 接口。

- 省略 label 会**类型检查失败**，这不是运行时可选项；
- 自己实现 i18n 时同样要把本地化文案显式传入，不要依赖组件内部兜底；
- `Switch.label` 是无障碍必需项，不因为「界面上已经有一行标题」就可以省。

### 8. 自绘时的几何与语义底线

确实必须自绘时，从宿主的 CSS module 抄**尺寸**（不要抄颜色）：

| 项 | 数值 |
| --- | --- |
| 按钮 md / sm | 高 36px / 28px；圆角 `--dsw-radius-md` / `--dsw-radius-sm`；sm 字号 12px、左右内边距 10px |
| 开关 | 36x20，滑块 16px，开启态位移 16px |
| 分段控件 | tab 高 28px，左右内边距 16px，字号 13px/行高 20px，字重 500 |
| 状态点 | 10px 布局槽内画 6px 实心点 |
| 描边控件 | `0.5px solid`（不是 1px） |

其余一律走 token：颜色、边框、圆角、悬浮底色、阴影（`--dsw-elevation-soft`）、焦点环（`--dsw-focus-ring-width`）。禁用态统一走 `opacity: 0.4~0.5`。

**焦点与动效是无障碍底线，不可省**：

- 可交互元素必须有 `:focus-visible` 焦点环，用 `--dsw-focus-ring-width` + `--dsw-focus-ring-color`；
- 官方多数过渡组件包 `@media (prefers-reduced-motion: reduce)` 降级（SegmentedControl/Modal/Toast/DisclosureRow）；Switch 的 120ms 过渡是未降级的例外，自绘时仍应降级；
- 开关/勾选这类控件的视觉状态要绑 `aria-checked` 而不是平行 class，让「看到的」和「辅助技术读到的」不可能不一致。