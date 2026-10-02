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
 │ 左侧导航/活动栏│ 主对话区 (main.chat)             │ 右侧边栏面板      │
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
适用于在模型输入框右下角、发送按钮旁增加辅助按钮（如 `dsh-prompt-history` 注入的历史弹出菜单、语音输入麦克风等）。

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

- **Slot 属性**：`kind: "chain"`（链式中间件模式，组件接收 `{ node, next }`，调用 `next()` 渲染下一层默认节点）。
- **实战注册范例**：
```jsx
export function apply(ctx) {
  ctx.slots.inject("conversation.chat.node", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.node",
        id: "my-plugin:bubble-decorator"
      },
      ({ node, next }) => {
        // 如果是特定消息，包裹自定义边框或徽标
        if (node.type === 'assistant' && node.text?.includes('【特批】')) {
          return (
            <div className="special-badge-wrapper">
              <span className="badge">⭐ 官方特批回复</span>
              {next()}
            </div>
          );
        }
        // 默认放行至下游渲染
        return next();
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

---

## 四、官方主题设计系统与 CSS 样式安全规范

DSH 前端提供了一套标准的主题 CSS 变量，支持自动跟随深色（Dark）和浅色（Light）模式无缝切换。

### 1. 官方核心颜色变量矩阵
开发插件 UI 时，**严禁硬编码 `#ffffff` 或 `#000000`**，必须优先使用以下官方设计令牌（Tokens）：

| CSS 变量名 | 语义作用 |
| :--- | :--- |
| `var(--dsw-alias-label-primary)` | 主要文字颜色（最高对比度正文） |
| `var(--dsw-alias-label-secondary)` | 次要文字颜色（副标题、辅助信息） |
| `var(--dsw-alias-label-tertiary)` | 弱化文字颜色（占位符、小字提示） |
| `var(--dsw-alias-surface-primary)` | 主背景色（面板、容器底色） |
| `var(--dsw-alias-surface-secondary)` | 次级背景色（卡片悬停、输入框背景） |
| `var(--dsw-alias-border-subtle)` | 分割线与细边框颜色 |
| `var(--dsw-alias-accent-primary)` | 品牌高亮/主按钮激活色 |

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
