# DSH 客户端 UI 落点选择、静默失效定位与真机取证 (DSH 0.2.0-rc.2)

> 适用：任何向 Web GUI 贡献界面的双面插件。
> 本篇提炼自一次真实排障：插件面板其实一直正常渲染，却因为「落点选多了」「用户找的位置与落点不一致」「客户端产物是旧缓存」三个因素叠加，被连续误判为 UI 不显示达数轮。
> 只保留与具体插件无关的通用机制与手法。

---

## 零、铁律：一个功能，一个入口

**「多落点冗余」是反模式，不是稳健。** 同一块面板注册到多个插槽，用户会在设置窗口、侧边栏、插件页同时看到它——这不是「处处可达」，是 **UI 污染**，用户会明确要求删除。

判断顺序：

`text
先问：这个功能属于哪个界面？（语义归属）
再问：那个界面由哪个插槽承载？
最后：只注册一次。
`

只有当**功能确实不同**时才注册多个落点。例如一个上下文类插件可以同时提供侧边栏 Tab（浏览）、输入框挂件（快捷入口）、设置卡片（偏好）——那是**三个功能**，不是同一面板的三份拷贝。

> 反面教材：为「提高可见性」把同一条配置面板同时挂到 settings.section、plugins.item、plugins.bundle.config、sidebar.footer.action、shell.overlay。结果是设置窗口多一个 Tab、侧边栏底部多一个按钮、插件页多一个分组条目，最后全部需要回滚。

---

## 一、插槽系统三个必知机制

### 1. spec 从哪来：由父条目的 children 表声明

插槽不是天然存在的。**一个插槽必须先被某个条目的 children 表声明，其他插件才能对它注册。**

`js
// 父条目（例如插件管理页）注册时声明自己拥有的子插槽
ctx.slots.inject("main", function* () {
  yield ctx.slots.register({
    name: "main",
    key: "plugins",
    children: {
      "plugins.item":          { kind: "list",  scope: "root" },
      "plugins.bundle.config": { kind: "keyed", scope: "root" },
    },
  }, PageComponent)
})
`

结论：

- 插槽的**存在性取决于父条目是否挂载**。父插件没加载，子插槽就不存在，对它的一切注册都会静默消失（见下一节）。
- 唯一例外是 root——它由框架构造 SlotCore 时种子化（a priori 声明），是所有渲染树的根洞。
- 想知道某个插槽由谁声明：grep 宿主包里的 children 表；或读 dsh-cordis-client-runner 的插槽目录，它带 declaredBy 字段，直接写明「由哪个条目的 children 声明」。

### 2. kind 决定注册参数——写错会抛错，这反而是好事

| kind | 必需参数 | 语义 | 写错的后果 |
| --- | --- | --- | --- |
| single | 无（仅 name） | 整槽只有一个注册者 | 同优先级重复注册**抛错** |
| keyed | key | 每个 key 一个占位（同 key 唯一） | 缺 key **抛错**：keyed slot "X" requires options.key |
| list | id | 按 order 排序的多个条目 | 缺 id **抛错**：list slot "X" requires options.id |
| chain | select | 链式覆盖 | 缺 select **抛错** |

这类错误是**响亮**的（直接 throw），比静默失败好排查得多。注册前先确认 kind，不要猜。

另有两条约束：

- **keyed 同 key 唯一**：同一 key 在同优先级下重复注册会抛错（提示可用不同 priority 遮蔽）。因此「注册两个 key 做保险」在语法上可行（不同 key 互不冲突），但**只有在宿主真会用另一个 key 匹配时才有意义**——先用实测确认宿主的匹配键，别凭想象加。
- **未知字段会被静默丢弃**：注册对象里只有 key / id / order / label / priority / select / inject / children / store / locale / registrant 会被保留，其余字段直接消失（不报错）。

### 3. slots.inject(key, callback) 会静默失败——本篇最重要的一条

实现（dsh-client-ui-renderer 的 slots 服务，inject 内部的 reconcile）：

`js
const spec = this._core.specDynamic(key);
if (spec === void 0) return;   // spec 不存在时【直接返回】
`

