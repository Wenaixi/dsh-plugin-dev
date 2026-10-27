# 插件安装版本解析陷阱：冷却期、预发布排序与兼容性闸门

> 本文件记录 DSH 插件安装链路上最容易误诊为「缓存过期」的三类根因，以及可复现的判定与修复手法。
> 本文区分 DSH 宿主行为与 pnpm 包管理器行为。版本、默认值和解析策略会随工具链变化，使用前请分别查看目标 pnpm 的帮助/配置与 DSH 实际安装物。

---

## 一、症状：装到了过时的旧版本，随后被兼容性闸门拒绝

典型报错形态：

```text
dependencies:
+ <scope>/<plugin> <old-version>
Packages: +2
Done in 997ms using pnpm v11.7.0

dsh: installation rejected: Plugin <scope>/<plugin>@<old-version> is incompatible
with the target DSH release: peerDependencies {"@deepseek-ai/dsh-skill":"<old-peer-range>"}
dsh: restored package.json, pnpm-lock.yaml, and node_modules.
```

**极易误读之处**：报错说「版本不兼容」，但**版本号不是人选的**。包管理器解析出一个陈旧的预发布版本（上例中的 <old-version>），才是真正的病灶；兼容性闸门只是把它拦下来了。

排障第一步永远是**先确认解析到了哪个版本、为什么是它**，而不是去调 peerDependencies 范围或申请豁免。

---

## 二、根因一：pnpm 发布冷却期（minimumReleaseAge）

### 2.1 机制

发布冷却期是 **pnpm 自身的配置项**（`minimumReleaseAge`，单位分钟）。目标 pnpm 版本可能提供内置默认值，也可能由配置覆盖；请用目标版本的配置查询确认。启用后，新版本发布不满阈值时可能被排除，解析回退到更早的合格版本。该机制由包管理器实现，不由 DSH 契约决定；排障时要把包管理器解析结果与 DSH 兼容性检查分开验证。

关键点：**方向与直觉相反**。不是「新版本太新不能装」，而是**只有发布满阈值的版本才被考虑**，于是新版本被排除后解析回退到上一个「已满阈值」的合格版本（不是无限跌到底：pnpm 按发布时间取最近候选，阈值过长直接报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION` 拒绝）。DSH 侧真正的兼容闸门是 **peer 兼容性预检 + allow-version 精确版本豁免**（写入 profile 的 `compatibility.json`，见第四节），与冷却期是两条独立机制。

### 2.2 时间指纹（判定冷却期的决定性证据）

同一探针命令在不同时刻执行，解析结果会自动前移：

| 执行时刻 | 解析结果 | 原因 |
| --- | --- | --- |
| T0 | `<某预发布版>` | 最新候选发布不足 24h，被排除 |
| T0 + 若干小时 | `<更新的预发布版>` | 它刚好跨过 24h 门槛，自动放行 |

**同一个包、同一条命令，结果随时间自己往前爬 —— 这是冷却期的唯一指纹。** 缓存问题不会这样，缓存问题的表现是「结果一直不变」。

### 2.3 参数实验（可直接复现）

```powershell
$t = Join-Path $env:TEMP "probe"; New-Item -ItemType Directory -Path $t | Out-Null
Set-Location $t; '{"name":"p","private":true}' | Set-Content package.json -Encoding utf8

