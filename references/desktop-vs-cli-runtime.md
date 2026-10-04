# DSH 桌面版 (Electron) 与 CLI Web 运行时的差异、共性与插件工程实践 (DSH 0.2.0-rc.2)

> 适用：所有需要"在两种宿主上都正确工作"的插件开发者，以及需要在两者之间迁移插件与配置的运维场景。
> 本篇提炼自一次真实的跨运行时迁移与排障：同一个插件包在 CLI Web 上正常、在桌面版上却不出现，以及桌面版 profile 因文件缺失而损坏的完整定位过程。
> 只保留与具体插件、具体机器无关的通用机制。

---

## 零、为什么要先区分运行时

DSH 有两种主流宿主形态，它们的**插件包格式完全相同**，但**运行时来源、依赖布局、profile 管理权、客户端刷新方式**全都不同。把两者当成一回事，会连续踩三类坑：

`text
① 改了配置没生效        → 改错了那一份（GUI 读的和 CLI 读的不是同一个文件层）
② 插件装了却不出现      → 装进了 dependencies，但没进 profile 的 bundles
③ 代码改了界面没变      → 客户端产物是长缓存，桌面版必须完全重启
`

---

## 一、两种运行时的物理形态

### 1. CLI Web 形态

- dsh 本体来自 **npm 全局安装**（例如 `<npm 全局根>/node_modules/@deepseek-ai/dsh`），或某个独立的 CLI 发行包。
- 启动方式：`dsh <profile> [app-args]`，例如 `dsh web --port 3080`。
- profile 实体：`$DSH_HOME/profiles/<name>/`，是标准的 pnpm 项目。
- 依赖布局：通常是 **isolated**（pnpm 默认，`node_modules/.pnpm` 下有真实 store 与符号链接）。

### 2. 桌面版 (Electron) 形态

- 应用目录（示例结构）：

`text
<App>/                               ← Electron 应用根
  <Product>.exe                      ← 主程序
  resources/
    app.asar/dsh/                    ← 【dsh 运行时打在这里】（全部 @deepseek-ai 官方包，清单以 desktop-runtime.json 的 sharedPackages 字段为准；asar 顶层另有 Electron 主进程自用的共享依赖，以 app.asar/node_modules 为准）
    app.asar.unpacked/
    runtime/
      cli/bin/dsh.cmd                ← 桌面版自带的 CLI 入口
      primary-runtime/dependencies/  ← 自带的 node / pnpm / python（版本独立于系统）
      primary-runtime/runtime.json   ← python 版本与完整 pythonPackages 清单
      versions.json                  ← 仅 {schemaVersion, node, pnpm}
`

- **dsh 本体与全部官方包都在 `app.asar` 的 `dsh/` 子目录内**，不在 profile 的 `node_modules` 里。
- profile 实体仍在 `$DSH_HOME/profiles/<name>/`，**结构与 CLI 完全一致**。
- 依赖布局：常见 **hoisted**（`nodeLinker: hoisted`，顶层扁平、`.pnpm` 下只有 `lock.yaml`）。
- `runtime/versions.json` 只含 `{schemaVersion, node, pnpm}` 三个键，**没有 python**；python 版本在 `primary-runtime/runtime.json`（版本随发行漂移，以该文件为准；捆绑基线见 `versions.json` 与 `desktop-runtime.json`）。

### 3. 对照表

| 维度 | CLI Web | 桌面版 (Electron) |
| --- | --- | --- |
| dsh 本体来源 | npm 全局包 | `resources/app.asar` 的 `dsh/` 子目录 |
| 官方包位置 | 全局 `node_modules` | asar 内 |
| profile 目录 | `$DSH_HOME/profiles/<name>` | **相同** |
| 配置文件名 | `cordis.patch.yml` | **相同** |
| 依赖布局 | 多为 isolated | 多为 hoisted |
| 客户端刷新 | HMR 或重启进程 | **必须完全重启应用** |
| profile 管理权 | 完全可用 | **被 Electron 独占**（有例外，见 §二） |
| 凭据存储 | `$DSH_HOME/.credentials.yaml` | **相同（全局共享）** |

---

## 二、profile 管理权：桌面版被独占，但没到完全不可用

桌面版的 profile 由 Electron 应用管理，CLI 对它的一部分操作会被**明确拒绝**：

`text
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
`

**但这不等于完全不能碰**。实测可用的操作：

