# 隔离新实例验收：冷装、热装、卸载与浏览器逐项验证

> 适用范围：插件开发完成后的交付验收，尤其是双面 UI 插件、带配置的插件、要发布到 npm 的组合包。
> 核心命题：**在自己的日常 profile 里能跑，不构成验收。** 验收必须在只装了基础插件和你这一个插件的全新实例上做，并且必须在真实浏览器里点一遍。

---

## 零、为什么必须开新实例

日常 profile 装了几十个插件，它的 bundle 树、配置补丁、凭据、HMR 状态都是历史积累的。在它上面验证会遇到三类假阳性：

| 假阳性 | 表现 | 只有新实例才能暴露的原因 |
| --- | --- | --- |
| 依赖被邻居提供 | 你的插件注入某个服务成功，但 profile 里另一个插件恰好提供了它 | 新实例只有基础插件，没人替你满足契约 |
| 配置被覆盖 | 你的配置生效了，但其实是 profile 的补丁层覆盖了它 | 新实例的配置来源单一，可追溯 |
| 缓存与长缓存 | 界面看着是新的，其实命中了标记为不可变的旧产物 | 新实例没有陈旧缓存 |

反过来，新实例也会暴露三类日常 profile 掩盖的问题：缺依赖导致 apply 永不执行、产物漏件、安装链解析到错误版本。

---

## 一、创建隔离实例

每个 profile 就是一个独立目录的独立 pnpm 项目。创建方式：

```bash
# 从官方模板派生（推荐，拿到完整的 bundle 树与预设）
dsh <新实例名> --from-default-profile web
```

实例名不要用会被宿主独占的名字：desktop 这个名字在 CLI 里被硬拒绝（源码里的 rejectElectronProfile 对它直接失败），且该 profile 由 Electron 应用独占管理。用带日期或语义的名字，便于事后清理。

### 复用已有实例的配置

新实例默认干净，需要显式复用配置。三种来源都可以：

| 来源 | 怎么读 | 注意 |
| --- | --- | --- |
| Web 或 CLI 实例 | dsshome 下该 profile 目录 | 结构与 CLI 完全一致，最适合直接复用 |
| 桌面版实例 | 同路径下的 desktop | CLI 对它的 dump 与 boot 被拒，但 plugin 列表与增删仍可用；改文件前先完全退出桌面应用 |
| 本机其他任意实例 | 同上 | 只复用你需要的那几项，不要整体覆盖 |
**只追加，不覆盖（注意 YAML 顶层语法冲突）。**

1. 先备份目标实例的 package.json、cordis.patch.yml、pnpm-lock.yaml、pnpm-workspace.yaml；
2. **严防空数组顶层冲突陷阱**：从官方模板派生（`--from-default-profile`）生成的 `cordis.patch.yml` 默认内容往往是一个孤立的空数组 `[]`。若直接往末尾盲目追加（append）条目 `- id: ...`，会导致文件内出现两个独立的顶层 YAML 结构（一个已完结的 flow-sequence 后面跟着 block-sequence），宿主 `loadOverlayPatches` 时必抛：
   `YAMLException: end of the stream or a document separator is expected`！
   **标准做法**：检测文件若仅包含 `[]`，必须**整体覆写**为合法的顶级列表，或在解析为数组对象后再写回，绝不可盲目字符串追加；
3. 按条目 id 求差集，只把源里缺的条目追加到列表末尾，并加显式分界注释标明来源与日期；
4. 同名条目保留字段更完整的那份，不要盲目覆盖；
5. 变更后做 YAML 解析校验，再用目标运行时的 dump-config 命令确认零报错。
新实例建好后，插件清单里只应保留两类：

1. **基础插件**：你的插件真正必需的那些运行时能力（例如浏览器界面所需的行、你要注入的服务提供者）。判定标准是读源码确认的注入列表，不是凭感觉。
2. **你的插件**：本地开发时用本地路径挂载，不要先发到 npm。

```bash
dsh plugin --profile <实例名> add <本地插件目录>
```

装完立刻检查 package.json 的 profile bundles 是否含该包——**dependencies 只管装进来，bundles 才决定是否作为补丁层参与组合**。只在前者里的插件完全不生效，且零报错。

### 本地源码联调：手工建直通目录联接，坚决避免 `pnpm install`（The pnpm Store Snapshot Trap）