pnpm add <pkg> --lockfile-only                                    # 默认
pnpm add <pkg> --lockfile-only --config.minimum-release-age=0      # 关闭冷却
pnpm add <pkg> --lockfile-only --config.minimum-release-age=1200   # 20 小时门槛
```

把门槛设成 1200（20h），若解析结果精确落在「发布满 20 小时、不满 24 小时」的那个版本上，冷却期即被坐实。

### 2.4 精确版本不受冷却期限制

```powershell
pnpm add <pkg>@4.10.0-dsh.4 --lockfile-only   # 发布仅 9.5h，依然安装成功
```

精确 spec 在未显式开启 strict 时会被 pnpm **自动登记进 `minimumReleaseAgeExclude`**（写 pnpm-workspace.yaml，实测精确安装 9 小时前版本成功且自动写入 exclude）从而放行；显式设置了 strict 时精确版本同样被冷却拒绝。这是**最小侵入的应急手段**，也是判定「是否为冷却期问题」的快速验证法。

---

## 三、根因二：semver 预发布排序陷阱（与冷却期叠加放大）

带预发布后缀的版本号（如 `4.10.0-dsh.4`）在 semver 里是 **prerelease**，排序低于同号正式版，高于上一个次版本号的所有正式版。实测（semver 7.8.5）：

```text
compare('4.10.0-dsh.4', '4.9.0-dsh.5')          = 1        # 4.10.0-dsh.4 更新
maxSatisfying(allVersions, '*')                  = 4.9.0   # 不是任何 4.10.0-dsh.x
maxSatisfying(allVersions, '*', {includePrerelease:true}) = 4.10.0-dsh.4
maxSatisfying(allVersions, '4.x')                = 4.9.0
maxSatisfying(allVersions, '^4.10.0')           = null
```

两个致命后果：

1. **semver 库层面**：不带 `includePrerelease` 时范围不匹配 prerelease（`maxSatisfying(vers, '*')` 返回正式版而非 `4.10.0-dsh.x`）；**但 pnpm 的 registry 解析把 prerelease 纳入候选**（按发布时间取满足范围且已过冷却期的最近版本，实测裸装解析到 `4.10.0-dsh.5` 而非 4.9.0），两者不可互推；
2. **pnpm 不回退到「最老合格版」**：实测回退链落在同系列较早的预发布版（阈值设得越长回退越深），阈值过长直接 `ERR_PNPM_NO_MATURE_MATCHING_VERSION` 拒绝；若持续拿不到新版，旧系列 peer 可能撞上 DSH 兼容闸门。

所以插件作者若采用 `<主>.<次>.<修订>-<dsh>.<序号>` 这类后缀发布，**应提醒使用者显式写精确版本（自动登记 exclude）、显式关闭冷却期（`minimumReleaseAge: 0`）或显式放行 `minimumReleaseAgeExclude`**，否则新发布的序号版会被 1 天冷却期挡在解析之外。

---

## 四、根因三：DSH 兼容性闸门的工作方式

### 4.1 两段式检查

dsh-plugin-manager 在安装前后各做一次 peer 兼容性评估（实现见 `@deepseek-ai/dsh-plugin-manager` 的 `lib/types/operations.js`）：

- **预检（安装前）**：对 registry spec 用 `pnpm view <spec> name version peerDependencies --json` 向注册表读清单（本地路径/链接 spec 读本地包），`evaluatePluginCompatibility(manifest, exemptions)` 判定；不兼容则直接拒绝，一个包都不装（输出 `nothing was installed`）。
- **后检（安装后）**：组合包组件的 peer 需要已安装内容才能评估，因此这一段落在 pnpm 已替换依赖树之后；一旦判定不兼容，插件管理器**恢复原始 `package.json` / `pnpm-lock.yaml` 并重新安装**，输出 `restored package.json, pnpm-lock.yaml, and node_modules`。

**所以「包管理器报 Done」不等于安装成功。** 报错文案里的 `installation rejected` 与 `restored` 是闸门介入的标志。

### 4.2 判定一个版本是否兼容

看该版本 `peerDependencies` 的区间是否覆盖宿主当前实际安装的版本。例如：

```text
<resolved-version>   peer @deepseek-ai/dsh-skill: <declared-range>
              若声明范围不覆盖目标宿主 → 不兼容

4.10.0-dsh.4  peer @deepseek-ai/dsh-skill: >=0.1.0-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0
              双区间覆盖目标宿主 → 兼容
```

跨 DSH 大版本升级时，双区间 peer（`>=A <B || >=C <D`）是同时兼容新旧宿主的正确写法。

### 4.3 豁免机制

```bash
dsh plugin --profile <profile> allow-version <pkg>@<exact-version> --dsh-version <exact-dsh> --accept-risk
```

豁免是**精确到版本对**的（包版本 + DSH 版本都必须精确匹配），落在 profile 的 `compatibility.json`。该文件**默认不存在**：读取端把 ENOENT 当作「无豁免」并标记可写（`readProfileCompatibility`），首次执行豁免才创建。豁免的对象是 **peer 兼容性检查**（DSH 侧闸门），与 pnpm 的发布冷却期无关——冷却期有自己的豁免入口 `minimumReleaseAgeExclude`（写 pnpm-workspace.yaml，精确安装时自动登记），与 DSH 的 allow-version 是两套无关机制；另有 `--config.minimum-release-age=0` 全局关闭。

**豁免只应作为最后手段**：它绕过的正是防止崩溃与数据丢失的那道闸门。优先修版本选择，不要用豁免掩盖解析错误。

---

## 五、Profile 目录结构与配置落点

每个 profile 就是一个独立 pnpm 项目，位于 `$DSH_HOME/profiles/<name>/`：

```text
~/.dsh/profiles/<name>/
  package.json           # 依赖清单 + dsh.profile.bundles（插件管理器自动维护）
  pnpm-lock.yaml         # 锁文件
  pnpm-workspace.yaml    # pnpm 工作区配置（nodeLinker / autoInstallPeers / minimumReleaseAge）
  cordis.patch.yml       # 该 profile 的配置补丁层
  cordis.yml             # 空根 entry list（Loader Include 锚点，每次启动被重写为空 []，勿手改）；看组合用 `dsh --profile <name> --dump-config`
  compatibility.json     # 精确版本豁免表（缺省不存在 = 无豁免且不自动创建，grant 时才生成）
  # 注意：cfg.log / cfg.err 不是通用 profile 产物（desktop profile 无、全部官方包零命中，仅个别 web 类 profile 出现）；启动日志在宿主 logs/ 目录
  .plugin-manager/logs/operation-*/pnpm.log   # 每次插件安装的完整 pnpm 输出
```

**排查安装问题的第一现场就是 `.plugin-manager/logs/` 下最新的 `pnpm.log`**，它完整记录了「解析到哪个版本、pnpm 是否成功、闸门是否介入」三段信息。

### 5.1 关闭冷却期（自研插件场景推荐）

编辑 `$DSH_HOME/profiles/<name>/pnpm-workspace.yaml`：

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

# 关闭发布冷却期（pnpm 11+ 内建默认 1440 分钟，这里是显式置 0 兜底）。
# 本 profile 安装自研/刚发布的插件，冷却期会让解析回退到过时版本，
# 进而撞上 DSH 的 peer 兼容性闸门。0 表示发布即可安装。
minimumReleaseAge: 0
```

