# dsh-settings-tab-plugin

演示如何在 DeepSeek Harness (DSH) 全局设置窗口（Settings）左侧添加专属选项卡（Tab），并在右侧渲染自定义 React 设置面板的双面 UI 插件范例。

---

## 核心架构特性

1. **设置栏 Tab 注入**：通过客户端 `ctx.slots.inject('settings.section', ...)` 向全局设置窗口注入带有独立 ID 与排序权重的侧边选项卡；
2. **纯 React 设置面板**：右侧渲染完整的 React 表单面板（包含 Toggle 开关与 Range 滑块）；
3. **零上下文组件规范**：严格贯彻 **“React 组件绝不能接收 ctx 实例”** 铁律，通过标准 React Props 与 DOM CustomEvent 进行解耦通信；
4. **前端本地持久化**：使用 `localStorage` 实现即时保存与 0 延迟响应，无须重启后端。

---

## 运行与验证

在当前 profile 目录下添加并加载：
```bash
# 1. 验证规范合规性
node scripts/validate_plugin.mjs examples/settings-tab-plugin

# 2. 向 profile 添加
dsh plugin --profile web add ./examples/settings-tab-plugin
```
打开 DSH Web GUI 并按下 `Cmd/Ctrl + ,` 开启设置窗口，在左侧即可看到“示例插件设置”专属选项卡！
