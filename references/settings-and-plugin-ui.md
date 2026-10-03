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

卡片信息由宿主 `readPluginMeta`（`@deepseek-ai/dsh-app-boot/lib/index.js`）读取，它把两个子路径交给 Node 的 exports 解析：

```
${specifier}/package.json
${specifier}/locale/en.json
```

**任一子路径不在包的 `exports` 白名单里，Node 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，该异常被宿主吞掉后返回 `undefined`——卡片上就只剩一个包名，标题、描述、图标全空，而且没有任何报错。**

这是最容易踩的一个坑：包明明装好了、插件也在跑，卡片却像没写 manifest。

最小修法（`exports` 一旦声明就变成严格白名单，必须显式放行子路径）：

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["lib", "locale", "assets/icon.png"],
  "dsh": { "bundle": { "id": "my-plugin" }, "client": { "platform": "web" } }
}
```

同时在包内提供 `locale/en.json` 与 `locale/zh.json`：

```json
{ "meta": { "title": "...", "description": "..." } }
```

字段与取值：

| 卡片元素 | 来源 | 备注 |
| :--- | :--- | :--- |
| 标题 | `locale/{en,zh}.json` 的 `meta.title`，缺失回退 `name` | 有 locale 就能中英双语 |
| 描述 | `locale/{en,zh}.json` 的 `meta.description`，缺失回退 manifest `description` | 官方包的 manifest `description` 一律写英文长句，中文请放 locale |
| 图标 | manifest 的 `icon` 字段 | **必须是包内相对路径的 svg/png/jpg/webp，且 <= 256 KiB**，超限报 `icon exceeds 256 KiB` |
| 版本号 | `package.json` 的 `version` | |
| 启用/禁用开关 | 由宿主改写 profile 的 `cordis.patch.yml` | |

```yaml
# 宿主自动写入的内容
- id: my-plugin-id
  disabled: true  # 禁用
```

修改后由 HMR 热重载或下一次重启生效。

对照反证：没有声明 `exports` 的包走 Node 的 legacy 目录查找，反而能正常读到 manifest——所以**"加 exports 之后描述反而没了"是这类包最典型的回归**。

图标的字节上限来自 `MAX_ICON_BYTES = 256 * 1024`（`dsh-app-boot` 源码常量），同一函数还会校验：必须是包内相对路径（绝对路径、带协议头、逃出 manifest 目录的路径全部拒绝），后缀必须是 svg/png/jpg/jpeg/webp，且必须是普通文件。README 用的 `logo.png` 往往远超 256 KiB，**不能直接复用做 `icon`**，另存一份小尺寸副本。
#### 图标的渲染契约（决定你的文件该长什么样）

宿主把图标按固定尺寸渲染（卡片一档、列表行一档，都是几十像素量级的常量），CSS 只给 `object-fit: contain`，**不做圆角裁剪**——圆角与描边在外层容器上。

| 要求 | 原因 | 违反后的现象 |
| :--- | :--- | :--- |
| **图标文件必须真透明底** | 容器已经有圆角与描边，图标自带白底会形成「白方块压在圆角容器上」的双层边缘 | 卡片上多出一圈方角白边，深色主题下尤其刺眼 |
| **图标文件不该自带圆角** | 圆角由容器负责 | 四角出现两层不同半径的圆 |
| **主体要留足边距** | 小尺寸下没有留白余地，图形贴边会显得溢出 | 视觉上比旁边的官方图标大一圈 |

生成 PNG 后务必做**逐像素去背**（按亮度阈值把背景像素的 alpha 置 0）。只改 alpha 通道是不够的——透明区域里残留的白色像素同样会显影。

**深浅色都要可读**：深色描边或深色实心填充的图标在 `body[data-ds-dark-theme]` 下几乎不可见。稳妥做法是取宿主同族的中等明度色（例如官方插件图标使用的那组蓝色渐变），浅底深底都不糊。

**只画线稿不代表可控**：暗色主题下深色线稿同样不可见。严格随主题需要 inline SVG 配 `currentColor`，但仅在宿主以 inline 方式渲染时成立；PNG 场景下选中明度适中的主色更可靠。

**验收动作**：装好后看插件页卡片里那个 `img` 是不是你的图，而不是回落到默认占位图；同时读 `img.naturalWidth > 0` 与实际渲染尺寸。

### 3. 改完必须跑的两道验证

`files` 字段写错在开发环境完全无感（本地包是完整目录），只有发布后才消失。两道验证各自堵一个漏洞：

```bash
# 1. 打包清单：locale/、icon 是否真的进 npm 包
npm pack --dry-run --json
```

```js
// 2. 宿主读不读得到：直接调公开函数，免启动、免 token
const meta = readPluginMeta(pkgName, pathToFileURL(join(pkgDir, 'package.json')).href)
// 期望：title/description 为 { en, zh } 或字符串，icon 以 data:image/ 开头，error 为 none
```

宿主读不到时会返回 `undefined`（不是抛错、不是空对象），排查时先判 `undefined` 再看内容。完整探针脚本与跨平台调用坑见 [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md) 第六节。

---

## 五、开发决策树与最佳实践速查

| 需求场景 | 推荐落点 | 核心 API / 插槽 |
| --- | --- | --- |
| 想要在全局设置窗口左侧加一个专属 Tab，右侧展示独立配置面板 | 设置窗口一级 Tab | `ctx.slots.inject("settings.section", ...)` |
| 想要在现有“内置插件”页面里追加一个子选项卡 | 插件设置二级 Tab | `ctx.slots.inject("settings.plugins.tab", ...)` |
| 想要在通用设置页面里插入一行开关项 | 通用设置插入行 | `ctx.slots.inject("settings.general.item", ...)` |
| 想要让插件在左侧主导航“插件”管理列表中优雅展示 | 组合包元数据声明 | 配置好 `package.json` 的 `name`、`description`、`dsh.bundle` |
| 想要让配置面板直接出现在**已安装插件的卡片详情里**（最贴近用户预期的落点） | 插件卡片配置插槽 | `ctx.slots.inject("plugins.bundle.config", ...)`，`key` 用包名 |
| 想要在设置面板里放分段选择器 / 开关 / 状态点 / 标签 | 官方 primitives | `require("@deepseek-ai/dsh-client-ui-primitives")`，见 [web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md) 第 4 节 |

`plugins.bundle.config` 的注册形态（`key` 必须是**包名**，容器按包名匹配）：

```js
function apply(ctx) {
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      { name: "plugins.bundle.config", key: "@scope/my-plugin" },
      MyConfigPanel
    )
  )
}
```

**同一块面板不要同时注册 `plugins.bundle.config` 与 `plugins.detail.section`**——两者都在插件详情页渲染，会出现两块一模一样的面板。判定方法见 [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md) 第 4 节。