在隔离实例里调试本地未发布的源码时，若执行 `dsh plugin add <本地目录>` 或在 profile 目录下运行 `pnpm add <本地目录>` / `pnpm install`，会掉入极其隐蔽的 **pnpm 存储池快照陷阱**：

#### 1. 陷阱机理：虚拟存储池与静态快照隔离
- pnpm 的安装机制会将本地路径依赖解析并深层建立硬链接至 `.pnpm/<包名>@<哈希>/node_modules/<包名>` 虚拟存储池中；
- 隔离实例 `node_modules/<包名>` 最终链接到的是这个 `.pnpm` 实体副本，而不是你的工作区开发根目录；
- 当开发者在源码中修改逻辑并重新执行 `npm run build` 后，最新的 `lib/` 产物落盘在工作区，但 `.pnpm` 虚拟池内的文件**从未被更新**；
- 宿主加载器在静态分发时读取该副本计算 `rev`（基于 mtime/size），由于副本文件未动，`rev` 恒定不变，浏览器永远命中山寨长缓存；
- 表现为：**源码改了、编译过了、控制台无报错，但宿主和界面永远运行旧代码**！排查成本极高，极易被误判为宿主核心有 bug 或代码逻辑失效。

#### 2. 标准直通解法：手工建立工作区直通联接
坚决**跳过 `pnpm install`**，直接手工建立物理直通开发工作区根目录的目录联接：

1. **配置文件就绪**：
   - `package.json` 中的 `dependencies` 配置 `"<包名>": "file:<开发工程绝对路径>"`；
   - `dsh.profile.bundles` 数组中追加该包名，确保作为补丁层参与宿主组合。
2. **手工创建目录联接**：
   - 确保创建父目录（例如 scoped 包需要 `mkdir -p node_modules/@scope`）；
   - Windows 系统使用 Junction 目录联接：
     ```powershell
     cmd /c mklink /J "<profile路径>\node_modules\@scope\<包名>" "<开发工程绝对路径>"
     ```
   - 类 Unix 系统使用绝对路径符号链接：
     ```bash
     ln -s "<开发工程绝对路径>" "<profile路径>/node_modules/@scope/<包名>"
     ```
3. **双向核验联接真源**：
   - 验证联接必须直通开发工作区根目录，绝不允许包含 `.pnpm` 字符串：
     ```powershell
     # Windows 校验目标
     (Get-Item "<profile路径>\node_modules\@scope\<包名>").Target
     # 预期输出：D:\path\to\your\workspace
     ```
   - 改动源码后仅需在工作区运行 `npm run build`，产物立刻在宿主端就地生效；重启宿主后浏览器强刷即可加载最新逻辑。

### 配置文件生成：Windows PowerShell UTF-8 BOM 诱发 Node.js 引导崩溃陷阱 (The UTF-8 BOM Trap)

在 Windows 环境下编写自动化脚本创建或修改隔离实例的 `package.json`、`cordis.patch.yml` 时，存在隐蔽的 BOM 编码陷阱：

