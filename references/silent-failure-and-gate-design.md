# DSH 插件的静默失效防线、门禁设计与真机验收 (Silent Failures, Verifiable Gates & Real-Browser Acceptance)

> 适用范围：任何 DSH 插件，但**尤其**是双面 UI 插件、发布到 npm 的组合包、以及带配置开关的插件。
> 核心命题：DSH 生态里最贵的缺陷不是崩溃，而是**静默失效**——代码写全了、类型过了、门禁全绿，运行时功能却毫无作用且零报错。本篇把这些坑归纳成三类，给出可复用的判定动作与门禁写法。

---

## 零、为什么静默失效在 DSH 上格外高发

三条架构选择叠加，导致「看起来对」与「真的对」之间存在系统性缝隙：

| 架构事实 | 带来的缝隙 |
| --- | --- |
| **Cordis 微内核：一切能力都是可选插件装配** | 缺依赖不抛错，只是那个服务 `undefined`；契约包与实现包分离，装了契约包不等于有提供方 |
| **客户端面板由插槽容器渲染** | props 形状不对、传了 ctx、样式没注入、用了不存在的 CSS 变量——都不报错，只是不生效 |
| **元数据读取走 Node exports + 静默兜底** | 子路径没放行就抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` 并被吞；`files` 写错开发期完全无感，发布后图标与文案消失 |

**总原则：静默失效只能靠「回读真值」发现，绝不能靠看界面。** 每次写操作后回读接口、内存对象或磁盘文件，值没变就是没生效。

---

## 一、静默失效的三类根因与判定动作

### 第 1 类：代码存在但从未被执行

代码路径写完了、函数被定义了、类名被挂上了，但那段逻辑**根本没进到运行时的 DOM / 注册表 / 配置**。这类最隐蔽，因为静态检查和类型检查全部通过。

| 症状 | 典型根因 | 判定动作 |
| --- | --- | --- |
| 类名挂在元素上，但 computed style 全是浏览器默认值 | 只在 JS 里定义了 CSS 字符串，**没有把 `<style>` 标签插进 `document.head`** | 在页面里 `document.querySelectorAll('style[data-plugin-css]')` 看自己的标签在不在；再用 `document.styleSheets` 找到对应 sheet 核对规则条数 |
| 元素上的 `var(--dsw-...)` 全部退回兜底值 | 变量名拼错，或引用了不存在 / 仅在局部定义的令牌 | DevTools Computed Style 查真实变量名；见 [web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md) 令牌真值表 |
| `for...of` 或展开运算对字符串逐字符迭代，写入全是空 | 调用点传了裸字符串，而函数签名已经改成数组 | 打印实际传入的 `typeof` 与 `Array.isArray`；把签名与**全部**调用点一起 grep 一遍 |
| 批量操作生效了、单次操作毫无动静 | 多处调用点共用一个 helper，改签名时只改了一部分 | 全仓 grep helper 名，逐个核对实参形态 |

**这一类的判定铁律**：任何「定义了但不确定跑了」的代码，都必须有一条能直接数出它跑过几次的观测点（DOM 节点数、注册表条数、配置里的键、事件派发计数）。

### 第 2 类：契约写错，但错误被吞掉

DSH 大量契约校验失败后只写 `meta.error` 或直接 `return undefined`，调用方拿到的是一个「看起来正常但内容为空」的值。

| 契约 | 违反后的表象 | 判定动作 |
| --- | --- | --- |
| `exports` 白名单 | 子路径解析抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`，被吞，卡片只剩包名 | `import` 一次自己的包名加子路径，看能否解析 |
| `files` 清单 | 开发期无感，**只有发布后**图标 / locale / lib 消失 | `npm pack --dry-run --json`，逐条断言关键路径都在 |
| `icon` 字段 | 必须是包内相对路径、svg/png/jpg/jpeg/webp、**不超过 256 KiB**（`MAX_ICON_BYTES = 256 * 1024`）；绝对路径、带协议头、逃出 manifest 目录全部拒绝 | 见 [settings-and-plugin-ui.md](./settings-and-plugin-ui.md) 第二节 |
| `locale/*.json` | 文件名必须是语言 id；缺 `meta.title` 或 `meta.description` 静默降级 | `readdirSync(locale)` 的遍历规则与宿主字典遍历一致 |
| React 组件签名 | 插槽容器不注入 ctx，传 ctx 会在运行时报 undefined 属性 | 组件只接纯 props 或自定义 hook |

