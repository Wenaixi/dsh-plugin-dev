# 插件安装版本解析陷阱：冷却期、预发布排序与兼容性闸门

> 本文件记录 DSH 插件安装链路上最容易误诊为「缓存过期」的三类根因，以及可复现的判定与修复手法。
> 全部结论均在本机 DSH 0.2.0-rc.2 + pnpm 12.8.1 + Node 24.4.1 环境实测验证。

---

## 一、症状：装到了过时的旧版本，随后被兼容性闸门拒绝

典型报错形态：

```text
dependencies:
+ @wenaixi/dsh-ponytail 4.9.0-dsh.5
Packages: +2
Done in 997ms using pnpm v11.7.0

dsh: installation rejected: Plugin @wenaixi/dsh-ponytail@4.9.0-dsh.5 is incompatible
with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-skill":"^0.1.1-rc.2"}
dsh: restored package.json, pnpm-lock.yaml, and node_modules.
```

**极易误读之处**：报错说「版本不兼容」，但**版本号不是人选的**。包管理器解析出 4.9.0-dsh.5 这个陈旧版本，才是真正的病灶；兼容性闸门只是把它拦下来了。

排障第一步永远是**先确认解析到了哪个版本、为什么是它**，而不是去调 peerDependencies 范围或申请豁免。

---

## 二、根因一：pnpm 发布冷却期（minimumReleaseAge）

### 2.1 机制

发布冷却期是 **pnpm 自身的配置项**（`minimumReleaseAge`，单位分钟）：**pnpm 11 起内建默认 1440（1 天），并非「默认关闭、显式配置后才启用」**（本机捆绑 pnpm 11.7.0 与全局 12.8.1 的 dist 默认块均为 `minimum-release-age: 24*60`；`config get minimum-release-age` 返回 undefined 只说明无显式配置，不代表内建默认关闭）。启用后，一个新版本发布不满阈值分钟数就不被考虑，解析回退到更早的合格版本；显式设置了 `minimumReleaseAge` 时 `minimumReleaseAgeStrict` 才默认 true（否则宽松处理、可经 exclude 放行）。这是 pnpm 防供应链攻击的「冷却期」。**该机制由包管理器实现，不由 DSH 代码实现**（本机 DSH 0.2.0-rc.2 全部 285 个 @deepseek-ai 运行时包与 dsh/lib 源码中 `minimumReleaseAge` 零命中）；可在 profile 的 `pnpm-workspace.yaml` 里调整（见 5.1）。

关键点：**方向与直觉相反**。不是「新版本太新不能装」，而是**只有发布满阈值的版本才被考虑**，于是新版本被排除后解析回退到上一个「已满阈值」的合格版本（不是无限跌到底：pnpm 按发布时间取最近候选，阈值过长直接报 `ERR_PNPM_NO_MATURE_MATCHING_VERSION` 拒绝）。DSH 侧真正的兼容闸门是 **peer 兼容性预检 + allow-version 精确版本豁免**（写入 profile 的 `compatibility.json`，见第四节），与冷却期是两条独立机制。

### 2.2 时间指纹（判定冷却期的决定性证据）

同一探针命令在不同时刻执行，解析结果会自动前移：

| 执行时刻 | 解析结果 | 原因 |
| --- | --- | --- |
| T0 | `4.9.0-dsh.5` | 最新候选发布不足 24h，被排除 |
| T0 + 若干小时 | `4.10.0-dsh.1` | 它刚好跨过 24h 门槛，自动放行 |

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
2. **pnpm 不回退到「最老合格版」**：实测回退链落在同系列较早的预发布版（age=180 → `.8`、age=1200 → `.5`、age=3000 → `.2`），阈值过长直接 `ERR_PNPM_NO_MATURE_MATCHING_VERSION` 拒绝；若持续拿不到新版，旧系列 peer 可能撞上 DSH 兼容闸门。

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
4.9.0-dsh.5   peer @deepseek-ai/dsh-skill: ^0.1.1-rc.2
              展开为 >=0.1.1 <0.2.0-0，宿主实装 0.2.0-rc.2 落在区间外 → 不兼容

4.10.0-dsh.4  peer @deepseek-ai/dsh-skill: >=0.1.0-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0
              双区间覆盖 0.2.0-rc.2 → 兼容
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
  # 注意：cfg.log / cfg.err 不是通用 profile 产物（desktop profile 无、全部 289 个官方包零命中，仅个别 web 类 profile 出现）；启动日志在宿主 logs/ 目录
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

提示（已实测放宽）：BOM 或 CRLF 不会让 pnpm 的 YAML 解析把注释与后续配置黏成一行——pnpm 11.7.0 / 12.8.1 与 js-yaml/yaml 库对 BOM+CRLF+注释均正确解析（实测 `minimumReleaseAge: 0` 生效）。写完回读确认配置生效即可，不必担心字节头。

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

### 7.2.2 `dsh plugin add` 是否写 `dsh.profile.bundles`（取决于包是否声明 `dsh.bundle`）

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
  "dependencies": { "@deepseek-ai/dsh-web-app": "0.2.0-rc.2" },
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

### 7.2.3 建议的全新 profile 落地顺序

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

---

## 八、官方依据

- pnpm `minimumReleaseAge` 设置项与默认值：<https://pnpm.io/settings/dependency-resolution>
- pnpm 供应链安全说明（冷却期的设计动机）：<https://pnpm.io/supply-chain-security>
- 将默认值设为 1 天的变更提案与动机：<https://github.com/pnpm/pnpm/pull/11158>
