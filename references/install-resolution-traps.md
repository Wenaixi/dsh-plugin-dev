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

pnpm 从 v11 起默认启用 `minimumReleaseAge: 1440`（分钟，即 24 小时）：一个新版本发布后必须满 24 小时才允许被解析安装。这是防供应链攻击的「冷却期」——公开资料显示近年多数被投毒的包在发布一周内被发现并撤下，冷却期能自动挡住大部分。

关键点：**方向与直觉相反**。不是「新版本太新不能装」，而是**只有发布满 24 小时的版本才被考虑**，于是新版本全被排除后，解析会一路回退到最老的合格版本。

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

精确 spec 绕过冷却期检查。这是**最小侵入的应急手段**，也是判定「是否为冷却期问题」的快速验证法。

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

1. **裸装（范围解析）默认排除预发布版**，`maxSatisfying(vers, '*')` 永远返回 `4.9.0` 而不是任何 `4.10.0-dsh.x`；
2. **一旦冷却期把新预发布版筛掉，解析会一路跌回 4.9.0 系列**，而 4.9.0 系列的 peer 通常锁在旧版 DSH 契约上，立刻撞上兼容性闸门。

所以插件作者若采用 `<主>.<次>.<修订>-<dsh>.<序号>` 这类后缀发布，**必须让使用者显式写精确版本或显式关闭冷却期**，否则冷却期 + 预发布排序两个机制会叠加成「永远装不上最新版」。

---

## 四、根因三：DSH 兼容性闸门的工作方式

### 4.1 两段式检查

dsh-plugin-manager 在安装前后各做一次 peer 兼容性评估（实现见 `@deepseek-ai/dsh-plugin-manager` 的 `lib/types/operations.js`）：

- **预检（安装前）**：读包清单，`evaluatePluginCompatibility(manifest, exemptions)` 判定；不兼容则直接拒绝，一个包都不装（输出 `nothing was installed`）。
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

豁免是**精确到版本对**的（包版本 + DSH 版本都必须精确匹配），落在 profile 的 `compatibility.json`。默认内容为 `{}`，即未设置任何豁免。

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
  cordis.yml             # 组合后的配置
  compatibility.json     # 精确版本豁免表，默认 {}
  cfg.log / cfg.err      # 启动黑匣子日志
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

# 关闭 24 小时发布冷却期（pnpm v11+ 默认 minimumReleaseAge: 1440）。
# 本 profile 安装自研/刚发布的插件，冷却期会让解析回退到过时版本，
# 进而撞上 DSH 的 peer 兼容性闸门。0 表示发布即可安装。
minimumReleaseAge: 0
```

等价的命令行覆盖（不改文件、仅本次生效）：

```powershell
pnpm add <pkg> --config.minimum-release-age=0
```

注意：写 `pnpm-workspace.yaml` 时若走某些编辑器工具可能引入 UTF-8 BOM 或 CRLF 换行，pnpm 的 YAML 解析会因此把注释与后续配置黏成一行而静默失效。写完务必回读文件确认字节头（应为 `112 97 99 107` 即 `pack` 开头，无 `239 187 191` BOM）。

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
| 解析版本明显过旧，且过一段时间后自动前移 | pnpm 冷却期 | profile 配 `minimumReleaseAge: 0`，或改用精确版本 |
| 解析版本一直是同一个过旧值，清缓存也不变 | 预发布排序陷阱 | 显式写精确版本，或关闭冷却期 + 显式带预发布标记 |
| `installation rejected` 且 pnpm 报 `Done` | 兼容性闸门后检 | 换用 peer 覆盖宿主版本的插件版本 |
| 同一命令裸装拿不到 `-tag.N` 系列 | semver 不含 prerelease | 显式 `@<版本>` 精确安装 |
| `dsh plugin --profile desktop` 一律报错 | Electron 独占守卫 | 改在 Electron 应用界面操作 |

**排障顺序**：先看 `.plugin-manager/logs/` 最新 `pnpm.log` 确认解析版本 → 再比对 registry 真实 `dist-tags` → 再比对宿主实际安装版本与该版本 peer 区间 → 最后才考虑豁免。

**缓存不是嫌疑**：清理 pnpm 元数据缓存（Linux/macOS 下 `~/.local/share/pnpm-cache`，Windows 下 `%LOCALAPPDATA%/pnpm-cache`）对上述三种根因均无影响，别把时间浪费在这里。若要确认，横向对比更直接 —— `npm install <pkg> --dry-run` 与 `pnpm add <pkg> --lockfile-only` 结果不同，就锁定为 pnpm 侧行为（冷却期或预发布），而非网络或缓存。

---

## 八、官方依据

- pnpm `minimumReleaseAge` 设置项与默认值：<https://pnpm.io/settings/dependency-resolution>
- pnpm 供应链安全说明（冷却期的设计动机）：<https://pnpm.io/supply-chain-security>
- 将默认值设为 1 天的变更提案与动机：<https://github.com/pnpm/pnpm/pull/11158>