**根因归纳**：宿主读元数据时是「尽力而为」——能读到标题就返回标题，读到图标失败就把错误塞进 `error` 字段继续返回。**它不会抛给你**，所以你必须自己去调那个函数问真值。

### 第 3 类：解析到了不是你要的那个东西

版本解析、文件路径解析、模块解析都可能「成功但指向别的东西」。

| 症状 | 根因 | 判定动作 |
| --- | --- | --- |
| 装插件后行为像旧版 | 包管理器解析到陈旧版本（pnpm 冷却期 + semver 预发布排序） | 见 [install-resolution-traps.md](./install-resolution-traps.md)；**清缓存无效** |
| 官方 provider 脚本「找不到模块」 | isolated 布局下那个包不在 profile 直连依赖里，只在 dsh 本体依赖树中 | 按 profile 入口、pnpm store `.pnpm`、全局本体三档找 |
| `dsh <app> headless "..."` 报「too many arguments」 | web app 的参数解析器收 0 个位置参数 | headless 要走 headless app；纯 web app 只吃 `--port` 与 `--no-open` |
| 某能力在 `ctx.get()` 里是 undefined | 契约包装了但没有实现方 | 契约包与实现包成对安装 |
| 界面文案变裸 key / 单语孤岛 | 面板词典缺词（漏同步任一册）或渲染路径有未走 `t()` 的硬编码字符串 | 查字典 key 集双语对称；门禁正则扫渲染路径裸字面量并断言每个 key 双语声明 |

---

## 二、门禁设计：每条断言都必须能失败

这是本篇最可复用的部分。**一条永远为真的断言等于没有断言**，它给人虚假的安全感，比不写更糟。

### 1. 先分类，再决定断言什么

问自己：**这个契约错了，会不会报错？**

```text
会报错          -> 交给 tsc 与运行时异常，不必写门禁
静默但可见       -> 写一条「回读真值」的门禁（跑一次真实操作再断言结果）
完全静默         -> 必须写「源码形态断言」（正则扫代码）或「产物断言」（打包后检查）
```

### 2. 「源码形态断言」：把契约翻译成正则

只适用于「正确写法有唯一形态」的契约。示例（按你自己的包名替换）：

```js
// 断言客户端样式真的注入了 DOM，而不是只定义了一个没人用的字符串
const styleIssues = []
if (!/document\.createElement\(\s*'style'\s*\)/.test(source)) styleIssues.push("缺少 createElement('style')")
if (!/document\.head\.appendChild\(/.test(source))           styleIssues.push('缺少 head.appendChild')
if (!/data-plugin-css/.test(source))                         styleIssues.push('缺少 data-plugin-css 标记')
// 禁止引用原始色板层（它不随主题切换）
if (/--dsw-static-/.test(source))                            styleIssues.push('引用了 --dsw-static-*，将与主题脱钩')
```

### 3. 「产物断言」：icon / exports / files 三件套

```js
const ext = extname(icon).toLowerCase()
const allowed = ['.svg', '.png', '.jpg', '.jpeg', '.webp']
const strip = (value) => value.replace(/^\.\//, '')
if (!icon) issues.push('未声明 icon')
else if (/^[a-z][a-z\d+.-]*:/i.test(icon) || icon.startsWith('/')) issues.push('icon 必须是包内相对路径')
else if (!allowed.includes(ext))                             issues.push('icon 格式非法')
else if (!existsSync(icon))                                  issues.push('icon 文件缺失')
else if (statSync(icon).size > 256 * 1024)                   issues.push('icon 超过 256 KiB')
else if (!files.some((f) => strip(f) === strip(icon)))      issues.push('files 未放行 icon')
if (!exports['./package.json'])  issues.push("exports 未放行 './package.json'")
if (!exports['./locale/*.json']) issues.push("exports 未放行 './locale/*.json'")
```

