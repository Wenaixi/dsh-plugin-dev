# 源码至上：三层来源、跨平台定位与工作目录缓存

> 适用范围：任何 DSH 插件的编写、审查与排错。
> 核心命题：**参考文档是导航，不是答案。** API、字段、服务名、事件语义与默认值的最终裁决权在目标运行时的真实源码。看完本技能库仍不读源码就动手写插件，等于在别人的记忆上盖房子。

---

## 零、不可协商的前置动作

开发、修改、审查或调试任何 DSH 插件之前，必须完成三件事，缺一件都不算"已核对"：

1. **确认目标运行时与版本**——CLI 形态还是桌面版形态、哪个版本、哪个 profile。
2. **按 §一 的顺序打开真实源码**——读到你要依赖的那一行，而不是读到一篇总结。
3. **把读到的契约写下来**——包名、注入名、字段、返回结构、路径。写不出来说明还没读到源码。

可失败检验：**让你指出某个契约出自哪个包的哪个文件。指不出来，就等于没读。**

---

## 一、三层来源与固定顺序

上层的存在意味着下层只是交叉验证；只有上层全部缺失才下沉。

**核心纪律：先读本机安装的源码，读到了就不要解包。** 这是"这台机器上真正会被执行的那份代码"，与目标运行时版本完全一致，且**没有混淆**——真实标识符、导出名与注释全部保留，可直接读。解包桌面版不只是多余动作，还会引入版本不一致的风险。

### 第 1 层：本机已安装的源码（首选，命中即停，不再解包）

按顺序探测，**命中即停**：

| 序 | 来源 | 探测命令 |
| --- | --- | --- |
| 1a | pnpm 全局安装 | `pnpm root -g` |
| 1b | npm 全局安装 | `npm root -g` |
| 1c | profile 内直连依赖 | `<dshHome>/profiles/<profile>/node_modules/<pkg>/` |
| 1d | profile 内 isolated 实体 | `<dshHome>/profiles/<profile>/node_modules/.pnpm/<转义名>/node_modules/<pkg>/` |

```bash
pnpm root -g     # 先问 pnpm
npm root -g      # pnpm 没有再问 npm
```