| 操作 | CLI 可用性 | 说明 |
| --- | --- | --- |
| `--dump-config` / 组合树打印 | ❌ 被拒 | 属于"启动/组合"路径 |
| `plugin --profile <desktop> list` | ✅ 可用 | 只读清单 |
| `plugin --profile <desktop> add <pkg>` | ✅ 可用 | 真正安装并改 profile 清单 |
| `plugin --profile <desktop> remove <pkg>` | ✅ 可用 | 真正卸载 |
| 直接用 fs 改 profile 的 `package.json` / `cordis.patch.yml` | ✅ 可行 | 但要手动维护一致性 |

**前提（仅对 plugin 子命令成立）**：桌面 profile 的插件操作需用**桌面版自带的** CLI（`<App>/resources/runtime/cli/bin/dsh.cmd`，`manageDesktopProfile=true`）；dump/boot 对 desktop 无论哪份 CLI 一律被拒。

**拒绝机制**：`rejectElectronProfile` 对 desktop 拒绝 CLI 侧的 dump/boot/plugin 等入口（dsh/lib/bin.js）；`plugin` 子命令在 `manageDesktopProfile` 为 true（桌面自带 CLI 经 `runDesktopCli` 传入）时放行；dump-config/boot 对任意非 desktop profile（含桌面 CLI 调 web）均可用。

### 两个 dsh 命令的路径冲突

桌面版安装器会提供一个 `dsh` 命令，但 **npm 全局的 `dsh` 往往优先级更高**，导致 `dsh --version` 返回的是另一个运行时。判定与规避：

`text
where dsh                      # 看实际解析到哪一个
npm 全局那份（%APPDATA%\\npm/dsh.cmd，即 npm 全局 bin，非 pnpm）  = CLI 形态
桌面版那份（<App>/resources/runtime/cli/bin/dsh.cmd） = 桌面版形态
`

**结论**：凡是要操作桌面版 profile，一律**用绝对路径调桌面版那份** `dsh.cmd`，不要依赖 PATH。

### 参数形式的一个坑

`text
dsh web --port 8080            # ✅ 第一个位置参数即 profile 名（launcher 展开为 --profile web；web 是官方内置 profile，读者自己的 profile 用 <name>）
dsh --profile web --port 8080   # ✅ 等价
dsh web --profile web           # ❌ 展开后 --profile 出现两次 -> select a profile only once
dsh --profile web web           # 等价 dsh web web：web 成为 app-args；与 --dump-config 等 launcher 形态互斥时报 config dumps take no app arguments（实测）
`

另外：`select a profile only once` 在命令行重复传 `--profile` 或位置参数展开后撞上显式 `--profile` 时触发（launcher 未读取任何 `DSH_PROFILE` 环境变量；shell-env 注入的是出站环境的 `DSH_PROFILE` 值，与选中 profile 无关）。

---

## 三、依赖布局差异带来的连锁反应

| 布局 | 特征 | 易踩的坑 |
| --- | --- | --- |
| **isolated**（pnpm 默认布局） | `.pnpm` 下有真实 store，顶层是符号链接 | 改顶层文件等于改 store；缓存清理影响面大；注意 DSH 生成的 profile 模板默认 `nodeLinker: hoisted` |
| **hoisted** | 顶层是真实文件，`.pnpm` 下只有 `lock.yaml` | **文件被删时 pnpm 不检测**（见 §九） |

**推论**：在 hoisted 布局下"直接往 `node_modules/<pkg>` 里补文件"是**可行性较高**的应急修复手段（顶层就是真身）；但改完要自己保证与 lockfile 语义一致。

---

## 四、客户端产物的刷新：桌面版必须完全重启

客户端 bundle 的响应头由 dsh-client-modules 发出：

`text
Cache-Control: public, max-age=31536000, immutable
`

URL 形如 `/plugins/??<包id>/client.js&rev=<framedHash>`——**rev 由产物 mtime/ctime/size 派生，非内容哈希**（artifactRevision），内容变则哈希变。由此：

- 浏览器刷新、重开面板、重开设置窗口**都不够**；桌面版（Electron）必须**完全退出应用再启动**。
- 开发期由 dev:web 重建 client bundle，client-hmr（/plugins/events SSE）自动热替换插件条目；桌面版组合树同样含 client-hmr 行，但 client bundle 在 asar 内、没有 dev:web 重建路径，实际只能重启应用生效。

**更隐蔽的是版本时序**：插件卡片显示的版本号来自宿主读 `package.json`，而界面来自 client bundle，**两者更新不同步**，会出现「卡片已显示新版本、界面还是旧版」的假象，极易误判成"改了没生效"。

判定动作：读页面里的实际 rev，或直接请求 bundle URL 看内容。

---

## 五、官方包由运行时提供——最重要的共性推论