**坑：`files` 里的条目不带 `./` 前缀，而 manifest 的 `icon` 常写 `./icon.png`。直接字符串比较会误判「没放行」。** 比较前统一去掉前缀。

### 4. 每条新门禁都要做「破坏实测」

写完断言，**必须人为破坏一次，证明它真的会红**：

```text
删掉 head.appendChild        -> 应 FAIL「缺少 head.appendChild」
塞一条 --dsw-static-*       -> 应 FAIL「引用了 static 色板」
把 icon 改名                -> 应 FAIL「icon 文件缺失」
从 files 移除 icon           -> 应 FAIL「files 未放行」
从 exports 删 ./package.json -> 应 FAIL「exports 未放行」
```

破坏实测通过后还原，再跑一次全绿。这一步不能省——正则写错一个字符，断言就从「有用」变成「永远绿」。

### 5. 内建可失败自检：模块边界自带测试表面

比外部脚本更强的做法是**把规范校验做成导出接口的一部分**：

- 边界自检下沉到模块自身（`selfTest()` 或 `verifySpecification()`），随模块一起被复用；
- 门禁脚本退化为纯声明式调度器，不含任何临时目录与脚手架；
- 关键路径自带断言（例如边界值、契约转换），坏输入立刻炸。

这样任何调用方（包括别的插件复用你的模块）都自动获得保护。

---

## 三、真机浏览器验收：环境坑与判定纪律

UI 插件的交付前验收必须在真实浏览器点一遍，且**每一步都回读真值**。

### 1. 环境坑速查

| 坑 | 表现 | 解法 |
| --- | --- | --- |
| **遮罩吞点击** | DOM 元素可读、`force=True` 也点了，但 React `onClick` 从未执行；读操作全对、写操作全无效 | 用 DOM 原生 `el.evaluate('(e)=>e.click()')`，命中元素自身忽略遮罩；或先关掉引导层与弹窗 |
| **导航等待超时** | `domcontentloaded` 卡死 | SSE 与 WebSocket 长连会让它永不触发；改用 `wait_until='commit'` 或明确的元素等待 |
| **Chromium 沙箱** | 启动失败、崩溃 | `executable_path` 指本机 Chrome，并加 `--no-sandbox --disable-dev-shm-usage --disable-gpu` |
| **控制台编码** | 中文断言全乱码 | Windows 下把 stdout 包成 UTF-8 |
| **写入期间控件禁用** | `el.click()` 静默无效，值零写入 | 点之前轮询 `aria-disabled` 与 `disabled` 直到解除 |
| **收敛判断过早** | 以为写生效了其实只是中间帧 | 批量写会连带触发一串刷新；要求「连续两帧相同且满足目标谓词」才判收敛 |

### 2. 收敛判定：两帧相同加目标谓词

```python
def settle(label, predicate, limit_ms=60000):
    waited, last = 0, None
    while waited < limit_ms:
        page.wait_for_timeout(1500); waited += 1500
        current = probe()
        # 关键：必须连续两帧一致。仅等 predicate 会在初始态已满足时立刻"通过"。
        if predicate(current) and current == last:
            print(f'（{label} 稳定于 {waited}ms）'); return current
        last = current
    print(f'（{label} {limit_ms}ms 内未稳定，返回末帧）'); return last
```

### 3. 点之前先等禁用解除

```python
def wait_idle(limit_ms=60000):
    waited = 0
    while waited < limit_ms:
        if page.evaluate(
            '() => Array.from(document.querySelectorAll(\'[role="switch"]\'))'
            '.every((el) => el.getAttribute("aria-disabled") !== "true" && el.disabled !== true)'
        ): return waited
        page.wait_for_timeout(1000); waited += 1000
    return -1
```

### 4. 验收清单（每条都要回读）