#### 1. 陷阱机理：PowerShell 默认 UTF-8 BOM 与 Node.js 严格规范冲突
- Windows PowerShell 5.1/7.x 的 `Out-File -Encoding utf8` 或 `Set-Content` 默认会在文件开头写入 3 个字节的 UTF-8 字节序标记 BOM（`\uFEFF`，十六进制 `EF BB BF`）；
- DSH 宿主引导器（`dsh-app-boot` 中的 `readProfileManifest`）读取 `package.json` 后直接调用 Node.js 原生 `JSON.parse(content)`；
- 根据 JSON 工业规范（RFC 8259），标准 JSON 严禁携带任何 BOM。Node.js 遇到开头的 `\uFEFF` 会立即抛出致命语法崩溃：
  ```text

### 零端口无感装配与 Schema 校验闭环（Headless Verification via `--dump-config`）

在启动完整的 Web GUI 服务或消耗模型额度进行浏览器自动化之前，必须优先使用 DSH 提供的无感配置合成探针：

```bash
dsh --profile <实例名> --dump-config
```

#### 1. 为什么它是最快且最硬核的第一道防线
- **完整经历宿主引导生命周期**：它会在进程内部依次执行 Profile 加载、`bundles` 树合成、`peerDependencies` 与 `engines.dsh` 版本兼容性语义闸门判定、`cordis.patch.yml` 补丁注入、Schemastery 跨端 Schema 校验、以及 Volatile 引用解析；
- **零端口占用、零网络监听**：完全不需要占用 3080/8080 等网络端口，不与任何正在运行的生产实例抢占端口；
- **零 Token 消耗、毫秒级反馈**：在不消耗任何大模型额度、不依赖任何浏览器驱动的情况下，在 1 秒内完成底层全部契约体检；
- **可失败性保证**：若存在 YAML 语法错误、`peerDependencies` 版本冲突导致 bundle 被跳过（`skipping profile bundle`）、或配置不满足 Schema，命令退出码立即为 1 并在 stderr 输出精确堆栈；成功时退出码为 0，并在 stdout 打印带有 `# == <包名>` 分界注释的最终组合配置树；
- **真机判据**：退出码为 0 且在输出中检索到 `# == <包名>` 与预期的配置键值，才证明插件在宿主加载器中真正冷装成功。
  SyntaxError: Unexpected token '﻿', "﻿{... is not valid JSON
      at JSON.parse (<anonymous>)
      at readProfileManifest (...)
      at loadProfile (...)
  ```
- **后果**：整个 CLI 启动流程在引导首步瞬间中断退出码 1，开发者常误判为 JSON 内容缩进或括号错误。

#### 2. 标准无 BOM 写入规范
在自动化脚本中生成任何 JSON/YAML 配置文件时，**严禁使用默认的 `Out-File -Encoding utf8`**。必须采用严格无 BOM 的 UTF-8 写入：
```powershell
# Windows PowerShell 原生无 BOM 安全写入
[System.IO.File]::WriteAllText($path, $jsonContent, [System.Text.UTF8Encoding]::new($false))
```
或通过 Node.js 一行命令执行写入：
```bash
node -e "require('node:fs').writeFileSync(process.argv[1], process.argv[2], 'utf8')" "$path" "$jsonContent"
```

---

## 二、模型必须问用户，不能自己决定

验收要真实驱动界面与工具链，**每一步都在消耗模型额度**。选哪个模型、用哪家的额度、要不要花钱，都是用户的事，不是你的事。

在开始浏览器验证之前，**必须**通过结构化提问拿到：

- 用哪个模型；
- 有没有额度或费用偏好；
- 是否允许产生费用，以及大致预算边界。

同时**主动建议用户选便宜的模型**：本专题验证的是点得动、读得回真值、装得对、卸得干净，不需要强推理能力。用贵的模型跑点击验证是纯浪费。提问时把这个理由讲清楚，用户通常会同意。

**禁止**：自己挑一个所谓默认模型就开始跑；先烧钱再事后告知。

---

## 三、四种安装形态必须各测一遍

| 形态 | 怎么做 | 验什么 |
| --- | --- | --- |
| 冷安装 | 实例建好、首次启动前装插件 | 全新安装链是否解析到正确版本；bundle 树是否正确组合 |
| 热安装 | 实例已经在跑、界面已打开，再装插件 | 是否免重启生效；界面是否自动刷新 |
| 热更新 | 已装的插件换新版本或本地代码后重装 | 版本号与界面是否同步更新（两者不同步会产生版本已变、界面还是旧的假象） |
| 卸载 | 从运行中的实例卸载插件 | 界面元素是否消失；宿主侧资源是否全部释放；配置残留是否影响下次启动 |

### 热安装的判据要读源码，不要猜

插件管理器返回的应用状态是明确的几态之一（读插件管理器 change 方法的实现）：

```text
applied           已就地应用，无需重启
restart-required 磁盘已改，但必须重启宿主才生效
cancelled         操作被取消
failed            失败，带可读错误
```

它还会派发变更通知事件，用它作为状态确实变化的观测点

注意一个结构性细节：安装类操作会在文件锁内串行化，并在有 HMR 服务时借它的排他区执行；**没有 HMR 服务的组合里，任何应用动作都不会发生**，一律走 restart-required。

### 热安装验收的三大常见假死与深层机制

#### 1. Chokidar 写入防抖期（awaitWriteFinish 2秒延迟）
宿主 `dsh-hmr` 监听 `package.json` 与 `cordis.patch.yml` 时配置了 `awaitWriteFinish: true`（通常阈值 2000ms）。
- **常见误区**：在后台宿主运行中，CLI 安装命令刚返回就立即用脚本或手动刷新浏览器，此时宿主 HMR 仍在 2 秒等待期内未触发 `reconcileProfilePatches`，导致观测到「卡片未出现」，误判为热装失败或必须重启。
- **验收规范**：CLI 命令退出后，**必须留出 2.5 至 3 秒静默等待时间**，等待宿主完成文件监听防抖并重新挂载 Include 树，然后再刷新浏览器页面。

#### 2. Windows NTFS 跨进程文件锁冲突（EPERM: rename）
在 Windows 平台上，如果宿主进程正在后台运行并对 profile 目录保持文件监听句柄，从外部终端并发或高频执行 `dsh plugin add` / `remove` 时，包管理器对 `package.json` 或 `pnpm-lock.yaml` 进行原子替换（rename）时极易抛出：
```text
EPERM: operation not permitted, rename '.../package.json.tmp' -> '.../package.json'
```
- **后果**：原子替换失败会导致安装事务回滚，`package.json` 未写入新插件，用户刷新页面自然找不到插件。
- **应对策略**：高频测试时必须留出文件句柄释放间隔（至少 1 秒）；捕获 EPERM 时执行带轻微抖动的重试；若持续锁死，可先停宿主再执行包操作。

#### 3. 原地更新（Update）的 HMR 短路限制
在 `dsh-hmr` 机制中：
```javascript
const bundles = JSON.stringify(readProfileManifest(dir).dsh?.profile?.bundles ?? []);
if (manifestOnly && bundles === lastBundles) return;
```
- **机制**：若仅在 `dependencies` 中修改了版本号，而 `dsh.profile.bundles` 数组未发生增减，HMR 判定为 bundles 未变而直接短路跳过重载。
- **客户端 rev 冻结**：客户端 bundle 的响应头带长缓存且标记为不可变，宿主条目 `rev` 在进程启动时计算好后冻结，运行中单纯替换磁盘文件不会自动触发重算。
- **通用原则**：原地更新已安装插件版本时，**必须重启宿主**，或者通过「先 `remove` 使 bundles 变化触发卸载 HMR、再 `add` 走全新安装 HMR」实现免重启加载。

#### 4. pnpm 供应链发布冷却期导致的静默降级假象 (minimumReleaseAge Silent Downgrade)
在运行中实例界面通过「+ 添加插件」输入裸包名热安装时：
- **机制陷阱**：pnpm 默认启用了 24 小时发布冷却期（`minimumReleaseAge: 1440`）。若目标插件的新版本刚发布不满 24 小时，包管理器会**静默剔除新版本**并自动降级回退安装发布满 24 小时的历史旧版（例如新版是 `X.Y.Z`，实际却被安装了带 bug 的 `X.Y.Z-2`）；
- **致命误诊**：测试人员以为安装的是最新修复版，实测发现旧 bug 依然存在，误判为“代码未修复”；
- **验收铁律**：热安装完成后，**第一件事永远是读磁盘真值**（`cat <profile>/node_modules/<pkg>/package.json`），比对物理版本是否等于预期发布版本；文档与界面指引中强制要求用户带精确版本号（如 `<pkg>@X.Y.Z`）安装，自动获得 `minimumReleaseAgeExclude` 豁免。

#### 5. DSH Web 一次性 Launch Token 鉴权与 Session Cookie 握手机制 (Ephemeral Launch Token & 401 Bypass)
在隔离实例启动 Web 服务进行自动化验收或脚本探针检测时：
- **机制剖析**：`dsh web` 启动时在内存中生成一次性随机 `launchToken`，并在控制台打印携带该令牌的完整 URL（`dsh web: http://127.0.0.1:<port>/?token=<token>`）。宿主连接安全闸门（`dsh-client-connection` 模块的 `authorizeIndex`）对所有未携带合法签名 Cookie 的原始 HTTP 请求直接响应 `401 Unauthorized`（`dsh web authentication required; reopen the URL printed by dsh web.`）；
- **握手流程**：浏览器或 HTTP 客户端首次带着 `?token=<launchToken>` 请求根路径时，宿主比对成功并签发基于 HMAC-SHA256 的带签名 HttpOnly 跨站隔离 Cookie（`dsh-auth-<authorityHash>=v1.<payload>.<signature>`），并以 `303 See Other` 状态码重定向至目录相对路径 `./`。随后携带该 Cookie 的所有资源请求（包括 `window.__DSH_BOOT__` 和客户端插件 JS）才能正常返回 200；
- **自动化脚本验收铁律**：自动化测试工具（CDP / Playwright / 自动化脚本）严禁直接裸请求 `http://127.0.0.1:<port>/`。必须优先从宿主启动输出中捕获完整的 `?token=...` URL 先完成一次 303 握手（例如 HTTP 探针必须携带能够自动处理重定向与 Cookie 保持的 Session 对象），建立受信任的 WebSession，否则所有接口和静态产物请求均被 401 拦截并误判为服务坏死。

