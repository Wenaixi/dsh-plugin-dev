# 浏览器自动化真机验收：browser-harness 实战

> 适用范围：DSH 插件交付前在隔离实例上做真实浏览器验收，尤其是「配置卡逐项点击 + 回读真值」「插件页导航」「控制台干净」这类场景。
> 核心命题：**linter 与静态断言之外，验收必须在真实浏览器里点一遍；browser-harness（CDP 驱动）是比 Playwright 更省事的落地方式，但 Windows 下从 CLI 调它有一串管道与编码的坑要绕。**

---

## 一、browser-harness 是什么、什么时候用

- 本机 Chrome 未开调试端口时：`local Chrome running` 是**没用的**——`browser-harness --doctor` 显示 `active browser connections — 0`，调用会等满 30s 报 `BU_CDP_URL=http://127.0.0.1:9222 unreachable`（连接被拒）。
- 修法：自己拉一个**专用 Chrome**：`--remote-debugging-port=<port> --user-data-dir=<独立目录> --no-first-run --no-default-browser-check about:blank`，然后用 `http://127.0.0.1:<port>/json/version` 确认 200。专用目录与日常浏览器隔离，验完把进程杀干净（`Get-CimInstance Win32_Process` 按命令行过滤 `chrome-automation` 再 Stop-Process）。
- 宿主 DSH 端口不是固定的：实例启动日志打印 `dsh web: http://127.0.0.1:<port>/?token=<TOKEN>`，**每次重启 token 都会换**；URL、token 从日志取，不要写死。

## 二、从 PowerShell 调 browser-harness 的四个坑

1. **heredoc 用不了**：`browser-harness <<'PY'` 在 PowerShell 不是合法语法（ParserError）。把 Python 脚本写进文件，`Get-Content -Raw` 后经管道喂给 `browser-harness`。
2. **脚本里的中文会被管道 UTF-16 破坏**：PowerShell 5.1 管道默认把内容按 UTF-16 编码送出，脚本里的中文字面量到达 Python 时变成乱码继而 `UnicodeEncodeError: surrogates not allowed`。三条对策：
   - 写 Python 脚本时**只放 ASCII**，任何必要的 CJK 字符串用 `\uXXXX` 转义序列写进 JS 表达式；
   - 模块顶 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`；
   - shell 环境 `$env:PYTHONIOENCODING="utf-8"`。
3. **`2>&1` 把 stderr 当错误**：browser-harness 的 traceback 走 stderr，PowerShell 会显示成红色 `NativeCommandError`，但脚本照常跑完、stdout 的 JSON 也在——区分「traceback 在跑之前炸了」和「跑完了只是 stderr 有字」要看 stdout 有没有结果。
4. **tab 会串场**：先前的调用留下的挂接 tab 可能不是你以为的那个（多开实例、弹窗把当前 tab 换掉）。操作前 `list_tabs()` 盘点，按 URL 精确 `switch_tab()` 回自己要的那页。

## 三、驱动的真实能力边界

- `js(...)` 同步 JS 拿结果没问题；**异步 RPC 用 `cdp("Runtime.evaluate", expression=..., awaitPromise=True, returnByValue=True)`**（async IIFE 包 fetch 再 `JSON.stringify`，Python 侧 `json.loads` 解析）。页面内同源 fetch 会自带 cookie，不用手工拼认证。
- 从 `list_tabs()` 返回的 target 字典取 `targetId` 喂 `switch_tab()`；`page_info()` 只报一帧的状态，判断「点了没反应」要接着 `Runtime.evaluate` 读 DOM 或发 RPC，不能只看 page_info。
- 浏览器重启（专用 Chrome 被杀或崩了）会清空所有 tab——重来一遍 `new_tab(带 token URL)` → 点引导模态 → 点插件导航，别以为 tab 还在。

## 四、导航到配置卡的稳定序列

DSH 插件详情页没有独立路由（URL 始终是 `/?token=...`），导航靠点按钮，选择器要点**可稳定锚定的 DOM 属性**而不是页面文本：

1. 点掉引导模态：`[role=dialog]` 里的 button（全新 profile 首次打开必有，遮住整页吞掉所有点击）；
2. 打开插件中心：`button[aria-label="插件"]`；
3. 进详情页：`button[aria-label="查看 <插件显示名>"]`（官方插件行按钮）；
4. 之后每次断言前用 `Runtime.evaluate` 重读 DOM，别用上一次调用的快照。

## 五、断言纪律（真机版）

- **中文文本匹配在中文系统上是乱码**：body 文本会以损坏编码出现在 Python 侧。断言一律走 DOM 属性与 API 回读：
  - 开关：`button[role=switch]` 的 `aria-label`（官方 Switch 的标签）与 `aria-checked`；
  - 单选：`button[role=radio]` 的 `innerText` 前缀 + `aria-checked`；
  - 配置真值：页面内 fetch `settings/describe`（报文见 api-truth-read-back-without-browser.md）取命名空间行的 `value`，**磁盘补丁再对照一遍**。
- 写操作断言链：**点击 → 等一小段（写入是异步的，宿主队列 + 镜像折叠）→ describe 回读 → 磁盘补丁回读**，三段一致才算过。
- 「页面上没有 X 按钮」这类负向断言要**限定卡片容器范围**（如 `.dsh-ph-*`），不要整页扫：会话列表里的旧会话标题可能恰好含目标字样，产生假阳性。
- 每步点击后 `console`/DOM 错误检查：可见错误元素集合（`.dsh-ph-failed`、`[role=alert]`、`[class*=error]`）为空；有失败提示但断言还是过了 = 写入路径有诈。

## 六、快速验收流程模板（隔离实例 + 配置卡）

1. 起实例（后台 job）→ 轮询 HTTP 200（启动要十几秒，等 30~60s 才判定失败）→ 从日志拿 token。
2. 起专用 Chrome（9222 或换端口）。
3. 脚本：`new_tab(token URL)` → 点模态 → 点插件 → 点详情 → 逐项点击 + describe 回读 + 断言。
4. 失败用例不要改脚本重跑全量：先 `Runtime.evaluate` 打印真实 DOM 属性清单定位（`aria-label` 可能带了前缀/后缀），再修选择器。
5. 验完：杀 backend job、杀专用 Chrome、删临时脚本目录，确认 `git status` 干净。

## 相关 DSH 源码

```text
packages/client/ui-plugin-manager  <-  @deepseek-ai/dsh-client-ui-plugin-manager@0.2.0-rc.2
  （插件中心/详情页的按钮 aria-label 形态）
packages/boot/api-settings-controller  <-  @deepseek-ai/dsh-api-settings-controller@0.2.0-rc.2
  （settings/describe 命名空间真值字段）
```