注意：该「静默」指宿主永不声明该 slot 时 callback 永不执行（零日志、零 console）；若声明出现而 callback 抛错，错误会经 queueMicrotask 重新抛到全局。

它的完整行为：

- spec **已存在** → 立即同步执行 callback（注册成功）。
- spec **尚不存在** → 订阅该 key 的声明事件，等声明提交后再执行。
- spec **永远不出现**（父插件没加载 / 名字拼错 / 父条目未挂载）→ **callback 永不执行，零报错、零日志、零控制台输出。**

**所以：凡是「注册了但界面没有」，第一嫌疑是 spec 不存在，而不是组件写错。** 组件写错会在渲染时抛异常（看得见），spec 不存在是彻底的静默。

判定动作：

`js
// 在 apply 开头写时间戳，在每个注册成功处写标记，
// 把「apply 没跑」与「inject 没触发」彻底区分开
window.__MY_PLUGIN_UI__ = { startedAt: new Date().toISOString(), registered: [] }
`

> 注意：这个标记只能证明「成功的那几条」。callback 没执行时你连记录的机会都没有——所以 startedAt 这一步不能省。

---

## 二、落点选择：界面语义到插槽的映射

### 1. 映射表（先查表，再决定）

| 用户看到的界面 | 插槽 | kind | 注册参数 | 备注 |
| --- | --- | --- | --- | --- |
| 设置窗口左侧一级 Tab | settings.section | list | id + order + label | 右侧渲染完整页面；order 建议置于官方分区之后（官方 shipped：-10/0/10/15/20） |
| 设置窗口「通用」页内的一行 | settings.general.item | list | id + order | 只放单行开关，别塞整页 |
| 设置窗口「内置插件」页的二级 Tab | settings.plugins.tab | list | id + order + label | 按条目注册 id 匹配（renderSlot only: id；内置「全部」视图 id="all"） |
| 插件页「官方」分组条目 | plugins.item | list | id + order + label | 点进去是独立详情页；组件按 props.view（summary / page）分态（分组标题为「官方」与「已安装」） |
| **「已安装」列表点开某包卡片后的内联配置区** | plugins.bundle.config | keyed | key = **包名** | 最贴近用户预期的配置落点；渲染门见下 |
| 某个包下某行的配置 | plugins.row.config | keyed | key = 包名#rowId | 多行插件专用 |
| 右侧边栏 Tab | sidebar.right.pane.tab | keyed | key = tab id | **需先**向 sidebarRightTabs 服务注册 tab 定义（id / kind / title / guide），再注册插槽；另有配套的 sidebar.right.pane.tab.title |
| 侧边栏底部按钮 | sidebar.footer.action | list | id + order | 常驻位置，慎用（常驻即长期占位） |
| 全局浮层 | shell.overlay | list | id + order | 适合模态与通知 |
| 侧边栏底部设置区 | sidebar.settings | single | 无 | 整槽唯一 |

### 2. plugins.bundle.config 的渲染门（最容易被误判）

宿主渲染这块区域是**有条件**的（dsh-client-ui-plugin-manager）：

`js
// 1) 账本：收集已注册到该插槽的 key
const keysOf = (name) => new Set(ctx.slots.entries(name).flatMap(e =>
  e.options.key === void 0 ? [] : [e.options.key]))
bundles: keysOf("plugins.bundle.config")            // ← 只取 key

// 2) 渲染门：账本里含这个包名才渲染配置区
configured: ledger.bundles.has(openPkg.name)
...
configured ? renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name }) : null
`

三条硬结论：

- **匹配键是「包名」**。宿主 bundle 清单来自 profile manifest 的 dsh.profile.bundles、dependencies 与安装记录——**全是包名**（scoped 包写全称），不是 bundle id。
- **注册的 key 必须与包名逐字一致**，否则 configured 为 false，整块区域连容器都不渲染。
- 该区域**只在插件页卡片详情内**出现，且用户须先点开对应卡片。用户报「没有面板」时，先确认他点的是哪个列表的哪张卡片。

