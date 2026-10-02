# dsh-sidebar-tab-plugin

演示如何在 DeepSeek Harness (DSH) Web 主界面右侧边栏（`sidebar.right.pane.tab`）挂载独立面板，并在会话顶部工具栏（`conversation.session.header.utilities`）挂载快捷按钮的双面 UI 插件范例。

---

## 核心架构特性

1. **右侧边栏面板注入**：通过 `ctx.slots.inject('sidebar.right.pane.tab', ...)` 挂载与当前会话绑定的专属抽屉面板；
2. **顶部工具栏按钮**：通过 `ctx.slots.inject('conversation.session.header.utilities', ...)` 在对话流顶部右上角追加快捷图标；
3. **零上下文组件铁律**：组件绝不接收 `ctx`，通过纯 React Props (`sessionId`) 和状态管理完成交互。

---

## 运行与验证

```bash
# 1. 校验合规性
node scripts/validate_plugin.mjs examples/sidebar-tab-plugin

# 2. 安装并加载
dsh plugin --profile web add ./examples/sidebar-tab-plugin
```
