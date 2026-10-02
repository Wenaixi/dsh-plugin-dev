# DSH 插件设置栏 (Settings) 与插件管理中心 (Plugin Manager) UI 深度开发指南 (DSH 0.2.0-rc.2)

本文件是 DeepSeek Harness (DSH 0.2.0-rc.2) Web GUI 前端扩展的两大核心界面的权威技术规范：
1. **全局设置窗口 (Settings Modal)**：如何在左侧导航栏添加专属设置项（Tab），并在右侧渲染自定义 React 设置面板；
2. **主导航插件管理中心 (Plugin Manager Page)**：插件卡片在“官方”与“已安装”列表中如何展现、元数据来源以及配置与启用开关机制。

---

## 一、全局设置窗口 (Settings) 架构与 `settings.section` 插槽

在 DSH Web GUI 中，用户按下快捷键 `Cmd/Ctrl + ,` 或点击左侧边栏底部的“齿轮”图标时，会弹出全局设置窗口（Settings Modal）。

该窗口采用经典的“左侧导航项列表 + 右侧内容面板”布局，完全由 Cordis Client 端的 **`settings.section`** 插槽驱动。

### 1. 官方内置 Sections 排序与权重 (Order)
官方核心包按照 `order` 数值从小到大排列左侧导航项：
- `order: 0`：**通用设置** (`id: "general"`，来自 `@deepseek-ai/dsh-client-ui-settings-general`)
- `order: 10`：**模型** (`id: "models"`，来自 `@deepseek-ai/dsh-client-ui-settings-models`)
- `order: 15`：**内置插件** (`id: "plugins"`，来自 `@deepseek-ai/dsh-client-ui-settings-plugins`)
- `order: 20`：**Agent预设** (`id: "presets"`，来自 `@deepseek-ai/dsh-client-ui-settings-agent-loop`)
- `order: 25`：**插件市场** (`id: "market"`，来自 `dshmarket`)

### 2. 第三方插件注入专属 Tab 的核心语法
任何第三方双面插件（Dual-Face Plugin）只需在其客户端入口（`lib/client.js`）的 `apply(ctx)` 中，向 `settings.section` 插槽注入一个注册项：

```jsx
export function apply(ctx) {
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "my-custom-plugin", // 选项卡唯一 ID
        order: 80,              // 建议设置在 50 ~ 500 之间，排在官方内置项之后
        label: () => "我的插件设置", // 侧边栏按钮显示的文本（支持函数或国际化取词）
        locale: "my-plugin-ns"  // 可选：绑定的语言包命名空间
      },
      MySettingsPanel           // 右侧渲染的 React 设置面板组件
    )
  );
}
```

---

## 二、三大明星插件的真实实现源码深度解密

DSH 社区中最著名的三大带界面的插件，正是通过该机制成功在设置栏占据一席之地的：

### 1. dsh-prompt-history（> 终端式输入）
- **左侧导航项效果**：显示为带有终端命令行提示符的 `> 终端式输入`（英文环境显示为 `>_ Terminal Input`），`order: 60`；
- **注册源码**：
  ```js
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "dsh-prompt-history",
        order: 60,
        locale: NS,
        label: () => T("settings.nav") // 动态返回 "终端式输入"
      },
      SettingsSection
    )
  );
  ```
- **图标注入技巧 (Glyph Injection)**：
  官方 Shell 默认对第三方未知的 `id` 统一渲染兜底的“齿轮”图标。为了呈现原生的 `>` 终端提示符，它通过极简的 DOM 补丁挂载了一个专有类名样式，将该项左侧的齿轮图标替换为精致的终端字符。

### 2. dsh-better-sidebar（侧边卡片）
- **左侧导航项效果**：在设置左侧显示 `侧边卡片`，`order: 100`；
- **注册源码**：
  ```js
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "better-sidebar",
        order: 100,
        label: () => t("settingsNav"), // "侧边卡片"
        inject: () => ({ store: sidebarStore, service }) // 向组件传递解耦依赖
      },
      SideCardSection
    )
  );
  ```

### 3. dsh-plugin-wallpaper-engine（壁纸引擎）
- **左侧导航项效果**：在设置左侧显示 `壁纸引擎`，`order: 500`；
- **注册源码**：
  ```js
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "wallpaper-engine",
        order: 500,
        label: () => weT("壁纸引擎")
      },
      () => React.createElement(WallpaperPickerSection)
    )
  );
  ```
- **自绘 SVG 图标替换法**：
  在 `src/nav-icon.js` 中，它监听 DOM 就绪后，精准选中 `div[data-slot="settings.section"]:has([data-section="wallpaper-engine"])`，将默认齿轮平滑替换为壁纸调色盘 SVG。

---

## 三、右侧 React 设置面板的编写与配置持久化

在设置面板中，用户会调节开关、滑动条、输入文本等。如何保存这些配置？有两种经典范式：