---

## 四、浏览器逐项验证

**必须用真实的浏览器自动化工具**（CDP 驱动、Playwright 等）。当前会话里没有可用工具时，**明确请用户安装**，不要用看 DOM 源码或跑接口替代真实点击——这两者恰好是漏掉遮罩吞点击、控件禁用、渲染失败的主要来源。

### 一个功能一个入口

同一面板注册到多个插槽，用户会在设置窗口、侧边栏、插件页同时看到它，属 UI 污染。验证时先数一遍：目标面板的 DOM 节点数必须**恰好为 1**。

### 每一步都要回读真值

点击、截图、退出码都不能单独证明成功。每次写操作后回读接口字段、内存对象或磁盘文件。

| 验证项 | 判定方式 |
| --- | --- |
| 插件真的加载了 | 页面元素存在，且没有启动失败遮罩 |
| 面板只渲染一份 | 目标文案在 DOM 中出现次数恰好为 1 |
| 每个控件都点得动 | 点完回读接口字段确实变了 |
| 配置真的落盘 | 读磁盘配置文件，不是只看接口返回 |
| 样式真的注入了 | 自己的 style 标签在 document.head 里，且规则条数大于 0 |
| 图标真的渲染了 | 图片的自然宽度大于 0，不是回落到占位图 |
| 深浅色都可用 | 强制切到深色后关键文字颜色确实变了 |
| 控制台干净 | 采集到的 error 数为 0 |