等价的命令行覆盖（不改文件、仅本次生效）：

```powershell
pnpm add <pkg> --config.minimum-release-age=0
```

提示（已实测放宽）：BOM 或 CRLF 不会让 pnpm 的 YAML 解析把注释与后续配置黏成一行——pnpm 11/12 系列与 js-yaml/yaml 库对 BOM+CRLF+注释均正确解析（实测 `minimumReleaseAge: 0` 生效）。写完回读确认配置生效即可，不必担心字节头。

---

## 六、desktop profile 由 Electron 独占管理

```text
$ dsh plugin --profile desktop add <pkg>
error: profile "desktop" is managed exclusively by the Electron application
```

守卫位于 `dsh/lib/bin.js`，对 `profile.toLowerCase() === "desktop"` 直接拒绝所有 CLI 写入。

要点：

- 该 profile 的配置修改（包清单、锁文件、工作区配置）必须**在 Electron 应用界面里**完成，命令行改不动；
- 但插件管理器内部（含 Electron 侧发起安装）走的是同一条 pnpm 链路，所以 `pnpm-workspace.yaml` 的冷却期配置对 Electron 侧同样生效；
- 排查时不要试图用 CLI 修复 desktop profile 的安装失败。

---

## 七、标准排障决策表

| 现象 | 判定 | 处置 |
| --- | --- | --- |
| 解析版本明显过旧，且过一段时间后自动前移 | pnpm 冷却期（内建默认 1440）或预发布排序 | profile 配 `minimumReleaseAge: 0`，或改用精确版本 |
| 解析版本一直是同一个过旧值，清缓存也不变 | 预发布排序陷阱 | 显式写精确版本，或关闭冷却期 + 显式带预发布标记 |
| `installation rejected` 且 pnpm 报 `Done` | 兼容性闸门后检 | 换用 peer 覆盖宿主版本的插件版本 |
| 同一命令裸装拿不到 `-tag.N` 系列 | semver 不含 prerelease | 显式 `@<版本>` 精确安装 |
| `dsh plugin --profile desktop` 一律报错 | Electron 独占守卫 | 改在 Electron 应用界面操作 |

**排障顺序**：先看 `.plugin-manager/logs/` 最新 `pnpm.log` 确认解析版本 → 再比对 registry 真实 `dist-tags` → 再比对宿主实际安装版本与该版本 peer 区间 → 最后才考虑豁免。

**缓存不是嫌疑**：清理 pnpm 元数据缓存（Linux/macOS 下 `~/.local/share/pnpm-cache`，Windows 下 `%LOCALAPPDATA%/pnpm-cache`）对上述三种根因均无影响，别把时间浪费在这里。若要确认，横向对比更直接 —— `npm install <pkg> --dry-run` 与 `pnpm add <pkg> --lockfile-only` 结果不同，就锁定为 pnpm 侧行为（冷却期或预发布），而非网络或缓存。

---

## 七之二、`pnpm add` 报 `ERR_PNPM_IGNORED_BUILDS` 与 profile 脚手架的两处必踩坑

全新 profile 首次安装原生依赖（`dsh-web-app` 等带原生模块的包）会连续踩两个坑，两者都发生在安装阶段而非插件代码阶段。

### 7.2.1 `ERR_PNPM_IGNORED_BUILDS`

现象：包已下载完（`Packages: +245`），却以 `Ignored build scripts: koffi@x.y.z` 收尾并退出码 1，报 `plugin command failed`。这不是安装失败，是 pnpm 11 的供应链策略主动拦截了原生构建脚本。

**正解是在 profile 的 `pnpm-workspace.yaml` 里显式放行**，而不是找 CLI 子命令（`dsh plugin ... allow-build` 不存在，会报 `Command "allow-build" not found`）：

```yaml
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  koffi: true
```

放行后重跑同一条 `dsh plugin --profile <name> add <pkg>@<version>` 即可，被拦的安装会继续完成。

### 7.2.2 裸 `add` 命令版本解析回退陷阱（为什么文档与脚本中必须显式带 `@x.y.z`）

- **现象**：执行 `dsh plugin --profile <name> add @scope/pkg`（末尾不带版本号）时，经常出现明明最新版本刚发布成功，安装却自动装到了几个版本前的远古旧版（例如已发布 5.3.x，安装命令却输出 `+ @scope/pkg 5.0.0 (5.3.x is available)`）。
- **根因**：pnpm 的 `minimumReleaseAge` 机制在面对裸包名时，只会把「发布时间已满足成熟期阈值」的候选纳入考量。刚发布的新版本由于发布时间不足，被自动剔除，导致版本选择算法一路向后跌落，选出了一个历史上的老版本。
- **最佳实践硬规范**：
  1. **文档与安装脚本中始终显式带版本号**：所有插件的 `README.md`、速查卡和部署脚本中，安装示例一律写成显式版本 `dsh plugin --profile <name> add @scope/pkg@<最新版本>`。显式指定精确版本时，pnpm 会将其自动写入 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 豁免名单，直接放行安装。
  2. **自研测试 profile 全局关闭**：测试环境中直接在 `pnpm-workspace.yaml` 声明 `minimumReleaseAge: 0`（见 §5.1）。