### 方案 A：前端本地即时持久化 (适用于即时生效的 UI 偏好)
适用于只影响浏览器端渲染的配置（如主题颜色、复制快捷键、字体大小）。使用 `localStorage` 或 `useSyncExternalStore` 监听，**修改无需重启宿主，0 延迟即时生效**。

```jsx
import React, { useState, useEffect } from 'react';

export function MySettingsPanel() {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem('my_plugin_enabled') === 'true';
  });

  const handleToggle = (checked) => {
    setEnabled(checked);
    localStorage.setItem('my_plugin_enabled', String(checked));
    // 派发自定义事件通知其他客户端组件刷新
    window.dispatchEvent(new Event('my_plugin_config_changed'));
  };

  return (
    <div style={{ padding: '24px', maxWidth: '680px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>我的插件设置</h2>
      <p style={{ color: 'var(--dsw-alias-label-secondary)', marginBottom: '24px' }}>
        在此配置插件的偏好选项，设置保存在当前浏览器中。
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle)' }}>
        <div>
          <div style={{ fontWeight: 500 }}>启用增强功能</div>
          <div style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }}>开启后在主界面显示快捷浮窗</div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
        />
      </div>
    </div>
  );
}
```

### 方案 B：后端配置补丁持久化 (适用于影响 Node 宿主的配置)
若配置项需要传递给 Node.js 宿主（例如 API 密钥、抓取超时、代理地址），必须持久化落盘至 **`cordis.patch.yml`**。
客户端通过调用 Typert Remote 的 `configEditor` 接口提交补丁：

```jsx
// 提交补丁至宿主 cordis.patch.yml
async function saveHostConfig(patchConfig) {
  // 通过官方 api-gateway 提供的 remote 客户端调用
  const result = await window.__DSH_REMOTE__.configEditor.updateProfilePatch({
    id: "my-plugin-id",
    config: patchConfig // 全量替换该插件条目的 config
  });
  if (!result.ok) {
    alert("保存失败: " + result.error.message);
  }
}
```

---

## 四、主导航“插件管理中心” (Plugin Manager) 架构全解

当用户点击主侧边栏的“拼图”积木图标（插件）时，进入的是 **插件管理中心**。

### 1. 界面呈现与分组规则
插件管理中心由 `@deepseek-ai/dsh-client-ui-settings-plugins` 与 `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 联合渲染，分为两大区域：

1. **官方扩展 (8个)**：
   - 包含：**智能体团队 (实验性)**、**自动授权审查 (实验性)**、**自动化任务 (实验性)**、**语音输入 (实验性)**、**终端**、**Agent 循环**、**子智能体**、**网页搜索**；
   - 数据源：来自官方内置包清单（`dsh-plugin-package-inventory-deepseek`），固定作为平台可插拔核心推荐展示。
2. **已安装列表 (已安装 10)**：
   - 包含当前 profile 中已安装的所有第三方组合包（如 Better Sidebar、cfbridge、dsh-context、dsh-plugin-wallpaper-engine、dsh-prompt-history 等）；
   - 数据源：Host 侧服务 `ctx.remote.pluginInventory.list()` 实时扫描当前 profile 目录下的 `package.json`（读取 `dependencies` 与 `dsh.profile.bundles`）。

### 2. 插件卡片元数据读取规范
已安装插件在卡片上展示的各项信息完全来源于插件自身的 `package.json`：
- **卡片标题**：取自 `package.json` 的 `name`（若包内包含 `locale/zh.json`，且声明了 `title`，则展示本土化名称）；
- **卡片描述**：直接读取 `package.json` 中的 **`description`** 字段！
  - *实战技巧*：编写插件时，在 `package.json` 中写一段清晰易懂的中文 `description`，它就会原汁原味地呈现在已安装插件卡片的正文区域；
- **版本号**：取自 `package.json` 的 `version`；
- **启用/禁用 Switch 开关**：
  - 点击开关时，系统会自动在当前 profile 的 `cordis.patch.yml` 中添加或修改：
    ```yaml
    - id: my-plugin-id
      disabled: true  # 禁用
    ```
  - 修改后由 HMR 热重载或下一次重启生效。

---

## 五、开发决策树与最佳实践速查

| 需求场景 | 推荐落点 | 核心 API / 插槽 |
| --- | --- | --- |
| 想要在全局设置窗口左侧加一个专属 Tab，右侧展示独立配置面板 | 设置窗口一级 Tab | `ctx.slots.inject("settings.section", ...)` |
| 想要在现有“内置插件”页面里追加一个子选项卡 | 插件设置二级 Tab | `ctx.slots.inject("settings.plugins.tab", ...)` |
| 想要在通用设置页面里插入一行开关项 | 通用设置插入行 | `ctx.slots.inject("settings.general.item", ...)` |
| 想要让插件在左侧主导航“插件”管理列表中优雅展示 | 组合包元数据声明 | 配置好 `package.json` 的 `name`、`description`、`dsh.bundle` |