**官方包（`@deepseek-ai/*`）不需要装进 profile**：无论是 CLI 的全局 `node_modules` 还是桌面版的 asar，都自带完整一套。

由此推出三条实践规则：

1. **profile 的 `dependencies` 里只应出现第三方插件**；官方包出现在里面多半是历史遗留或误装。
2. **但官方插件的「配置」必须写在 profile 的 `cordis.patch.yml` 里**——配置按 `- id:` 定位运行时中的插件条目，与"是否安装"无关。
3. 因此「配置文件里出现官方包名」是**正常且必要的**，不代表装了这个包。

> 判定某官方包是否由运行时提供：桌面版解析 `app.asar` 查 `/@deepseek-ai/<pkg>/package.json`；CLI 直接看全局 `node_modules`。缺失才需要装。

---

## 六、配置层的差异与迁移

### 1. 同一位置、不同内容

两种运行时的配置文件都在 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，**机制完全一致**（顶层 YAML 数组，`- id:` 覆盖运行时条目，`- insert:` 追加新条目）。但**内容规模可以差很多**：

- 桌面版补丁常含 **GUI 专属覆盖段**（覆盖 asar 内默认值的整行替换，段内注释常注明"改 npm 那份对 GUI 无效"）；迁移时这些段必须整段保留、不覆盖。
- 这些特有段**迁移时绝不能覆盖**。

### 2. 迁移方法论（安全顺序）

`text
① 先备份：package.json、cordis.patch.yml、pnpm-lock.yaml、pnpm-workspace.yaml
② 对比条目集合（按 id 求差集）：仅源有 → 追加；仅目标有 → 保留
③ 同名条目逐条比内容：保留"字段更完整"或"目标特有"的那份，不要盲目覆盖
④ 追加时放在文件末尾，并加显式分界注释（标明来源与日期）
⑤ 追加后做 YAML 语法校验 + 真实解析验证（不要只看文件写没写进去）
⑥ 全程让目标 profile 处于"未被应用占用"状态（桌面版先完全退出）
`

**分界注释的重要性**：日后要回滚或二次迁移时，一眼能看出哪些是外来的。

### 3. 迁移后的必做验证

| 检查 | 动作 |
| --- | --- |
| YAML 能解析 | 用 yaml 解析器读一遍，确认条目数与自己预期一致 |
| 运行时能解析 | 用**目标运行时的** CLI 跑 `plugin --profile <name> list`，确认零报错 |
| 关键事项逐条核对 | 例如默认模型、供应商定义、密钥引用是否都有对应凭据 |

### 4. 密钥与凭据的位置

| 文件 | 作用 | 作用域 |
| --- | --- | --- |
| `$DSH_HOME/.credentials.yaml` | 结构化凭据存储（`refs` 段存 API key） | **全局，所有 profile 共享** |
| `$DSH_HOME/.env` | 供配置里 `!!js process.env.XXX` 引用的环境变量 | **全局** |

**推论**：迁移"模型/供应商"类配置时，只要引用的 key 名在全局凭据里已存在，**迁完即可用**，不需要在目标 profile 里重复配置密钥。反之，若配置引用了 `apiKeyEnv: XXX` 而凭据里没有 `XXX`，模型就不可用——**迁移前先用两处对照检查一遍**。注意 resolve 分层不止凭据文件：进程环境 > `.credentials.yaml` > 项目 `.env` > 用户 `.env`（credentials-local:473-490）。

---

## 七、桌面版内部取证：解析 app.asar

asar 是**可解析**的容器（头部 + JSON 目录 + 按 offset 定位的内容），用 Node 几十行即可读出任意文件，无需额外依赖：

`js
import { readFileSync } from 'node:fs'
const buf = readFileSync('<App>/resources/app.asar')
const headerSize = buf.readUInt32LE(12)                       // pickle 头里的目录长度
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
`

**注意**：在 Electron **进程内**用 `node:fs` 读 `app.asar` 会命中 asar 钩子（读到的是打包目录而非文件内容）；需用 `node:original-fs` 绕过，或起一个独立 Node 进程去解析。上面的示例是独立进程视角。

**三个高价值用途**：

1. **确认某包由运行时提供**（决定 profile 要不要装它）；
2. **对比桌面版与 CLI 版同一包是否一致**——版本差异是「CLI 正常、桌面版异常」类问题的头号嫌疑；
3. **确认依赖的 peer 包是否都在**（例如插件 peer 依赖某官方包，可直接在 asar 里点名查找）。

---

## 八、装了 ≠ 挂载：dependencies 与 bundles 是两件事