### 浏览器环境的坑

| 坑 | 表现 | 解法 |
| --- | --- | --- |
| 遮罩吞点击 | 元素可读、强制点击也点了，但事件处理从未执行；读操作全对、写操作全无效 | 用 DOM 原生的元素点击触发，命中元素自身绕过遮罩；或先关掉引导层与弹窗 |
| 全屏引导遮罩吞点击 | 纯净隔离实例首次启动时全屏弹出「预览版说明」Modal 遮罩，DOM 元素可读但所有点击被遮罩吸收 | 页面 `wait_for_load()` 后先调用 CDP 无障碍树（`Accessibility.getFullAXTree`）检索 `role: "button", name: "继续"` 节点，通过 `DOM.getBoxModel` 计算物理包围盒中心坐标派发真实光标点击（`click_at_xy`）彻底关闭遮罩 |
| 会话生命周期插槽挂载分界 | 在 `dataPhase: "hero"`（空白起始态，尚未分配会话）下，会话级输入插槽（如 `conversation.input.right`）静默不渲染，误判为插件挂载失败 | DSH `InputBar` 严密受控于 `sessionId === void 0 ? null : renderSlot(...)`。测试会话级输入插槽前，必须先发送一条本地零 Token 指令（如输入 `/help` 并回车）驱动宿主分配本地会话使页面跃升进入 `dataPhase: "active"`，插槽即刻激活挂载 |
| 控制台传递代码中文代理字符崩溃 | Windows 控制台向 Python/Node 自动化脚本管道传参时，中文字符串编码不一致抛出 `UnicodeEncodeError: surrogates not allowed` | 自动化脚本自身一律采用纯 7-bit ASCII 编写（中文字符串使用 `\uXXXX` 标准 Unicode 转义），浏览器提取的结果直接写入本地 UTF-8 临时 JSON 文件，外部执行器再从文件读取，彻底免疫管道编码截断 |
| Web 未握手 401 假死 | 自动化脚本或探针直接请求 `http://127.0.0.1:<port>/` 报 401 Unauthorized 误以为服务坏死 | 宿主安全门禁强制要求一次性 Launch Token 握手。脚本必须从后台输出捕获完整 `?token=...` 链接，通过支持重定向与 Cookie 持久化的 Client（`-WebSession`）先执行一次 303 握手沉淀 Session Cookie |
| 导航等待超时 | 等待文档就绪的判定永不触发 | 长连接会让它永不触发；改用更弱的等待条件或明确的元素等待 |
| 浏览器沙箱崩溃 | 启动失败 | 指定本机浏览器可执行文件并关闭沙箱相关开关 |
| 控制台中文乱码 | 断言全乱码 | 把输出流按 UTF-8 处理 |
| 写入期间控件禁用 | 点击静默无效，值零写入 | 点之前轮询禁用属性直到解除 |
| 收敛判断过早 | 以为写生效了，其实只是中间帧 | 要求连续两帧结果相同且满足目标谓词才判收敛 |
| 长脚本静默失败 | 多步 Python/CDP 脚本整体无输出，短表达式正常 | 驱动脚本按「一步一调用」拆成多条极短片段；避免复杂表达式与长 sleep；单步超时单独定位 |
| 标签失联 | 页面还在但 js() 无响应，list_tabs 显示多个旧宿主标签 | 检查 attached 标签 URL 是否还是活宿主；用 switch_tab 切回，不要继续在死标签上操作 |
| 复杂 JS 表达式偶发空输出 | 同一表达式有时返回有时 Promise/空 | 每个断言用最小表达式独立调用；需要多步时写入临时 .py 文件逐行执行，不在一行里嵌大量反引号/正则 |
| 启动令牌是一次性的 | 脚本里硬编码的令牌在实例重启后全部失效，症状像「整个功能坏了」 | 令牌不写进脚本，从本次启动的输出里读取；每次重启实例都重新取 |
| 结构化输出被构建日志污染 | 解析工具的 JSON 输出失败，看起来像工具本身坏了 | 日志与结构化输出同流时，从特征位置（如行首的 `[`）切分后再解析 |