| 项 | 断言方式 |
| --- | --- |
| 插件真被加载 | 页面元素存在，且 console 无 `Failed to load plugins` |
| 面板只渲染一份 | `locator("text=<面板文案>").count() == 1` |
| 每个控件都点得动 | 点后回读接口字段确实变了 |
| 落盘正确 | 读磁盘配置文件，不是只看接口 |
| 样式真的注入 | `style[data-plugin-css]` 存在且规则条数大于 0 |
| 图标真的渲染 | `img[src^="data:image/"]` 的 `naturalWidth > 0`，且显示尺寸符合预期（不是回落到占位图） |
| 深浅色都可用 | 强制 `body[data-ds-dark-theme]` 后关键文字颜色确实变了 |
| 控制台干净 | `len(errs) == 0` |

---

## 四、发布前的双重复验

打包与元数据是两件事，都要用**不依赖开发目录**的方式复验：

```bash
# 1. 打包清单：icon / locale / lib 真的进 tarball
npm pack --dry-run --json

# 2. 宿主读不读得到：免启动直接调公开函数
#    Windows 必须 pathToFileURL，否则 ERR_UNSUPPORTED_ESM_URL_SCHEME
node -e "import('@deepseek-ai/dsh-app-boot').then(b=>import('node:url').then(u=>import('node:path').then(p=>{
  const m=b.readPluginMeta('<pkg>', u.pathToFileURL(p.join('<pkgDir>','package.json')).href)
  console.log('error=',m?.error??'(none)','title=',JSON.stringify(m?.title),'icon=',typeof m?.icon==='string'?m.icon.slice(0,24):m?.icon)
})));"
```

期望：`error=(none)`、`title` 为 `{en, zh}` 或字符串、`icon` 以 `data:image/` 开头。任一不符即契约破。

**发布后再验一次**：从 registry 下载 tarball 解包，读它的 `package.json`，确认 `files` / `exports` / `icon` 与源码一致。这一步能抓出「本地目录正常、发布产物缺件」这类只在 registry 复现的问题。

---

## 五、发布与 manifest 的两个静默坑

### 1. `repository.url` 会被 npm 自动规范化

写成 `https://github.com/owner/repo` 时，npm publish 会告警：

```text
npm warn publish "repository.url" was normalized to "git+https://github.com/owner/repo.git"
```

**直接写成规范形态 `git+https://github.com/owner/repo.git`**，告警消失。已发布的旧版本不受影响（解析与展示都正常），不必为此升 patch。

### 2. 版本与 tag 强绑定

CI 通常校验 `tag == package.json.version`，不一致直接失败。发版前确认：门禁全绿、升 version、写 CHANGELOG 段落（标题格式不可变，CI 靠它生成 Release 正文）、提交推送 main、打 annotated tag 并推送、观察流水线、官方源加 fresh cache 交叉验证 `npm view`。

---

## 六、自检清单

| 检查项 | 判定动作 |
| --- | --- |
| 没有「定义了但不确定跑了」的代码 | 每个关键路径都有能数出执行次数的观测点 |
| 每条门禁都能失败 | 对每条断言做一次破坏实测，看到红再还原 |
| 打包不漏件 | `npm pack --dry-run --json` 断言 icon、locale、lib 都在 |
| 元数据免启动可验 | `readPluginMeta` 返回 `error=(none)` 且 `icon` 是 data URL |
| 写操作都回读 | 每个按钮与开关点完都读回配置或接口，值没变即判定失败 |
| 等待禁用解除再点 | 所有控件点击前轮询 `aria-disabled` |
| 收敛判定要两帧 | `predicate(current) and current == last` |
| 图标真透明底 | 图标文件不能带白底与圆角，否则卡片上出现双层边缘 |
| 深浅色都验过 | 强制 `data-ds-dark-theme` 后关键颜色确实变化 |
| manifest 无自动规范化告警 | `repository.url` 已写成 `git+https://...` 形态 |

---

## 相关文档

- [web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)：设计令牌真值、样式注入契约、官方 primitives
- [settings-and-plugin-ui.md](./settings-and-plugin-ui.md)：卡片元数据与图标字段的完整规范
- [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)：免启动反证法、伪 API 黑名单、Top 9 排查表
- [skill-provider.md](./skill-provider.md)：技能屏蔽的唯一通道是 invocation 覆盖
- [install-resolution-traps.md](./install-resolution-traps.md)：版本解析陷阱
- [packaging.md](./packaging.md)：打包、pnpm 陷阱、发布纪律