### 3. 用户说「UI 不显示」时的三分法

按顺序排除，每步都要证据：

`text
① 客户端模块进图了吗？
   → 读 window.__DSH_BOOT__.entries 找你的包 id。不在 = 模块层问题，与落点无关。
② apply 跑了吗？注册成功了吗？
   → 全局标记（见 §一.3）。没跑 = 宿主侧 fiber 未激活或模块加载失败。
③ 注册成功了，界面还是没有？
   → 落点语义问题：用户找的位置 ≠ 落点位置，或渲染门未通过。
`

经验数据：真实场景里 **③ 占多数**，而排查者往往一头扎进 ① ② 的代码细节。

---

## 三、客户端产物的缓存与版本时序（极易误判）

### 1. bundle 是长缓存，改完必须完全重启宿主应用

客户端 bundle 响应头由 dsh-client-modules 发出：

`text
Cache-Control: public, max-age=31536000, immutable
`

URL 形如 /plugins/??包id/client.js&rev=12位hex——rev 是产物文件 mtime/ctime/size 的 framedHash（单包）与 id+rev 组合哈希（combo），不是内容哈希（内容变了 rev 必变，但重写文件可能 rev 变而内容同）。所以：

- **刷新页面、重开面板、重开设置窗口都不够**；桌面端（Electron）必须**完全退出应用再启动**。
- 开发期由 dev:web 重建 client bundle，client-hmr（/plugins/events SSE）自动热替换插件条目；桌面端（desktop profile 未挂 client-hmr）只能重启。

### 2. 版本号会「先于」界面更新，制造假象

插件页卡片的版本号来自宿主 bundle 清单（读 package.json 的 version），界面来自 client bundle。**两者更新时机不同步**，因此会出现：

> 卡片已经显示新版本号，界面却还是旧版行为

这一假象极易被误判成「改了没生效」，进而去乱改代码。判定动作——对比页面里 boot 图的实际 rev 与磁盘产物，或直接请求 bundle URL 看内容：

`js
const row = window.__DSH_BOOT__.entries.find(e => e.id === '<你的包名>')
console.log(row.rev, row.url)   // 拿这个 URL 直接请求，检查内容是否含新代码
`

---

### 3.3 产物内嵌宿侧代码 = 整段脚本语法失败（新形态的静默消失）

客户端 bundle 的 CJS factory 里**不能出现任何 ESM 语法**（`import.meta`、顶层 `import`）。宿主把 bundle 原样字符串拼接进 combo script（只剥 sourceMappingURL 注释，无 esbuild/vite 转换），以普通 `<script src>` 加载——浏览器解析 `import.meta` 即抛 SyntaxError，**整段 combo 脚本解析失败**，含该 bundle 的全部面板静默消失，UI 层零报错。

- 根因形态：构建模板里残留宿侧 Node 代码行（如 `const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), ...)`），变量零引用却原样进产物；
- 判定三步：
  1. 直接读产物 `grep import.meta|process.`（宿侧 API 关键字）；
  2. Node 探针模拟 factory 执行：`new Function('window', 'require', clientSrc)`，SyntaxError 即实锤；
  3. `git log -S "关键字" -- <构建脚本>` 定位引入提交，确认是否自己造成的回归；
- 门禁：断言**产物文件内容**（readFile）不含 `import.meta` / `process.`；注意不是断言构建脚本源码（模板里的宿侧代码段会原样进产物，见 architecture-refactor-experience.md 第八节）；
- 它属于「客户端模块层」的静默失效：boot 图里条目可能在（注册表已进图），但脚本解析期已死——三分法① 的判定（读 `__DSH_BOOT__.entries`）**不够**，还要看 combo script 是否能解析。

## 四、无浏览器验证：直接执行客户端 factory

客户端 bundle 是 CJS factory 形态（window.__ModuleLoader__.load({ id, factory })），**因此完全可以在 Node 里执行它**，用来验证「apply 是否抛错、注册了什么、参数对不对」——不需要浏览器，也不需要起宿主。