### 验收的可靠性排序：API 真值回读 > 浏览器 DOM 断言 > 截图

浏览器自动化工具（CDP/Playwright）本身可能不稳定（长脚本超时、复杂表达式静默失败、标签失联），
而**插件核心行为（跟随、锁定、回退、配置落盘）几乎都能用 API 真值回读覆盖**——见
[api-truth-read-back-without-browser.md](./api-truth-read-back-without-browser.md)。实测经验：

1. **能走 API 回读的行为优先走 API**：settings/describe、settings/mutate、插件自己的 remote 端点。
   「显式锁 A → 读 A；跟随源切 B → 不被推翻；unset → 恢复跟随」这类生命周期用 API 逐状态断言，
   比在浏览器里点一遍快且稳。
2. **浏览器只做 API 覆盖不了的断言**：面板渲染唯一性（DOM 计数 1）、控件实际渲染出三态、产物真的被加载
   （window.__DSH_BOOT__ 的 entry + 请求产物 URL 验证新代码）。
3. **产物层的验证可以完全绕开浏览器**：直接请求 /plugins/??<pkg>/client.js&rev=... 看是否含新代码特征
   （如新增字典键），这比在 UI 里找更快、不受 DOM 时序影响。
4. **接口回读只能证伪，不能证成**：返回 false 与返回 true 都不告诉你失败发生在哪一层。
   判据必须是可观察的状态转移（值确实变了、确实没变），不是接口的成功返回值。
   一个「保存成功」提示加上零变化的配置文件，是典型的假成功。
5. **四态之外还有一类必测**：热重载后不刷新页面直接操作。宿主会处置旧的表单对象，
   写操作静默失败而读操作全部正常——症状与「遮罩吞点击」几乎一样，但成因完全不同。
   界面必须把这种失败显式呈现出来。判据见 [host-semantic-gates.md](./host-semantic-gates.md)。

---

## 五、debug-修复-验证循环

验证不是一次跑完就结束。发现缺陷后：

1. **定位根因，不修表象**——先 grep 被改函数的全部调用方，找一处所有路径都会经过的地方修；只在报告提到的那条路径上打补丁，会让同源的兄弟调用继续带病运行。
2. **每次只改一处**，改完立即重跑受影响的验证项。
3. **循环直到全绿**——四种安装形态都过、浏览器里每项都点过、每项都回读过真值。
4. **把验证清单留下**（放在你的项目里，不要留在这个纯文档技能里），让下一轮改动能复跑同一套门禁。

---

## 六、验收清单