`js
// profile/package.json
{
  "dependencies": { "<pkg>": "^1.0.0" },          // ① 只是"装进来"
  "dsh": { "profile": { "bundles": ["<pkg>"] } }  // ② 才是"挂上去"
}
`

- `dependencies` 决定包是否存在于 `node_modules`；
- **`dsh.profile.bundles` 决定它是否作为补丁层参与组合**；
- 只有 ① 没有 ② 的插件：**装是装上了，但完全不生效，且不会报错**。

**判定动作**：安装后立刻检查 `dsh.profile.bundles` 是否包含该包；对"已安装但行为像没装"的插件，第一件事就是查 bundles。

### bundle 型与非 bundle 型

- 声明了 `dsh.bundle` 的包：`plugin add` 会自动把它加入 `bundles`。
- 未声明的包：安装时给出明确警告——

`text
warning: <pkg> declares no dsh.bundle — installed as a plain dependency, not a profile layer
`

  这类包（多为官方 UI 包）**只作为普通依赖**，不进 bundles，也不需要进。

---

## 九、pnpm 不检测文件缺失（一个真实的连锁故障）

**现象**：profile 里若干插件目录只剩子目录，散文件（`package.json`、`cordis.patch.yml`…）全部消失，宿主报：

`text
cannot resolve profile bundle "<pkg>" ...
failed to read overlay .../<pkg>/cordis.patch.yml: ENOENT
`

**修复时连续撞墙**：

| 尝试 | 结果 |
| --- | --- |
| `plugin --profile <name> install` | "Already up to date" —— 不修 |
| `pnpm install --force` | 仍 "Already up to date" |
| 删掉受损目录后 `pnpm install` | 仍 "Already up to date" |
| 删除 `node_modules/.modules.yaml` 后重装 | 仍 "Already up to date" |

**原因**：pnpm 的一致性判断基于 **lockfile 与状态记录**，**不校验已安装文件是否真的存在**。hoisted 布局下 `.pnpm` 只有一个 `lock.yaml`，更无从比对。

**可行的修复路径（按优先级）**：

1. **从 registry 重新拉包，解包覆盖**（最可控，绕开 pnpm）：

`text
npm pack <pkg>@<version> --pack-destination <tmp>
tar -xzf <tmp>/<pkg>-<version>.tgz -C <tmp>
# tarball 内是 package/ 前缀，整体拷回 node_modules/<pkg>
`

2. 整目录重装：删除该包目录后，用**目标运行时的 pnpm**（桌面版自带 `primary-runtime/dependencies/pnpm/bin/pnpm.mjs`）以 `node <pnpm.mjs> install` 重建。

3. 恢复后用 `plugin --profile <name> list` 验证（**报错消失**才算修好，不能只看目录回来了）。

> 附带教训：这类"目录在、文件没了"的损坏，**pnpm 侧零报错**，只有宿主解析时才炸。定期用"抽样读 package.json"的探针扫一遍 `node_modules` 能提前发现。

---

## 十、跨运行时交付清单

| 检查项 | 判定动作 |
| --- | --- |
| 目标 profile 未被应用占用 | 桌面版**完全退出**再操作 |
| 用的是正确的那份 CLI | 用绝对路径调目标运行时的 `dsh.cmd`，别信 PATH |
| profile 清单一致 | `dependencies` 与 `dsh.profile.bundles` 逐条对比，确认"装的都挂了" |
| 官方包没有误装 | 与运行时（asar / 全局 node_modules）对照，多余的卸掉 |
| 配置已迁移且不冲突 | 追加而非覆盖；同名条目保留更完整的那份；有分界注释 |
| 配置引用的凭据存在 | 配置里的 `apiKeyEnv` / `process.env.XXX` 能在全局凭据中找到 |
| YAML 与运行时双重校验 | 解析器读一遍 + `plugin list` 零报错 |
| 改完完全重启 | 桌面版退出应用再启动，并确认 boot 图里的 rev 已变 |

---

## 相关文档

- [three-roles.md](./three-roles.md)：双面插件（Host + Client）的角色与包结构
- [packaging.md](./packaging.md)：打包、发布与工作区开发
- [config.md](./config.md)：补丁系统与四层生效顺序
- [install-resolution-traps.md](./install-resolution-traps.md)：版本解析陷阱与 profile 专属边界
- [client-ui-placement-and-verification.md](./client-ui-placement-and-verification.md)：客户端 UI 落点、静默失效与真机取证
- [debugging-and-troubleshooting.md](./debugging-and-troubleshooting.md)：调试回路与伪 API 黑名单