`js
import { readFileSync } from 'node:fs'

const src = readFileSync('lib/client.js', 'utf8')
let registration = null
globalThis.window = { __ModuleLoader__: { load(r) { registration = r } } }

// 最小 mock：只覆盖你真正 require 的模块
const mockReact = {
  createElement: (...a) => ({ type: a[0], props: a[1] }),
  useState: () => [null, () => {}], useEffect: () => {}, useCallback: (f) => f,
  useRef: () => ({ current: null }), useSyncExternalStore: (sub, get) => get(),
}
const requireMock = (name) =>
  name === 'react' ? mockReact : new Proxy({}, { get: () => function () { return null } })

new Function('window', 'require', src)(globalThis.window, requireMock)

const mod = registration.factory(requireMock)
console.log('exports:', Object.keys(mod), 'inject 声明:', mod.inject)

// 用 mock ctx 跑一遍 apply，观察它到底注册了什么
const calls = { inject: [], register: [] }
const ctx = {
  slots: {
    inject(name, cb) {
      calls.inject.push(name)
      try { return cb() } catch (e) { (calls.err ||= []).push(name + ': ' + e.message) }
    },
    register(o) { calls.register.push({ name: o.name, key: o.key, id: o.id, order: o.order }); return () => {} },
  },
}
mod.apply(ctx)
console.log('inject 调用:', calls.inject)
console.log('register 参数:', calls.register)
if (calls.err) console.log('注册异常:', calls.err)
`

它能一次性回答：

- factory 形态是否合法（ESM import / 顶层 return / JSX 会在这里立刻炸）；
- apply 是否抛错（例如用了不存在的 ctx API）；
- 注册了哪些插槽、是否漏注册、key 与 id 与 order 是否正确；
- exports.inject 声明是否与代码实际用到的服务一致。

> 注意：mock 的 slots.inject 默认「立即执行 callback」，**因此它无法复现 §一.3 的静默失败**。它验证的是「代码本身对不对」，不是「宿主会不会给它注册机会」。两者互补。

把落点集合固化成一条**反向断言**也很划算（防止 UI 落点被无意扩散）：

`js
// 只允许白名单内的落点，出现其他 ctx.slots.inject 即失败
const slotCalls = [...clientSrc.matchAll(/ctx[.]slots[.]inject[(]"([^"]+)"/g)].map(m => m[1])
const extra = slotCalls.filter(s => s !== 'plugins.bundle.config')
if (extra.length > 0) { console.error('出现多余 UI 落点: ' + extra.join(', ')); process.exitCode = 1 }
`

---

## 五、真机取证：CDP / browser-harness

静态推理到极限后必须回到运行时。要点是**一次程序内完成全流程**：

`text
spawn(Chrome --headless=new --remote-debugging-port=<port> --user-data-dir=<tmp>)
  注意：宿主端口非固定（web-app patch 写 `port: !!js ctx.webStartup.port ?? 3080`），应从启动日志取 URL，不要假设 3080
  ↓ 等 10~20 秒（端口监听不是立刻的，过早探测会误判「起不来」）
fetch http://127.0.0.1:<port>/json/version      // 确认就绪
fetch http://127.0.0.1:<port>/json/list         // 取 page 目标的 webSocketDebuggerUrl
WebSocket 连接 → Runtime.enable / Page.enable
Page.navigate(<带 token 的 URL>)
等渲染（SPA + 长连接，别指望 networkidle）
Runtime.evaluate 读 window.__DSH_BOOT__ / DOM / 自有标记
`

环境坑速查：

| 坑 | 表现 | 解法 |
| --- | --- | --- |
| 调试端口「起不来」 | 连 /json/version 一直失败 | 多半是**没等够**（Chrome 启动到监听端口要十几秒）；也可能是上一个实例未退出，换端口与 user-data-dir |
| 子进程被回收 | 上一步 spawn 的浏览器，下一步连不上 | **同一程序内完成全流程**；跨调用的浏览器进程会被清理 |
| --dump-dom 拿不到内容 | 输出为空或超时 | 对带长连接的 SPA 不可靠，改用 CDP 读 DOM |
| 中文回传出错 | UnicodeEncodeError: surrogates not allowed | 经中间层（shell / 管道）传中文会被破坏：在页面内用 btoa(unescape(encodeURIComponent(json))) 转 base64，接收端再解码 |
| 脚本含中文就崩 | 同上 | 脚本本身也避免直接写中文，用 Unicode 转义或 base64 传脚本 |