dsh 本体与全部官方包在 ``<全局根>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/``，本体自身的 CLI 入口在 ``<全局根>/node_modules/@deepseek-ai/dsh/lib/`。

pnpm 全局根各平台形态不同，且带版本目录，必须以实际输出为准：

| 平台 | pnpm 全局根形态 |
| --- | --- |
| Windows | `<pnpm home>\\global\\v<大版本>/`（可能没有 `node_modules` 子目录） |
| macOS | `~/Library/pnpm/global/<大版本>/` |
| Linux | `<XDG data home>/pnpm/global/<大版本>/` |

**isolated 布局的目录名转义**：pnpm 把包名压成扁平目录名，`@scope/name@版本` 变成 `@scope+name@版本`，并可能追加 peer 依赖哈希后缀。例如 `@deepseek-ai/dsh-agent@0.2.0-rc.2` 在 profile 里是 `<profile>/node_modules/.pnpm/@deepseek-ai+dsh-agent@<版本>_<peer哈希>/node_modules/@deepseek-ai/dsh-agent/`。**不要把转义后的名字当包名**，读它的 `package.json` 取真实 `name`。

**阅读入口，从便宜到贵**：

1. `<pkg>/package.json`：`name`、`version`、`exports`、`files`、`repository.directory`（仓库相对路径的唯一真源）、`inject`、`dsh.client`。
2. `<pkg>/lib/types/*.d.ts`：契约签名、Config 类型、Context 挂载的 declare module 声明。**先查这里**——查签名比读实现快得多。
3. `<pkg>/lib/index.js`：真实实现与内联 JSDoc。**未混淆**，标识符与导出名原样保留，注释占比通常两成以上。
4. `<pkg>/README.md`：组合规则与设计理由（官方各包配 `README.md` 与 `README.zh.md`，中英双语）。

**只有一种情况才需要云端仓库**：想看 TypeScript 原始写法（本层是编译后的 `lib/`，没有 `src/`，类型已擦除、模块被内联重排）。查契约永远不需要。

### 第 2 层：桌面版解包到缓存目录

**唯一触发条件**：第 1 层四个来源全部落空——pnpm 与 npm 都没装 dsh，profile 里也没有，本机只装了桌面版。**只要第 1 层命中，就不要解包**：多解一份只会引入版本不一致的风险，没有任何额外收益。桌面版的 dsh 本体在 asar 容器内：

```text
<应用根>/resources/app.asar/dsh/node_modules/@deepseek-ai/<pkg>/lib/index.js
```

asar 是可解析的容器（头部 + JSON 目录 + 按 offset 定位），不需要额外依赖。**不要原地解包**，解到工作目录里被 git 忽略的缓存目录，跨平台写法一致、可随时重建、不会污染任何既有环境：

```text
.cache-repos/
  asar/@deepseek-ai/<pkg>/...     # 从桌面版按需解出的包
  upstream/                        # 可选：上游仓库浅克隆（见 §三）
```

按需只解目标包，不要整包解：

```js
// node <脚本路径> <app.asar 绝对路径> <输出目录> <包名...>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [asarPath, outRoot, ...pkgs] = process.argv.slice(2)
const buf = readFileSync(asarPath)
const headerSize = buf.readUInt32LE(12)
const dir = JSON.parse(buf.slice(16, 16 + headerSize).toString('utf8').replace(/\0+$/, ''))

const entries = new Map()
const walk = (node, prefix) => {
  for (const [name, v] of Object.entries(node.files ?? {})) {
    const p = prefix + '/' + name
    if (v.files) walk(v, p)
    else entries.set(p, v)
  }
}
walk(dir, '')
const BASE = 16 + headerSize

for (const pkg of pkgs) {
  const prefix = `/dsh/node_modules/@deepseek-ai/${pkg}/`
  for (const [p, v] of entries) {
    if (!p.startsWith(prefix)) continue
    const dest = join(outRoot, '@deepseek-ai', pkg, p.slice(prefix.length))
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf.subarray(BASE + Number(v.offset), BASE + Number(v.offset) + v.size))
  }
}
```

**踩坑**：某些工具链在 Electron 进程内用普通 fs 读 `app.asar` 会命中 asar 钩子（拿到打包目录视图而非文件内容），需 `node:original-fs` 绕过，或如上另起独立 Node 进程解析。

### 第 3 层：云端上游仓库

本机完全没有可用源码（换机器、只拿到文档、CI 环境）时才用。默认分支与包清单以官方仓库实际为准，**不要从文档站散文反推仓库结构**：

| 资源 | 地址 |
| --- | --- |
| 主仓库 | https://github.com/deepseek-ai/deepseek-harness |
| 包清单 | `packages/README.md` |
| 模块依赖图 | `docs/module-graph.md` |
| 单包说明 | `packages/<域>/<包名>/README.md` |

```bash
git clone --filter=blob:none --depth 1 https://github.com/deepseek-ai/deepseek-harness .cache-repos/upstream
```

---

## 二、仓库相对路径不是猜的

每个已发布包的 `package.json` 里 `repository.directory` 就是它在 monorepo 里的确切位置（vendored 包在 `vendor/`）。**只要读到第 1 或第 2 层的 `package.json`，就已经拿到了准确的仓库相对路径，无需联网。**

本技能库各专题末尾的「相关 DSH 源码」一律采用 `仓库相对路径 ← 包名@版本` 格式，由该字段生成，不手写推测：

```text
packages/core/tools/lib/index.js  <-  @deepseek-ai/dsh-tools@<版本>
vendor/cordis/lib/index.js        <-  @deepseek-ai/cordis@<版本>
```

版本号必须从 `package.json` 的 `version` 读出，不从记忆或文档站取。版本与文档结论不一致时，说明该文档需要重核。

---

## 三、冲突裁决顺序

同一事实出现分歧时，从上往下取，冲突即以下层为准并回写本库：

```text
1. 运行时真实行为（探针、启动日志、接口回读）
2. 本机已安装源码（lib/index.js 实现 + 内联 JSDoc，以及 lib/types/*.d.ts 声明）；本机没有时才用解包源码
3. 包内 README.md
4. 官方文档站散文
5. 社区实现与本技能库正文
```

第 5 级不是"低劣来源"，而是"允许过时"：一旦被使用，立刻回到第 1-2 级复核。发现本库正文与源码冲突时，**改本库，不改源码**，并在 `CLAUDE.md` 追加校准记录。

---

## 四、跨平台差异的定位方法

DSH 的用户数据根是跨平台统一的——源码里只有 `homedir()/.dsh` 与 `DSH_HOME` 覆盖两档，没有 XDG 分支、没有平台分支判断。因此差异不在 DSH 内部，而在**宿主把它装在哪**。

| 差异点 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| 默认用户数据根 | `%USERPROFILE%\.dsh` | `~/.dsh` | `~/.dsh` |
| pnpm 全局根 | `<pnpm home>\global\v<大版本>/` | `~/Library/pnpm/global/<大版本>/` | `<XDG data home>/pnpm/global/<大版本>/` |
| npm 全局根 | `%APPDATA%\npm\node_modules` | `<npm prefix>/lib/node_modules` | `<npm prefix>/lib/node_modules` |
| 桌面版 asar | `<安装目录>\resources\app.asar` | `<App>.app/Contents/Resources/app.asar` | 无官方桌面版 |
| 桌面版自带 CLI | `resources\runtime\cli\bin\dsh.cmd` | `Contents/Resources/runtime/cli/bin/dsh` | 无 |
| 沙箱实现 | ACL / WRITE_RESTRICTED 令牌 | Seatbelt | Landlock |

上表只作为探测起点。**写工具、脚本或文档时一律先探测再使用**；探测不到就明确报"未找到"，不要静默回退到猜测路径——静默回退正是"路径写错却以为已核对"的来源。`<npm prefix>` 在 macOS 需 `npm prefix -g` 确认（Homebrew Node 常落在 `/opt/homebrew/lib`）。

---

## 五、缓存目录约定

- 位置：工作目录下 `.cache-repos/`（解包产物）与 `.cache-repos/upstream/`（可选克隆）。
- 必须写入 `.gitignore`，不入库、不提交。
- 允许的代价：占磁盘、随时可删。禁止的代价：污染真实 profile、覆盖已安装包、把机器路径固化进文档。
- 重建后文档里的路径引用仍然写**仓库相对路径 + 包名 + 版本号**，不写缓存目录路径。缓存目录是取证工具，不是引用目标。

---

## 六、自检清单

| 检查项 | 判定动作 |
| --- | --- |
| 知道目标运行时与版本 | 能说出形态、版本号、从哪读到的 |
| 来源顺序没走错 | 先 pnpm 再 npm；pnpm 命中就没有再去解包桌面版 |
| 没混读两份实现 | 同机 pnpm 与桌面版可能版本不同，只用命中那一层 |
| 没多此一举解包 | 第 1 层命中就没去解包桌面版，也就没引入第二份实现 |
| 读过目标包源码 | 能指出"包名 + 文件 + 行号" |
| 查过类型声明 | 契约问题先查 `lib/types/*.d.ts`，没有靠读实现猜 |
| 版本号有来源 | 从 `package.json` 的 `version` 或运行时版本清单读出 |
| 路径写对 | 用 `repository.directory` 或实际目录列表验证过 |
| 冲突已裁决 | 与文档站冲突时以源码为准，并已回写本库 |
| 缓存不入库 | `git status` 干净，`.gitignore` 已含缓存目录 |
| 跨平台可迁移 | 文档与脚本没有硬编码单平台路径 |

---

## 相关文档

- [official-upstream-and-docs.md](./official-upstream-and-docs.md)：上游仓库与文档站索引、包结构速读、版本回溯流程
- [isolated-instance-acceptance.md](./isolated-instance-acceptance.md)：读懂源码之后的隔离实例验收流程
- [silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)：零报错失效的三类根因与可失败门禁

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
apps/cli  <-  @deepseek-ai/dsh@0.2.0-rc.2
packages/boot/app-boot  <-  @deepseek-ai/dsh-app-boot@0.2.0-rc.2
packages/util/home-paths  <-  @deepseek-ai/dsh-home-paths@0.2.0-rc.2
```