| 检查项 | 判定动作 |
| --- | --- |
| 实例是隔离的 | 插件清单只有基础插件加你的插件，零报错 |
| 本地源码直连工作区 | 目录联接 Target 强校验直通仓库根目录，且不包含 `.pnpm` 虚拟副本 |
| 配置来源单一且可追溯 | 复用了哪份配置、哪些条目是追加的，有分界注释 |
| 凭据引用存在 | 配置里的每个环境变量引用都能在全局凭据中找到 |
| 模型由用户选定 | 已询问，且已说明建议选便宜模型的理由 |
| 冷安装通过 | 全新安装链解析到正确版本并正常启动 |
| 热安装通过 | 应用状态是就地应用或明确要求重启，行为符合源码契约 |
| 热更新通过 | 版本号与界面同步更新，无版本变新界面没变的假象 |
| 卸载通过 | 界面元素消失，宿主资源释放，重启后无残留影响 |
| 界面逐项点过 | 每项都有点了加回读真值的记录 |
| 面板只渲染一份 | 目标元素 DOM 计数为 1 |
| 控制台干净 | error 数为 0 |
| 深浅色都验过 | 强制深色后关键颜色确实变化 |
| 卸载是三件事分别取证 | 界面元素消失、宿主资源释放、配置文件无残留，三者分别判，任一不成立即未通过 |
| 热重载后不刷新页面 | 在旧标签页里操作一次，确认写入失败被界面显式呈现而不是静默 |
| 宿主语义门禁已排期 | 写入闸门、注册表仲裁、缓存实时性、产物时序、生命周期、插槽注册、只读态逐条有判据，清单见 host-semantic-gates |
| 前置条件已显式满足 | 脚本开头把「必须先 ready / 先有会话 / 先挂载」的前置写成代码，而不是靠碰运气 |
| 症状与状态分别取证 | 断言的是「状态标记发生过」，不是「最终输出为空」 |
| 修复有对照组 | 用修复前的源码跑同一脚本确认症状在，只有这一条能把「假根因」排除 |
| 断言可失败 | 每条断言都做过一次人为破坏，确认会红；破坏后已还原并重跑全绿 |
| 产物差集为空 | 产物目录与源码目录的文件名集合做差集，出现差集即阻断 |

---

## 七、独立自动化实例验收踩坑与稳态套件设计 (Automated Isolated Acceptance Hardening)

在为插件编写无需人工介入的纯自动化端到端验收脚本（如 `scripts/test-isolated-instance.js`）时，运行在临时 `DSH_HOME` 下的真实宿主子进程会遭遇一系列与交互式终端完全不同的平台级隐蔽陷阱，必须严格遵守以下四大硬化契约：

---

### 7.1 官方发布模板 vs 自定义 Profile 派生规则 (Shipped vs Custom Profile Derivation)

#### 致命陷阱
开发者试图在临时 `DSH_HOME` 中初始化一个干净的 `web` profile，写下了如下命令：
```bash
# 致命报错：DSH CLI 抛出未捕获异常并直接退出！
dsh web --from-default-profile web --dump-config
```
触发报错：
```text
Error: dsh: profile "web" is shipped and cannot be a custom profile target; omit --from-default-profile to use it
    at initializeProfileFromDefault (profile-boot.js:146:52)
```

#### 深度根因与解决契约
- **官方内建模板（Shipped Profiles）**：`web`、`desktop`、`tui` 是宿主直接随包分发的内置标准模板。在新创建的 `DSH_HOME` 中，**直接运行 `dsh web --dump-config`**，宿主引导层会自动检测到该 profile 不存在并自发将其初始化为标准官方模板；
- **自定义派生模板（Custom Profiles）**：只有当目标 profile 名称是**非官方内置名称**（如 `test-custom`、`rescue`）时，才允许且必须传递 `--from-default-profile <shippedName>`；
- **自动化测试规范**：
  ```javascript
  // 初始化纯净的官方 web 实例：绝不带 --from-default-profile
  spawnSync(process.execPath, [dshBin, 'web', '--dump-config'], { env });
  ```

---

### 7.2 动态空闲端口探测与端口占用免疫 (Ephemeral Free Port Allocation)

#### 致命陷阱
在自动化验收脚本中为了避开默认的 `3080` 端口，开发者通常会随手硬编码一个备用端口（例如 `3099` 或 `3088`）：
```javascript
spawn(process.execPath, [dshBin, 'web', '--port', '3099', '--no-open'], { env });
```
一旦前次测试未正常退出、后台进程残留或宿主机其他服务碰巧监听了该端口，Web 服务器在引导期瞬间崩溃：
```text
Failed plugins (1):
  webserver (required)
    Error: listen EADDRINUSE: address already in use 127.0.0.1:3099
```

#### 最佳工程实践：操作系统动态申请保底空闲端口
自动化脚本在启动 DSH Web 实例前，必须先利用 Node.js 底层 Socket 向操作系统瞬时申请一个绝对未被占用的临时高位端口，释放后立即分配给 DSH：
```javascript
import net from 'node:net';

// 动态申请一个绝对空闲的端口
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const freePort = (server.address() as net.AddressInfo).port;
await new Promise(resolve => server.close(resolve));

// 启动独立实例，彻底免疫 EADDRINUSE
const child = spawn(process.execPath, [dshBin, 'web', '--port', String(freePort), '--no-open'], { env });
```