读什么：

`js
window.__DSH_BOOT__.entries                          // 模块图：谁进图了、rev 是多少
JSON.stringify(window.__DSH_BOOT__)                  // 完整图（含 inject / external 行）
document.querySelectorAll('[data-plugin-item]')      // 插件页条目
document.querySelectorAll('[data-plugin-config]')    // 配置区是否渲染
document.body.innerText                             // 整体文案（最省事的「它在不在」判定）
`

---

## 六、桌面版与 CLI 版差异取证：解析 Electron asar

桌面端（Electron）会把整个运行时打进 resources/app.asar。asar **可解析**：头部 + JSON 目录 + 文件内容（按 offset 定位），用 Node 几十行即可读，无需额外依赖。

`js
import { readFileSync } from 'node:fs'
const buf = readFileSync('<App>/resources/app.asar')
const headerSize = buf.readUInt32LE(12)          // pickle 头里的目录长度
const dir = JSON.parse(buf.slice(16, 16 + headerSize).toString('utf8').replace(/[\u0000]+$/, ''))
const files = []
const walk = (node, prefix) => {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (v.files) walk(v, p)
    else files.push({ path: p, size: v.size, offset: v.offset })
  }
}
walk(dir, '')
const BASE = 16 + headerSize
const extract = (rel) => {
  const f = files.find(x => x.path === rel)
  return f ? buf.slice(BASE + Number(f.offset), BASE + Number(f.offset) + f.size).toString('utf8') : null
}
// 把桌面端内置的某个包源码提出来，与 CLI 版逐字对比
console.log(extract('/dsh/node_modules/@deepseek-ai/<pkg>/lib/client.js')?.length)  // 本机 asar 顶层是 dsh/，不是 /app/
`

用途：

- 确认桌面端**确有**你依赖的插槽与服务（注意：字符串存在 ≠ 被声明为 children，要连带读出 children 表确认）；
- 对比桌面端与 CLI 版同一包是否一致——**版本差异是「CLI 能显示、桌面端不能」这类问题的头号嫌疑**；
- 顺带拿到桌面端的运行时目录结构与启动入口。

---

## 七、经验清单（交付前逐条过）

| 检查项 | 判定动作 |
| --- | --- |
| 一个功能只占一个入口 | 数 ctx.slots.inject 的调用数，每个都能对应到一个**不同**的界面功能 |
| 落点的 key/id 与宿主匹配键一致 | plugins.bundle.config 用**包名**；其余见 §二 映射表 |
| 没有「注册了但永不触发」的落点 | 每个 inject 的插槽，都能在宿主源码里找到声明它的 children 表 |
| 客户端代码本身能跑 | 用 §四 的 Node factory 探针跑一遍 apply，确认无异常、参数正确 |
| 界面上真的出现了 | 真机（§五）读 data-plugin-config 与 body.innerText，**不是**看接口 200 |
| 改完重启过 | 桌面端完全退出再启动；确认 boot 图里的 rev 已变（§三） |
| 用户报「不显示」时先问位置 | 明确他到的是哪个界面（§二.3 三分法），别直接改代码 |
| UI 落点无扩散 | 门禁里加一条反向断言（§四 末尾），锁死落点集合 |

---

## 相关文档

- [web-ui-slots-and-styling.md](./web-ui-slots-and-styling.md)：插槽层级树、主题令牌、primitives 复用
- [settings-and-plugin-ui.md](./settings-and-plugin-ui.md)：设置窗口与插件管理页的完整结构、卡片元数据契约
- [silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)：静默失效的三类根因与门禁写法
- [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)：调试回路、伪 API 黑名单、免启动反证法
- [three-roles.md](./three-roles.md)：双面插件的角色与包结构
