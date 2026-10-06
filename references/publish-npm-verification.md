# 发布验证：npm 镜像假阳性、幂等发布与 tag 指向

> 适用于：tag 触发 CI 发版的 DSH 插件仓库发布流程验收。

## 一、本地 npm 镜像会让 `npm view` 给出假阴性

本地 registry 配置成 **npmmirror 等镜像**时，刚发布的版本 `npm view @scope/pkg` 可能查不到（镜像缓存延迟），**不代表发布失败**。

**正确验证**：直查官方 registry：

```js
const api = await fetch("https://registry.npmjs.org/@scope%2Fpkg");
const j = await api.json();
console.log(Object.keys(j.versions).filter(v => v.includes("dsh.10")));  // 真值
console.log(j["dist-tags"].latest);
```

- `npm config get registry` 先确认本地指向；
- GitHub Actions 日志里 `npm publish` 的成功并不总等于版本已可见——用官方 API 复核 dist-tags。

## 二、幂等发布的「已发布跳过」语义

发布流水线常带幂等检查：`if npm view ... grep 版本 → echo already published, skipping`。

- `npm publish` 与 `gh release` 是两套独立产物、不自动成立：npm 发布成功不代表 Release 存在（`gh release view <tag>` 才是 Release 真值）；npm 发布成功也不代表 registry 可见（镜像缓存延迟，直查官方 API 为准）；
- 发布流程先跑门禁再构建（`lib/` 为构建时产物，官方包 files 精确含 lib 不含 src），版本号是 package.json 的 manifest 字段；tag 指向的 commit 决定发哪个版本。

## 三、tag 指向错误的修正

推送 tag 后发现 tag 打在旧 commit（比如 bump 提交因命令拼接失败没落地）：

```bash
git tag -d v1.2.3            # 删本地
# 先完成遗留提交（add + commit 分开跑，PowerShell 5.1 的 && 不可用（ParserError；7+ 才支持 &&））
git add -A -- <files>; git commit -m "chore: bump to v1.2.3"
git tag v1.2.3               # 在新 commit 重打
git push origin main
git push origin v1.2.3 --force   # 强制更新远端 tag
```

- 远端 tag 更新后，`git ls-remote --tags origin v1.2.3` 应指向新 SHA；
- force-push tag 是发布修正的常规操作（release 已建时另需处理 Release 指向）。

## 四、PowerShell 拼接命令的坑

`cmd1 && cmd2` 在 PowerShell 不是合法语法（ParserError: InvalidEndOfLine）——分两条 `pwsh` 调用跑，或写 `.ps1`。

## 五、发布前 checklist

1. 递增版本：使用目标发布规范要求的 SemVer 形式；不要从某次官方或社区发布样本推断永久版本格式；发布前先用包管理器和注册表核对版本及 tag；
2. CHANGELOG 补段（Added/Changed/Removed/Migration，含行为变更声明）；
3. 门禁用仓库真实存在的命令（如 `pnpm typecheck` / `pnpm build`；不存在同名脚本就删该项，官方发包 scripts 无 typecheck/verify/behavior）；
4. commit（version + changelog；lib/ 是构建时产物不提交，版本号是 package.json 的 manifest 字段）→ tag → `git push origin main --tags`；
5. 发布即 npm tarball，官方发布物不带 GitHub Actions/Release（.github/workflows 0 命中）——`gh run watch` 仅在仓库确配 Workflow 时用；
6. 官方 registry API 验证版本与 dist-tags；`gh release view <tag>` 才是 Release 真值（npm 发布成功不代表 Release 存在）；
7. 本地/远端 git 一致（`git rev-parse HEAD` == `git ls-remote origin main`）。

---

---

## 六、npm 官方 Registry 跨区域分发时延与 E409 Staged 冲突机制

### 6.1 跨区域分发时延特性

在 GitHub Actions 或本地终端中，`npm publish` 返回成功（显示 `+ @scope/pkg@x.y.z`）后：

- 官方 registry 内部采用分布式异步入库与多区域 CDN 边缘同步机制；
- 在随后的 **1 至 2 分钟**内，某些特定的查询端点可能短暂返回 `E404`，直接按固定路径下载 tarball 可能返回 404，或者 `dist-tags.latest` 仍显示前一版本；
- **核心准则**：只要发布日志已输出 `+ @scope/pkg@x.y.z`，即表明发布事务已经提交处理，此期间的暂态 404 **不属于发布失败**，切勿误判。

### 6.2 致命陷阱：并发发布与 E409 Staged 锁死

- **严禁操作**：在发布刚刚提交、尚未完全可见的时延窗口内，**绝不能重新触发相同版本号的发布流程**（如重复推送相同 tag、重跑 CI 工作流）。
- **锁死机理**：npm 对于正在处理事务或已进入阶段性存储（staged）的版本，再次执行 publish 会立即抛出：
  ```text
  npm error code E409
  npm error 409 Conflict - Cannot publish over previously staged version "x.y.z"
  ```
- **脱困代价**：一旦某个版本号进入被锁死的 staged 状态，npm 通常会持续拒绝该版本号的再次提交。唯一的脱困办法是必须递增（bump）一个全新的版本号重新走发版流程。因此，发布自动化必须严格遵守幂等检查与时延轮询等待机制。

---

## 七、权威发布真源四件套核验标准（Release Verification Quadruple）

任何版本发布完成后，判定发布成功的唯一权威依据是逐一验证以下四项指标：

### 1. 远端 Git Tag 存在性与指针锁定
```bash
git ls-remote --tags origin vX.Y.Z
```
验证目标标签已安全送达 GitHub 远程仓库，且指向当前预期的版本升级 Commit SHA。

### 2. GitHub Release 真实就绪
```bash
gh release view vX.Y.Z --repo <owner>/<repo>
```
验证正式 Release 已经生成、非草稿（draft: false）态，且正文准确提取了对应版本的更新日志。

### 3. npm 官方元数据收敛轮询
```javascript
// 直查官方 registry，轮询至版本就绪与 dist-tags 收敛
const res = await fetch("https://registry.npmjs.org/@scope%2Fpkg");
const data = await res.json();
console.log(data["dist-tags"].latest === "X.Y.Z");
```
必须轮询确认 `versions` 包含新版本，且 `dist-tags.latest` 已经更新指向新版本。

### 4. 线上真实 Tarball 解包 SHA256 逐文件数字验签
这是证明线上产物绝无构建污染与打包漂移的最高级铁证：

```bash
# 1. 从官方元数据的 dist.tarball 提取精确链接并下载 tarball
curl -sSL "https://registry.npmjs.org/@scope/pkg/-/pkg-X.Y.Z.tgz" -o downloaded.tgz

# 2. 解包
tar -xzf downloaded.tgz

# 3. 逐个比对解压出的 package/lib/*.js 与本地 lib/*.js 的 SHA256 哈希值
```

- 必须对每个核心运行时文件的 SHA256 进行逐一匹配（PERFECT MATCH）；
- 检查解包出的客户端代码，确认内联的版本号常量（如 `PACKAGE_VERSION`）与 `package.json` 严格一致；
- 只有全部通过，方可宣称该版本正式交付。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
apps/cli  <-  @deepseek-ai/dsh@0.2.0-rc.2
packages/boot/config-editor  <-  @deepseek-ai/dsh-config-editor@0.2.0-rc.2
packages/boot/plugin-manager  <-  @deepseek-ai/dsh-plugin-manager@0.2.0-rc.2
```