### 7.2.3 `dsh plugin add` 是否写 `dsh.profile.bundles`（取决于包是否声明 `dsh.bundle`）

首次 `dsh plugin --profile <new> add <pkg>` 会自动脚手架出 profile 目录（`package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml` / `.plugin-manager`）。分的两种情况（源码实证 `dsh-app-boot` `reconcileProfilePlugins` 与 `dsh-plugin-manager` `operations.reconcile`）：
- 包**声明了** `dsh.bundle.patch`：`plugin add` 会**自动把它 push 进 `dsh.profile.bundles`**，启动即可用；
- 包**未声明** `dsh.bundle`（普通依赖）：**不会**加入 bundles，并打印警告 "installed as a plain dependency, not a profile layer"；此时包只在 `dependencies` 里、启动不生效（Loader 只装载 bundles 里列出的包）。

判定：安装后立刻 `cat ~/.dsh/profiles/<name>/package.json` 对比 `dependencies` 与 `dsh.profile.bundles`；听到那条警告就说明它是普通依赖。

判定动作：

```bash
cat ~/.dsh/profiles/<name>/package.json   # 对比 dependencies 与 dsh.profile.bundles 两处
```

修法：手动把包名补进 `dsh.profile.bundles`。例如要跑 Web GUI：

```json
{
  "dependencies": { "@deepseek-ai/dsh-web-app": "<目标版本>" },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@scope/my-plugin"
      ]
    }
  }
}
```

### 7.2.4 建议的全新 profile 落地顺序

```bash
# 1. 脚手架 + 装本地插件（link: 直连工作区，源码改动即时生效）
dsh plugin --profile <name> add <本地插件绝对路径>

# 2. 放行原生构建脚本（在 pnpm-workspace.yaml 里加 allowBuilds）

# 3. 装 Web 前端 bundle，务必锁与宿主同版本的精确版本
dsh plugin --profile <name> add @deepseek-ai/dsh-web-app@<dsh 同版本号>

# 4. （无需手动补 bundles：声明 dsh.bundle.patch 的包 add 时已自动 reconcile push；未声明的普通依赖本就不会进 bundles）

# 5. 启动
dsh <name> --port <port> --no-open
```

第 3 步必须锁版本：不带版本号会解析到 `0.0.1-rc.1` 这类被 semver 预发布排序排除的老版本，随后撞上第四节描述的兼容性闸门。

### 7.2.5 pnpm add @scope/pkg 装不进的两个坑

场景：把已发布的 scoped 插件包装进 profile（pnpm add 或 dsh plugin add）。

- 坑一：npm 镜像假阴性。本机 registry 指向 npmmirror 时，刚发布的版本 npm view 可能查不到，pnpm 解析报 No matching version found。判定：npm config get registry；修法：装包那一条命令加 --registry=https://registry.npmjs.org/（或临时切换），不要改全局默认，装完切回。
- 坑二：profile 的 bundle 名还是旧包名。用 dsh plugin add 装 scoped 包后，profile 的 dsh.profile.bundles 里如果还留着改名前的旧 bundle 名，启动报 cannot resolve profile bundle（旧名）。修法：把 bundles 里的旧名替换为 scoped 全名，并同步 dependencies 与 cordis.patch.yml 的 name（见 packaging.md 的 scoped 化六件套）。

两个坑的共同判据：别只信安装命令的退出码。装完立刻读 profile 的 package.json（dependencies 与 dsh.profile.bundles 两处）与 patch 行，再启动实例验证。

---

## 八、pnpm 符号链接热更新与常驻进程模块解析缓存撕裂（ESM ModuleLoader Cache Trap）

### 8.1 典型症状：升级或重装后出现指向旧版本哈希路径的 ENOENT

在常驻运行的 DSH 实例（例如桌面版常驻服务或特定端口常驻服务）中，通过插件管理界面或命令行执行热卸载并安装新版本后，插件列表页展示包元信息错误：

```text
包元信息错误：Plugin metadata for @scope/pkg: Error: ENOENT: no such file or directory, scandir '.../.pnpm/@scope+pkg@x.y_hash/node_modules/@scope/pkg/locale'
```

**误诊倾向**：开发者容易误以为是新包的打包不完整、漏发了文件，或者认为是插件声明的 locale 目录结构损坏，从而反复重新发布无意义的补丁版本。

### 8.2 底层运行机制（源码级成因）

该异常发生在 DSH 宿主读取插件展示元数据（readPluginMeta）的执行链路上：

1. **元数据定位依赖 Node 内部模块解析器**：
   在 @deepseek-ai/dsh-app-boot 内部，readPluginMeta 调用 optionalResourcePath(`${specifier}/locale/en.json`, parentURL)，其底层使用 Node.js 内部的 ModuleLoader.resolveSync 解析该资源在文件系统中的物理绝对路径。
