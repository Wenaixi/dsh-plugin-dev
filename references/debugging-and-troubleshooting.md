# DSH 插件本地开发调试回路与高频故障排查宝典

---

## 零、伪 API 与伪归因黑名单

DSH 里有一批「看起来非常合理、但根本不存在」的 API 和「听起来顺理成章、但方向完全错了」的归因。写错时不会报编译错误，也不会在启动时失败，而是静默失效或被误诊为别的问题。下表左两列是凭印象最容易脱口而出的写法与判断，右两列给出 DSH 的真相与一条**可执行的判定动作**。

| 凭印象的写法 / 归因 | DSH 中的真相 | 正确写法 | 可执行的判定动作 |
| --- | --- | --- | --- |
| `ctx.settings.registerTab(...)`、`ctx.ui.addSettingsTab(...)` | 两者都不存在。`ctx.settings` 只把 volatile config 投影成表单描述符并委托 `ctx.configEditor` 落盘，不承担任何界面注册职责 | Client 半侧经 `ctx.slots.inject('settings.section', ...)` 挂载设置区块 | 在插件源码 grep `slots.inject`，命中 0 即说明走错了路径 |
| `ctx.tools.registerTool(...)`、`ctx.toolRegistry` | 都不存在；容器就是 `ctx.tools`，方法名是 `register` | `ctx.tools.register(defineTool({...}))` | 运行时执行 `ctx.tools.schemas()`，按返回的名字查 |
| 直接改 `$DSH_HOME/settings.yaml` 打开某个插件 | 该文件已废弃（不再被直接读取）：SettingsForms 服务在 Loader 就绪后把它**导入一次**到 profile 补丁，首次写入前改名为 `settings.yaml.imported`（**静默失效，零错误信号**）；不要手工编辑它 | 用 `cordis.patch.yml` |mported` 再导入），所以不要手工编辑它 | 一切增删改走 `cordis.patch.yml` | `ls ~/.dsh/profiles/<name>/settings.yaml.imported`（settings 的 legacy 文档在 profile 目录而非 `$DSH_HOME` 根），存在即证明你改的那份早已失效 |
| 「required plugin did not activate」= 依赖没装上 | 这是 Loader **激活图**的语言：某个 required 同伴插件没有 mount。与 `peerDependencies` 是两套独立机制 | 先定位是哪一个 id 没激活，再看它自己为什么没 mount | 启动失败时读终端打印的 `$DSH_HOME/logs/startup-<ISO>-<uuid>.log`（完整诊断落点），它会点名未激活的插件 id |
| 「peer 报错」= 该版本的 peer 区间写错了 | 常常是包管理器解析到了陈旧版本（pnpm 24 小时发布冷却期 + semver 预发布排序），装到的根本不是你要的那个版本 | 先确认实际解析版本，再决定改 peer 还是改解析 | 同一安装命令隔一段时间重跑两次：版本号会随时间前移 = 冷却期指纹；恒定不变才是缓存问题 |
| 「装上了」= 该服务已就绪 | seam 契约包与实现包分离：只装 `dsh-llm` 之类的契约包，服务存在但没有任何提供方 | 契约包 + 实现包成对安装（如 `dsh-llm` + `llm-deepseek`） | `ctx.get('<服务名>')` 返回 `undefined` 即该能力未装配 |
| 「`mcp__<server>__<tool>` 不是 DSH 惯例」 | 判断反了：`mcp__<serverName>__<rawName>` 正是 DSH 官方 `dsh-mcp-client` 的工具命名契约（超 64 字符或含非 `[A-Za-z0-9_-]` 时确定性规范化并追加 12 位哈希） | DSH 工具名见 [tools.md](./tools.md) 的归属表；MCP 工具经 `dsh-mcp-client` 桥接后以 `mcp__` 前缀命名 | `ctx.tools.schemas()` 是唯一权威清单，静态表仅供对照 |
| 「界面没出来 = 组件写错了 / 渲染失败」 | 头号真相是 **`slots.inject(key, cb)` 的 callback 从未执行**——当插槽 spec 不存在（父条目未挂载、名字拼错）时它 `return` 掉，**零报错零日志** | 确认目标插槽确实被某个父条目的 `children` 表声明过；注册前先核对 kind 与 key/id | 在 `apply` 开头与每个注册成功处写全局标记，把「apply 没跑」与「inject 没触发」分开；见 [client-ui-placement-and-verification.md](./client-ui-placement-and-verification.md) |
| 「UI 落点铺得越多越保险」 | 相反——同一面板注册到多个插槽会让它在设置窗口、侧边栏、插件页**同时出现**，属 UI 污染，用户会要求全部回滚 | **一个功能，一个入口**：先按「界面语义 → 插槽」映射表选定唯一落点 | 数 `ctx.slots.inject` 的调用数；加一条反向断言把落点集合锁进白名单 |
| 「插件装上了 = 它生效了」 | `dependencies` 只管**装进来**，`dsh.profile.bundles` 才决定**是否作为补丁层参与组合**。只在前者里的插件完全不生效，且**不报错** | 声明了 `dsh.bundle` 的包会被 `plugin add` 自动加入 bundles；未声明的会被明确警告"installed as a plain dependency" | 安装后立刻检查 `dsh.profile.bundles` 是否含该包；对"装了像没装"的插件先查这里 |
| 「重装/删目录/清状态就能修好缺失文件」 | pnpm 的一致性判断基于 **lockfile 与状态记录**，**不校验已安装文件是否真的存在**；hoisted 布局下 `.pnpm` 只有一个 `lock.yaml`，更无从比对。`install` / `install --force` / 删 `.modules.yaml` **全都报 "Already up to date"** | 从 registry 重新拉 tarball 解包覆盖（最可控）；或整目录删除后用**该运行时自带的 pnpm** 重建 | 修完用 `plugin --profile <name> list` 验证——**报错消失**才算修好，不能只看目录回来了 |

**用法**：写插件或排障时，凡是手上出现「听起来应该有这个 API」的直觉，先在本表查一遍；凡是症状为「静默失效」或「归因指向包管理器」，先按最后一列的判定动作取证，再动手改。

---

## 一、本地极速调试三大工作流回路 (Fast Inner Loops)

编写插件时，**绝不要每次修改都发布到 npm 或打 tarball**，DSH 提供了三种极短的本地联调回路：

### 回路 1：命令行实时补丁覆盖法（推荐！0 侵入）
无需修改当前 profile 的配置，直接在启动命令后通过 `--patch` 挂载你正在编写的插件补丁：
```bash
# 启动 Web 宿主并临时叠加本地插件补丁
dsh --profile <name> --patch <本地插件目录>/cordis.patch.yml
```
- 退出进程后系统恢复原样，零污染；
- 每次修改代码后只需重启宿主即可立即看到变更。

### 回路 2：本地相对路径添加法（持久联调）
在测试用的 profile 中直接将本地目录添加为 bundle：
```bash
dsh plugin --profile <name> add <本地插件目录>
```
- 该命令会自动将本地路径加入 profile 的 `package.json` 中（以 `file:` 协议软链）；
- 插件源码修改后，Node 侧重启即生效，浏览器端配合 HMR 自动刷新。

### 回路 3：单机沙盒临时环境验证（安全隔离）
为了防止搞坏正在使用的日常 profile，可以通过重定向 `DSH_HOME` 启动完全隔离的测试环境：
```powershell
# PowerShell 环境下重定向至临时目录
$env:DSH_HOME = "<临时目录>"
dsh plugin --profile test-env add ./my-plugin
dsh --profile test-env
```

---

## 二、双面 UI 插件前端排查技巧

若你编写了带界面的插件（Dual-Face），而在浏览器控制台或设置窗口中没有看到对应的界面，请按以下顺序在浏览器 DevTools 中排查：

### 1. 检查引导清单 (`window.__DSH_BOOT__`)
在浏览器控制台输入：
```js
console.log(window.__DSH_BOOT__.entries)  // wire 字段为 rev / entries[{id,url,rev,inject,external}] / batches
```
- **排查点**：在 `entries` 里找你的插件包名（如 `dsh-my-plugin`）；`window.__DSH_BOOT__.clientModules` 是伪字段（`clientModules` 是 Node 半侧服务名，浏览器侧不存在）；
- **若没有**：说明 Host 宿主端的 Loader 并没有激活该插件的 `dsh.client`，请检查 `package.json` 是否遗漏了 `dsh.client: { platform: "web" }` 声明。

### 2. 检查模块加载器状态 (`window.__ModuleLoader__`)
在控制台输入：
```js
// window.__ModuleLoader__ 的 facade 只有 create/load，没有公开的 entries 成员；
// 排查组合面用 Network 面板看 bundle 请求，或检查返回的 modules 实例
```
- **排查点**：查看你的插件客户端 bundle 是否已注册（`window.__ModuleLoader__.entries` 无此公开成员）；
- **排查 Combo 请求**：切换到 Network（网络）标签页，查看形如 `/plugins/??<id>/client.js&rev=...` 的批量加载请求是否返回了 200。若返回 404，检查 `package.json` 的 `exports["./client"]` 路径是否指向了真实存在的物理打包文件。

### 3. 客户端半侧的三种致命形态错误

Browser 半侧被包在 `window.__ModuleLoader__.load({ id, factory })` 里，**外层是 CJS factory 闭包**。这个约束决定了下面三条，任何一条写错都表现为 `Failed to load plugins` 且控制台只给一句含糊的 import 错误：

| 写错的形态 | 报错 | 为什么错 |
| :--- | :--- | :--- |
| factory 内写 ESM `import React from 'react'` | `Cannot use import statement outside a module` | 整段代码被当 CJS 脚本求值，没有 ESM 上下文。依赖一律 `require('react')` |
| factory 外写 `return module.exports` | `Illegal return statement` | 外层不是函数。factory 内部才能 `return`，且必须以 `return module.exports` 收尾 |
| 用 JSX 写组件 | 语法错误 | factory 内没有 JSX 编译。用 `React.createElement`（可简写为 `const e = React.createElement`） |

正确骨架（这是唯一被官方加载器接受的形态）：

```js
window.__ModuleLoader__.load({
  id: "@scope/my-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const e = React.createElement;

    function Widget() {
      return e("div", null, "内容");
    }

    function apply(ctx) {
      ctx.slots.inject("plugins.bundle.config", () =>
        ctx.slots.register({ name: "plugins.bundle.config", key: "@scope/my-plugin" }, Widget)
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
```

可对照的社区实现（非 `@deepseek-ai` 官方发布，如某侧边栏增强、某壁纸引擎、某 git 图插件）。

### 4. 同一个界面渲染出两份

同一个组件注册到多个插槽、或同一个插槽被两个插件各注册一次时，用户会看到**完全相同的两块面板**。

判定动作（不要靠猜，直接数 DOM）：

```js
// DevTools 控制台：数目标面板元素个数，应恰好为 1
document.querySelectorAll("text-content 片段")  // 换成你的面板文案
// 更可靠：在组件根节点上加 data 属性后统计
document.querySelectorAll("[data-my-plugin-panel]").length
```

逐个 `ctx.slots.register` 检查：删除冗余注册，只保留一个入口。特别注意 `plugins.bundle.config`（插件卡片详情内嵌）与 `plugins.detail.section`（详情页扩展区）语义高度重叠，**同一面板不要同时注册这两处**。

### 5. Host 路由注册的两处静默失败

`ctx.webServer.register` 的契约（来自 `@deepseek-ai/dsh-host-webserver` 类型声明）：

```ts
interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req, res) => void | Promise<void>   // 属性名是 handler，不是 handle
}
```

| 症状 | 根因 | 修法 |
| :--- | :--- | :--- |
| 插件已激活但接口一律 404 | 把 `handler` 写成了 `handle`，注册被静默接受但从未挂上回调 | 改为 `handler` |
| 启动即抛 `cannot get property "webServer" without inject` | 未在 `export const inject` 中声明 `webServer` | `export const inject = ['webServer', ...] as const` |

注册必须包在 `ctx.effect` 里返回清理函数，否则插件卸载后路由残留：

```ts
ctx.effect(() => {
  ctx.logger.info('[my-plugin] 路由就绪: /api/plugins/my-plugin/config')
  return ctx.webServer.register({ kind: 'exact', path: '/api/plugins/my-plugin/config', handler })
}, 'my-plugin: web route')
```

---

## 三、Top 9 高频故障排查速查表 (Troubleshooting Matrix)

| 故障现象 | 致命根因 | 官方权威解药 |
| :--- | :--- | :--- |
| **1. 插件卡在 PENDING，apply() 根本不执行** | `inject` 数组中声明的服务在当前 profile 中不存在或未被提供 | 检查 `export const inject = [...]`。若依赖是可选的，**严禁写进 inject**，改用在函数体内部用 `ctx.get('serviceName')` 动态探测。 |
| **2. 修改了配置项，但其他配置全部丢失了** | 违反了补丁系统的**全量替换 (Wholesale Replacement)** 规则 | 补丁覆盖是整体替换而非深合并！在 `cordis.patch.yml` 中重写某个配置时，必须把该插件在该层所需的完整字段一次性提供全。 |
| **3. 设置窗口左侧没有显示专属 Tab** | 1. 缺少双面导出；<br>2. 组件接收了 ctx 抛异常；<br>3. 忘记调 `slots.inject` | 1. 确保 `package.json` 有 `exports["./client"]`；<br>2. 确保在 `lib/client.js` 中调用 `ctx.slots.inject("settings.section", ...)`；<br>3. 检查控制台是否有报错。 |
| **4. 页面报错 "Cannot read property of undefined (ctx)"** | 违背了 **“React 组件绝不能接收 ctx”** 核心铁律 | 宿主插槽容器渲染组件时不会注入 ctx。组件需要的数据与回调必须通过纯 Props 或前端自定义 Hook 传递。 |
| **5. 运行 npm install 报 ERESOLVE 冲突** | 与 DSH 安装链无关：`dsh plugin` 全链路转发 **pnpm**（dsh/bin.js → plugin 命令 → dsh-plugin-manager），npm/ERESOLVE 不在链路内 | 官方链路只用 `dsh plugin --profile <name> add/install`；确需宽松策略用 workspace 配置（如 noStrictPeerDependencies） |fund`。 |
| **6. 启动报错 "1 required plugin did not activate"** | 盲目相信了 `--dump-config`，实际存在缺包或版本 peer 拦截 | `--dump-config` 不加载插件代码！读宿主启动日志（`$DSH_HOME/logs/startup-*.log` 的 inspect 报告或终端 `dsh: disabling profile plugin <id>: <reason>` 行）定位被兼容性闸门拒绝的插件，再用 `allow-version` 豁免或安装缺失插件。 |
| **7. 执行系统命令报注入或权限错误** | 试图拼接 shell 字符串并传给 `ctx.subprocess.spawn` | DSH 的子进程生成参数 **严格零 Shell 解释**！必须传入扁平的 `argv` 数组（如 `['git', 'status', '-s']`），绝不要传 `'sh -c "..."'`。 |
| **8. Typert Remote 方法调用报 AST 语法错误** | 远程暴露的方法签名中使用了对象解构或默认参数值 | 远程方法签名必须严格遵守规则：单一名命参数对象，禁止解构，禁止默认值，协作中断 `signal` 必须为末位参数。 |
| **9. 装插件时解析到过时的旧版本，随后报 incompatible** | **不是** peer 范围写错，而是**包管理器解析到了旧版本**：pnpm v11+ 默认 `minimumReleaseAge: 1440`（24 小时发布冷却期）把刚发布的新版本排除，叠加 `-tag.N` 预发布后缀被 semver 默认排除，解析一路回退到最老的合格版本，其 peer 锁在旧 DSH 契约上 | 先看 `~/.dsh/profiles/<profile>/.plugin-manager/logs/` 最新 `pnpm.log` 确认解析版本 → registry `dist-tags` 拿真实 latest → 比对宿主实装版本与该版本 peer 区间。修复：profile 的 `pnpm-workspace.yaml` 加 `minimumReleaseAge: 0`，或改用精确版本 `pkg@<version>`（精确 spec 绕过冷却期）。**清缓存无效，别浪费时间**。完整推导与复现实验见 [install-resolution-traps.md](./install-resolution-traps.md)。 |

---

## 四、日志记录与健康诊断

在插件编写过程中，输出规范的日志有助于精准定位问题：

### 1. 插件内部日志记录规范
使用 `ctx.logger` 为插件创建专属命名空间的日志记录器：
```js
export function apply(ctx) {
  const logger = ctx.logger('my-plugin');

  logger.info('插件已成功启动');
  logger.warn('检测到可选服务未加载，将降级运行');
  logger.debug('详细调试数据:', { foo: 'bar' });
  logger.error('遇到严重异常:', new Error('something went wrong'));
}
```

### 2. 宿主核心日志落盘位置
若 DSH 宿主启动崩溃或静默退出，官方唯一的结构化故障落点是 **`$DSH_HOME/logs/startup-<ISO>-<uuid>.log`**（`dsh` 的 `reportStartupFailure` 写入，含完整 inspect 报告、profile/版本/node 平台信息，终端会打印 `Full diagnostics: <path>`）。
`~/.dsh/profiles/<profile>/cfg.log` / `cfg.err` **没有任何官方写入者**（grep 全库 0 命中）；实测中它们或为空、或只是 `--dump-config` 残留——不要拿它们当诊断入口。
---

## 五、插件安装失败的排障入口与决策路径

安装类失败的**第一现场**永远是 profile 的插件管理器日志目录，它完整记录了「解析到哪个版本 → pnpm 是否成功 → 兼容性闸门是否介入」三段信息：

```text
~/.dsh/profiles/<profile>/.plugin-manager/logs/operation-*/pnpm.log
```

按此顺序判定，不要跳步：

1. **确认解析版本**：读最新 `pnpm.log`，看 `dependencies:` 段落里 `+ <pkg> <version>` 的实际版本号。
2. **对比 registry 真值**：`npm view <pkg> dist-tags --json` 与 `npm view <pkg> versions --json`。若 registry 的 latest 远高于解析结果，说明是解析策略问题而非网络问题。
3. **判定是否冷却期**：把 `minimum-release-age` 调成 0 重跑一次，若立刻拿到正确版本即坐实（详见 [install-resolution-traps.md](./install-resolution-traps.md)）。
4. **判定是否预发布排序**：`node -e "const s=require('semver');console.log(s.maxSatisfying(process.argv.slice(1),'*'))" <所有版本>`，若返回的是旧正式版而非新的预发布版，即 semver 默认排除 prerelease。
5. **核对 peer 区间**：比对宿主实际安装的核心包版本（如 `@deepseek-ai/dsh-skill`）与该插件版本 `peerDependencies` 的区间，确认是否真的落在区间外。
6. **最后才考虑豁免**：`allow-version` 绕过的是防崩溃闸门，优先修版本选择。

**横向对比是最快的隔离手段**：`npm install <pkg> --dry-run` 与 `pnpm add <pkg> --lockfile-only` 结果不同，就锁定为 pnpm 侧行为（冷却期或预发布排序），与网络、缓存均无关。

### profile 专属边界

- `dsh plugin --profile desktop ...` 会直接报 `profile "desktop" is managed exclusively by the Electron application`。该 profile 的包清单、锁文件与工作区配置只能改 Electron 应用界面，CLI 无效；但其内部安装走同一条 pnpm 链路，工作区配置同样生效。

---

## 六、免启动反证法：直接调宿主的公开函数

DSH 的宿主包大量导出**纯读取、不需要启动 Web GUI** 的公开函数。遇到「界面没出来 / 文案没生效 / 卡片空白」这类问题时，先直接调它拿真值，比启服务 + 拿 token + 抓 Cookie 快两个数量级。

### 1. 典型可用入口

| 公开函数 | 所在包 | 回答什么问题 |
| --- | --- | --- |
| `readPluginMeta(spec, parentURL)` | `@deepseek-ai/dsh-app-boot` | 卡片标题 / 描述 / 图标能不能读到 |
| `resolveBundleDir(bin, name, installAnchor, profileDir)` | `@deepseek-ai/dsh-app-boot` | 某个 bundle 从哪个目录解析 |
| `bundleManifest(name, dir, anchor)` | `@deepseek-ai/dsh-plugin-manager/operations`（dsh-app-boot 仅内部定义未导出） | 该 bundle 的 manifest 与 `dsh.bundle` 声明 |
| `resolveDshHome()` | `@deepseek-ai/dsh-home-paths`（`dsh-plugin-manager` 等使用方） | 当前配置数据根算出来是哪个 |

### 2. 跨平台调用的两个坑

- **必须 `pathToFileURL`**：Windows 上 `import('C:/.../lib/index.js')` 直接抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（协议 `c:` 不被默认 ESM 加载器接受）。正确写法：
  ```js
  const boot = await import(pathToFileURL(dshPkg + '/lib/index.js').href)
  ```
- **parentURL 要指向包自己的 package.json**，不是任意基准：
  ```js
  const meta = boot.readPluginMeta(pkgName, pathToFileURL(join(pkgDir, 'package.json')).href)
  ```

### 3. 复制粘贴可跑的对照探针

写一个循环把「有描述的包」和「没描述的包」都过一遍，差异一眼可见：

```js
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const boot = await import(pathToFileURL(dshAppBoot + '/lib/index.js').href)
const nm = profileDir + '/node_modules/'
for (const [spec, dir] of [
  ['your/pkg',        nm + '@scope/your-pkg'],
  ['known-good/pkg',  nm + 'known-good-pkg'],   // 挑一个确定有描述的做对照
]) {
  const m = boot.readPluginMeta(spec, pathToFileURL(join(dir, 'package.json')).href)
  console.log(spec, '=>', m === undefined ? 'NO METADATA' : JSON.stringify(m.title))
}
```

期望输出里「NO METADATA」的那一行就是待查对象；两者都不是 undefined 但只有 good 那个有 `description` 时，差异在 locale 与 manifest description 的兜底链上。

### 4. 打包内容也要单独验证

`files` 字段写错不会让开发环境报错，只有发布后才消失。发布前用 dry-run 看真实入库清单：

```bash
npm pack --dry-run --json    # 逐条断言 locale/、icon、lib/ 都在 files 列表里
```

---

## 七、插件管理器目录与安装日志落点

每个 profile 就是一个独立 pnpm 项目，目录结构与用途：

```text
~/.dsh/profiles/<name>/
  package.json           # 依赖清单 + dsh.profile.bundles（由插件管理器维护）
  pnpm-lock.yaml         # 锁文件
  pnpm-workspace.yaml    # pnpm 工作区配置（nodeLinker / autoInstallPeers / minimumReleaseAge）
  cordis.patch.yml       # 该 profile 的配置补丁层
  cordis.yml             # 组合后配置
  compatibility.json     # 精确版本豁免表，默认不存在（读取语义视为 {}，首次 allow-version 才生成）
  .plugin-manager/logs/  # 每次安装/卸载的 pnpm 原始输出（operation-*/ 子目录）；启动黑匣子日志在宿主日志目录（logs/），cfg.log/cfg.err 并非每个 profile 都有
  compatibility.json     # 精确版本豁免表（**首次执行 allow-version 后才生成**，默认不存在）
```

完整目录语义、`minimumReleaseAge: 0` 配置片段、BOM/CRLF 写入陷阱与排障决策表见 [install-resolution-traps.md](./install-resolution-traps.md)。