---

### 7.3 Windows ESM 路径协议与本地代理回环豁免 (Windows ESM pathToFileURL & NO_PROXY Trap)

在自动化脚本中探针式直连 Web 服务或动态引入测试模块时，有两个跨平台的平台级断路陷阱：

#### 陷阱一：Windows 动态 import 协议不支持
在测试代码中通过绝对路径动态导入 ES 模块：
```javascript
// Windows 致命报错：ERR_UNSUPPORTED_ESM_URL_SCHEME
await import("D:\\my-workspace\\lib\\index.js");
```
- **根因**：Node.js ESM 加载器在 Windows 上将盘符 `D:` 误判为不合法的 URL 协议（Received protocol 'd:'）；
- **修复**：必须统一使用 `node:url` 的 `pathToFileURL` 转换为规范的 `file://` 协议：
  ```javascript
  import { pathToFileURL } from 'node:url';
  await import(pathToFileURL(absPath).href);
  ```

#### 陷阱二：终端代理劫持本地回环请求导致握手超时
当宿主机环境配置了系统代理或终端代理（如 `$env:HTTP_PROXY = "http://127.0.0.1:10801"`）用于拉取外部资源时：
- Node.js 的全局 `fetch` 或命令行的 `curl` 会无差别将发往 `http://127.0.0.1:<freePort>/` 的本地回环请求也强行路由至该代理服务器；
- 代理服务器无法路由回环端口，导致测试脚本轮询探针一直报 `Connection Timeout` 或握手超时，误判 Web 实例未能正常启动；
- **规避铁律**：测试脚本启动子进程和发送 HTTP 请求时，必须强制注入本地回环豁免环境变量，或显式绕过代理：
  ```javascript
  const env = {
    ...process.env,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
  // 使用 curl 探测时必须追加参数
  spawnSync('curl.exe', ['-s', '-i', '--noproxy', '*', targetUrl]);
  ```

---

### 7.4 自动化验收闭环：开箱即用的 Runner 设计骨架

一个生产级的隔离自动化验收脚本应具备五阶段确定性状态机：
1. **沙盒隔离**：创建唯一的临时目录（`AppData/Local/Temp/dsh-test-*`）并置为 `DSH_HOME`；
2. **直连挂载**：初始化内置模板并利用 `mklink /J` 直连开发工作区根目录；
3. **动态拉起**：申请空闲端口并带豁免环境变量启动，正则捕获标准输出中的 `token=...` 提取认证凭据；
4. **功能探针**：直连 Web 接口回读状态码与真机验证运行时能力；
5. **安全销毁**：捕获 `finally` 块，断开目录联接并强制递归销毁临时目录，保证零环境污染。

---

## 相关文档

- [source-verification-and-caches.md](./source-verification-and-caches.md)：动手前先读源码的强制流程与三层来源
- [silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)：零报错失效的三类根因、门禁设计与破坏实测
- [host-semantic-gates.md](./host-semantic-gates.md)：静态断言测不到的宿主语义门禁清单与验收矩阵
- [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)：调试回路、伪 API 黑名单、免启动反证法
- [desktop-vs-cli-runtime.md](./desktop-vs-cli-runtime.md)：两种运行时的差异、配置迁移与 profile 边界
- [install-resolution-traps.md](./install-resolution-traps.md)：版本解析陷阱与安装排障
- [publish-npm-verification.md](./publish-npm-verification.md)：发布后的双真源验证

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
apps/cli  <-  @deepseek-ai/dsh@0.2.1-rc.2
packages/bundle/base  <-  @deepseek-ai/dsh-base@0.2.1-rc.2
packages/client/hmr  <-  @deepseek-ai/dsh-client-hmr@0.2.1-rc.2
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@0.2.1-rc.2
packages/boot/hmr  <-  @deepseek-ai/dsh-hmr@0.2.1-rc.2
packages/host/webserver  <-  @deepseek-ai/dsh-host-webserver@0.2.1-rc.2
packages/boot/plugin-manager  <-  @deepseek-ai/dsh-plugin-manager@0.2.1-rc.2
packages/bundle/web-app  <-  @deepseek-ai/dsh-web-app@0.2.1-rc.2
```