2. **定位语言目录后执行同步目录扫描**：
   在解析出英文语言包物理路径后，DSH 会直接对其父级目录执行同步扫描：for (const entry of readdirSync(dirname(englishPath), { withFileTypes: true }))。
3. **pnpm 虚拟存储与常驻进程解析缓存的生命周期撕裂**：
   - pnpm 采用符号链接（symlink）将插件软链至 .pnpm/<name>@<version>_<hash>/node_modules/<name> 虚拟存储目录；
   - 依赖更新或重装后，pnpm 会在磁盘上物理删除旧版本的 .pnpm 目录，并建立指向新版本的新软链；
   - **但是，常驻运行中的 Node.js 进程在其模块加载器内存中缓存了旧模块的解析结果与真实路径（realpath）**；
   - 当插件管理器重新触发 readPluginMeta 时，解析器依然给出了已经被物理删除的旧目录路径，导致随后的 readdirSync 立即抛出 ENOENT。

### 8.3 判据与处置规程

- **判据一**：报错路径中显式包含 .pnpm/ 且携带了旧版本的版本号与哈希后缀（如 @x.y_hash）。
- **判据二**：直接检查当前 profile 的 package.json 与 node_modules/@scope/pkg 软链，确认磁盘上新版本依赖已经正确就位，且报错路径对应的物理目录在磁盘上确实已被清理。
- **处置规程**：
  1. 无需修改插件的 locale 文件或发布代码；
  2. 重启该 profile 对应的常驻 DSH 服务进程，使 Node.js 模块加载器重新初始化并读取最新的物理路径；
  3. 插件本身的 package.json 必须维持标准的 exports 配置，明确暴露 ./locale/*、./package.json 与 ./icon.*，确保模块解析器具备合法的解析入口。

### 8.4 本地调试 Tarball 缓存陷阱（Local Tarball Cache Trap in pnpm）

在隔离测试 profile 中通过本地打出的 tarball 进行真机验收时，存在一个极具隐蔽性的解包缓存陷阱：

#### 陷阱现象
1. 测试 profile 的 `package.json` 声明本地包依赖：`"@scope/pkg": "file:/path/to/pkg-x.y.z.tgz"`；
2. 开发者在插件源码仓库中修改了代码，重新执行 `pnpm build && pnpm pack` 生成了新的 `pkg-x.y.z.tgz` 文件，但未递增版本号；
3. 随后在测试 profile 目录执行 `pnpm install` 甚至 `pnpm install --force`；
4. pnpm 瞬间输出：
   ```text
   [WARN] using --force I sure hope you know what you are doing
   Already up to date
   Done in 300ms using pnpm v11.x
   ```
5. **灾难结果**：测试环境 `node_modules/@scope/pkg/` 下的代码**完全没有更新**！测试依然在跑旧代码，开发者误以为修改无效，陷入漫长的无效调试。

#### 根因剖析
pnpm 的内容寻址存储（Content-Addressable Store）与锁文件机制在解析本地 `file:*.tgz` 时：
- 若依赖 specifier 路径与文件名（如 `pkg-x.y.z.tgz`）未发生改变；
- 且当前锁文件 `pnpm-lock.yaml` 中已经记录了该依赖条目；
- 即使物理 tarball 文件内容已经被重新打包覆写，pnpm 仍会判定为「依赖未发生变更」，直接短路返回 `Already up to date`，绝不重新解包覆盖！

#### 通用避坑纪律
在本地自动化测试或调试脚本中：
1. **显式产物同步（推荐）**：重新打包后，测试脚本应将新编译的 `lib/`（或待测静态文件）直接覆盖复制到测试 profile 的 `node_modules/@scope/pkg/lib/` 目录，确保测试进程 100% 消费最新构建产物，完全绕过 pnpm 的 tarball 缓存；
2. **锁文件失效重解析**：若必须走包安装流程，安装命令必须附加 `--no-frozen-lockfile`，或临时删除测试 profile 的 `pnpm-lock.yaml` 并清除该包的缓存；
3. **版本号隔离**：在不同测试批次间为调试包附加递增的预发后缀（如 `x.y.z-test.1`），迫使 pnpm 识别为全新包并触发重新解包。

---

## 九、Web 界面运行中热安装裸包名遭遇 pnpm 发布冷却期静默降级回退 (Runtime Web Hot-Install Cooling Degradation)

### 9.1 致命故障现象：补丁发布后用户热安装依然复现旧 Bug

在 DSH 插件迭代中，开发者最常遇到一种令人极度困惑的反馈循环：
- 开发者刚在 npm 发布了包含紧急缺陷修复的新版本（例如修复了某个导致前端死循环卡死或配置通道不可用的严重问题）；
- 用户在正在常驻运行的 DSH 实例中，打开 Web 管理界面，点击右上角「+ 添加插件」，输入包名 `<scope>/<pkg>`（未指定版本号）执行热安装；
- 界面提示安装成功，但用户进入该插件操作时，**旧版本的致命 Bug 依然 100% 复现**！
- 开发者陷入自我怀疑，误以为新发布的修复没有生效，甚至盲目去推翻已经正确验证过的代码。

---

### 9.2 底层运行机理深度剖析 (The Silent Downgrade Trap)

该故障的真实根因是 **DSH Web 界面热安装逻辑与 pnpm 供应链发布冷却期（`minimumReleaseAge`）的静默交互冲突**：

```text
[用户操作]
Web 界面点击「+ 添加插件」输入裸包名 <scope>/<pkg>
   │
   ▼
[宿主插件管理器]
后台调用 pnpm add <scope>/<pkg> (未带精确版本后缀)
   │
   ▼
[包管理器解析层]
pnpm 默认开启 minimumReleaseAge (通常为 1440 分钟 / 24 小时)
   │
   ├─► 最新版本 (发布不满 24 小时) ──► 【静默排除出候选池！】
   │
   └─► 回退选择满足发布时长的最近成熟版本 (如 3 天前发布的旧版)
   │
   ▼
[结果]
package.json 写入 "^<old-version>"，node_modules 实际下载并装载了旧代码！
```

#### 1. 裸包名解析与候选池剔除
当用户通过界面输入未带版本号的包名时，DSH 宿主后台执行的是裸 `pnpm add <scope>/<pkg>`。
pnpm 的依赖选择算法并不是简单地取 `latest` 标签，而是先对候选版本列表应用供应链安全规则。新发布的补丁包（由于发布时长不足 24 小时）被**无声无息地直接从匹配集合中过滤剔除**。

#### 2. 无声的降级回退
版本选择器不会报错退出，而是顺着版本历史链一路向后跌落，最终选中了一个发布已超过 24 小时、满足冷却期的历史旧版本！
界面上显示安装成功，但磁盘上 node_modules 里的物理文件实际是未修复的旧产物，从而导致旧缺陷如幽灵般继续作祟。

---

### 9.3 判据与诊断动作

遇到「刚发了新版但用户实装后依旧复现」时，**严禁猜测代码写错**，直接执行两步物理取证：

1. **核验 profile 的 package.json 依赖声明**：
   ```bash
   cat ~/.dsh/profiles/<name>/package.json
   ```
   看 `dependencies` 中该包对应的版本前缀是否为旧版本号（例如刚刚发布了 v1.2.3，但此处却变成了 `^1.2.0`）。
2. **核验 node_modules 中实际落盘的物理文件**：
   ```bash
   cat ~/.dsh/profiles/<name>/node_modules/<scope>/<pkg>/package.json
   ```
   读取磁盘上实际运行文件的版本号，一旦发现与线上最新发布版本不一致，即铁证坐实遭遇了发布冷却期降级。

---

### 9.4 开发者防护与通用避坑纪律

1. **用户说明文档与指引强制声明带版本号安装**：
   在所有插件的说明文档（`README.md`）、发版公告与更新指引中，凡涉及安装或升级指令，**一律禁止使用裸包名**，强制书写精确版本：
   ```bash
   dsh plugin add <scope>/<pkg>@<最新精确版本>
   # 或在界面添加插件输入框中输入：
   <scope>/<pkg>@<最新精确版本>
   ```
   **原理**：带精确版本号的请求会被 pnpm 自动登记进工作区的 `minimumReleaseAgeExclude` 豁免清单（写入 `pnpm-workspace.yaml`），直接放行安装，完全免疫冷却期拦截。
2. **测试与开发 profile 主动关闭冷却期**：
   所有用于自研插件联调或真机验收的 profile，其 `pnpm-workspace.yaml` 必须显式声明 `minimumReleaseAge: 0`，确保新发布的包能够立即可见、即时安装。

---

## 十、多插件 Profile 依赖生命周期脚本雪崩与 `--ignore-scripts` 升级隔离准则 (Lifecycle Script Avalanche in Multi-Plugin Profiles)

### 10.1 典型症状：升级纯 JS 插件报不相干的原生模块构建失败

在用户的日常 profile（往往安装了十几个不同插件）中，通过命令行或脚本更新某个纯 TypeScript/JavaScript 开发的轻量插件时，pnpm 突然报错中断：

```text
Error: ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED
  × adding a new package
  ╰─▶ <other-native-dep>@x.y.z install: `node ./build.js ...` exited with exit code: 1
```

**误诊倾向**：开发者误以为是自己插件的构建产物损坏、或是自己的包引入了非法依赖，甚至怀疑是目标环境的 Node 版本不匹配。

---

### 10.2 根因剖析：工作区全局构建生命周期的链式触发

1. **依赖环境异构性**：复杂 profile 中通常混装了其他具有底层系统级监控、音频处理或原生桥接能力的第三方插件，这些插件深层依赖了需要 C++ 编译（如 `node-gyp`、`cmake-js`）的原生模块；
2. **生命周期脚本的次生灾害**：当在 profile 根目录执行 `pnpm add <pkg>` 更新目标插件时，pnpm 默认会对工作区依赖图中所有具有生命周期脚本（`install`、`postinstall`）的包进行联动检查与编译重试；
3. **编译工具链缺失拦截**：若目标主机（特别是 Windows 普通桌面用户机器）没有安装完整的 Visual Studio C++ 编译工具链，那些早已安装好但恰巧带有构建脚本的无关依赖就会在编译阶段直接崩溃退出码 1；
4. **事务性回滚**：pnpm 检测到任何一个依赖的生命周期脚本失败，会立刻中断并回滚整个操作，导致目标纯 JS 插件的正常更新被连带扼杀！

---

### 10.3 规范处置与工程纪律

对于纯 TypeScript/JavaScript 实现的插件（不含任何 C++ 扩展、不依赖本地二进制编译）：

#### 1. 命令行升级与脚本操作强制追加 `--ignore-scripts`
在编写升级指导、管理脚本或自动化验收流程时，对于纯 JS 插件的依赖安装，一律附加 `--ignore-scripts`：
```bash
pnpm add <scope>/<pkg>@<version> --ignore-scripts
```
**收益**：完全跳过工作区内所有包的原生构建生命周期脚本，秒级完成纯脚本依赖的更新与替换，物理隔离其他插件引发的构建雪崩。

#### 2. 插件包自身严禁滥用 postinstall 钩子
作为插件作者，包内部严禁在 `package.json` 中声明非必需的 `postinstall` 脚本；所有初始化、环境探测与自愈逻辑全部推迟至插件入口的 `apply(ctx)` 运行时动态进行，保持依赖包本身在任何宿主机器上都是 100% 绿色、零构建污染的纯净产物。

---

## 十一、宿主版本兼容性判定闸门与 engines.dsh 仲裁铁律（incompatible-version 拦截根因与防御）

### 11.1 异常现象与报错表征

在 DSH Web 界面、插件管理页或执行 `dsh plugin add` / `selectBundle` 激活插件时，界面提示插件卡片为异常状态，并弹出红字阻止激活：

```text
<plugin> 与 DSH <runtimeVersion> 不兼容（要求 <peerPackage> <peerRange>...），运行它可能导致崩溃或数据丢失。请卸载后重新安装与当前 DSH 兼容的版本。
```

日志与控制台对应抛出：
```text
ManagementFailure: incompatible-version
```

### 11.2 源码根因剖析：evaluatePluginCompatibility 校验机制

宿主对插件版本兼容性的判定收敛在 `dsh-app-boot`（`evaluatePluginCompatibility`）中。其核心校验逻辑如下：

```javascript
function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {
  runtimeVersionOf(runtimeVersion);
  const fields = objectOf(manifest, "Plugin manifest");
  const requirements = unmetRequirements(fields, runtimeVersion);
  if (Object.keys(requirements).length === 0) return void 0;
  const name = identityField(fields, "name");
  const version = identityField(fields, "version");
  const key = `${name}@${version}`;
  return {
    name,
    version,
    runtimeVersion,
    requirements,
    exempted: (Object.hasOwn(exemptions, key) ? exemptions[key] : void 0)?.includes(runtimeVersion) === true
  };
}

function unmetRequirements(fields, runtimeVersion) {
  const engines = Object.hasOwn(fields, "engines") ? objectOf(fields.engines, "Plugin manifest engines") : {};
  if (Object.hasOwn(engines, "dsh")) {
    const range = engines.dsh;
    if (typeof range !== "string") throw new Error("Plugin manifest engines.dsh must be a string");
    return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range };
  }
  if (!Object.hasOwn(fields, "peerDependencies")) return {};
  const dependencies = objectOf(fields.peerDependencies, "Plugin manifest peerDependencies");
  const unmet = {};
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range !== "string") throw new Error(`Plugin manifest peerDependencies[${JSON.stringify(name)}] must be a string`);
    if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
    const requirement = ["workspace:^", "workspace:~", "workspace:*"].includes(range) ? runtimeVersion : range;
    if (!satisfies(runtimeVersion, requirement)) unmet[name] = range;
  }
  return unmet;
}
```

#### 致命陷阱：SemVer 预发布版本（Pre-release）与精准等于匹配
根据 SemVer 规范，带有预发布标签的版本（如 `<version>`）只有在指定范围包含明确相同预发布前缀且主次版本相同时，才判定为匹配。
- **错误写法**：在插件的 `peerDependencies` 中写死精确的预发布版本，例如 `"@deepseek-ai/dsh-client-locale": "<version>"`；
- **崩溃机理**：当宿主升级到 `<version>` 时，`semver.satisfies("<version>", "<version>", { includePrerelease: true })` 恒为 `false`！
- **连锁反应**：宿主收集到 `peers["@deepseek-ai/dsh-client-locale"] = "<version>"`，由于插件未获得豁免（`!compatibility.exempted`），直接触发 `ManagementFailure("incompatible-version")`，导致插件即使代码 100% 运行正常，也会被宿主硬性拒载！

### 11.3 官方推荐 engines.dsh 仲裁机制（DSH）

在 DSH 0.2.1 系列及官方插件索引规范中，宿主正式引入并优先支持 `package.json.engines.dsh` 字段：
- 生成器与包管理中心**优先读取 `engines.dsh`** 并去除首尾空白；
- 没有该字段时，宿主才会将所有 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的 `peerDependencies` 范围做合取计算。

### 11.4 通用工程规范与防御准则

#### 1. 显式声明 `engines.dsh` 范围
在插件 `package.json` 中显式注明对 DSH 运行时的支持范围（支持大于等于某基础版本的所有后续版本）：
```json
{
  "engines": {
    "node": ">=20",
    "dsh": ">=<version>"
  }
}
```

#### 2. `peerDependencies` 必须声明为半开区间
严禁在 `peerDependencies` 中写死单点预发布版本，一律采用带有预发布起点的半开区间或联合范围：
```json
{
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.4",
    "@deepseek-ai/dsh-client-locale": ">=<version>",
    "@deepseek-ai/dsh-api-session-controller": ">=<version>",
    "@deepseek-ai/dsh-client-ui-session": ">=<version>",
    "@deepseek-ai/dsh-client-ui-conversation": ">=<version>",
    "@deepseek-ai/dsh-client-ui-renderer": ">=<version>",
    "@deepseek-ai/dsh-client-ui-plugin-manager": ">=<version>",
    "@deepseek-ai/dsh-client-ui-primitives": ">=<version>",
    "@deepseek-ai/dsh-client-ui-settings": ">=<version>",
    "@deepseek-ai/dsh-client-ui-slots": ">=<version>",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
```
**收益**：`>=<version>` 能同时在 `<version>`、`<version>`、`0.2.1` 正式版及未来小版本中顺利通过 `semver.satisfies`，杜绝宿主每次小版本演进时对插件的静默拦截。

#### 3. 运行期豁免仅作为测试权宜手段（dsh plugin allow-version）
宿主提供了 `dsh plugin allow-version <pkg>@<version>` 命令向 profile 的 `compatibility.json` 写入版本白名单。但这只用于开发人员紧急测试未经适配的远古插件，正式发布的插件必须通过修正 `engines.dsh` 与 `peerDependencies` 达成原生兼容。

---

## 十二、上游废弃诊断包与伴生导出彻底解耦规范（Runtime Invariants Deprecation）

### 12.1 架构背景：运行时机制退役与包生态精简

在 DSH 的演进过程中，部分早期设计的运行时辅助包或诊断伴生接口可能会被官方彻底下架并移出官方 npm 注册表和核心 bundle 树（例如 DSH 0.2.1 系列彻底移除了 `@deepseek-ai/dsh-invariants` 运行时插件，并删除了各官方包中的 `./invariant` 导出）。

### 12.2 滞后依赖引发的连带故障

若第三方插件未及时感知上游拆解，继续在代码中保留历史伴生包的依赖：
1. **安装期解析失败**：官方新版本不再发布已废弃包的对应版本（例如官方发布了 `<version>`，但废弃包停留在 `<version>` 或更早），导致包管理器在解析相同版本 peer 时报 `No matching version found`；
2. **兼容性仲裁全红**：`evaluatePluginCompatibility` 会因为未满足已退役包的版本区间而直接抛出 `incompatible-version`；
3. **加载期注入崩溃**：插件声明注入已废弃的服务（如 `ctx.inject(['invariants'], ...)`），因宿主服务名册中不再包含该提供方，导致插件 fiber 永远处于挂起（Pending）或在启动审计中报缺失必需依赖失败。

### 12.3 彻底解耦与孤儿产物清理四步法

当上游移出某项诊断机制或伴生能力时，插件必须执行四步彻底清障：

1. **源码解耦**：彻底删除引用该伴生包的本地源码文件（如 `src/invariant.ts`），停止在主逻辑中注入该服务；
2. **构建流水线入口解耦**：检查打包工具配置（如 `tsdown.config.ts` 或 `rollup.config.js`），将废弃模块从构建 `entry` 列表中移除；
3. **物理清除孤儿编译产物**：执行 `rm -rf lib/types`，清理编译输出目录中遗留的旧 `.d.ts` 和 `.js` 镜像文件，杜绝历史产物借由发布白名单混入正式 npm 包；
4. **包清单与白名单同步**：
   - 从 `package.json.exports` 中注销该子路径（如删除 `"./invariant"`）；
   - 从 `package.json.files` 白名单中移除对应的产物路径；
   - 从 `peerDependencies` 与 `devDependencies` 中彻底清除该废弃包名。

---

## 十三、官方依据

- pnpm `minimumReleaseAge` 设置项与默认值：<https://pnpm.io/settings/dependency-resolution>
- pnpm 供应链安全说明（冷却期的设计动机）：<https://pnpm.io/supply-chain-security>
- 将默认值设为 1 天的变更提案与动机：<https://github.com/pnpm/pnpm/pull/11158>
- DSH 插件市场索引生成器（engines.dsh 解析规则）：`@deepseek-ai/dsh-plugin-market-generator`
- DSH 宿主版本兼容性判定实现：`@deepseek-ai/dsh-app-boot/evaluatePluginCompatibility`

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@<version>
packages/boot/app-boot  <-  @deepseek-ai/dsh-app-boot@<version>
packages/bundle/base  <-  @deepseek-ai/dsh-base@<version>
packages/boot/plugin-manager  <-  @deepseek-ai/dsh-plugin-manager@<version>
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@<version>
packages/skill/skill  <-  @deepseek-ai/dsh-skill@<version>
packages/bundle/web-app  <-  @deepseek-ai/dsh-web-app@<version>
apps/plugin-market-generator  <-  @deepseek-ai/dsh-plugin-market-generator@<version>
```
