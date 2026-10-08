# 发布验证：npm 镜像假阳性、幂等发布与 tag 指向

> 适用于：tag 触发 CI 发版的 DSH 插件仓库发布流程验收。

## 一、本地 npm 镜像会让 `npm view` 给出假阴性

本地 registry 配置成 **npmmirror 等镜像**时，刚发布的版本 `npm view @scope/pkg` 可能查不到（镜像缓存延迟），**不代表发布失败**。

**正确验证**：直查官方 registry，且绕过本机代理/镜像缓存：

```bash
# curl --noproxy '*' 绕过系统代理直连官方源（Invoke-RestMethod 走代理会同样假阴性）
curl.exe --noproxy '*' -s https://registry.npmjs.org/@scope%2Fpkg | ConvertFrom-Json
# 读 dist-tags.latest 与 versions.<新版本> 是否就位
```

```js
const api = await fetch("https://registry.npmjs.org/@scope%2Fpkg");
const j = await api.json();
console.log(Object.keys(j.versions).filter(v => v.includes("dsh.10")));  // 真值
console.log(j["dist-tags"].latest);
```

- `npm config get registry` 先确认本地指向；
- GitHub Actions 日志里 `npm publish` 的成功并不总等于版本已可见——用官方 API 复核 dist-tags。
- **发布成功后 1~2 分钟内 `dist-tags.latest` 仍显示旧版本是正常传播时延**（官方 registry 分布式
  异步入库 + CDN 边缘同步），不要在这期间重复触发发布（会撞 E409 staged 锁死，见 §六）。

## 二、幂等发布的「已发布跳过」语义

发布流水线常带幂等检查：`if npm view ... grep 版本 → echo already published, skipping`。

- `npm publish` 与 `gh release` 是两套独立产物、不自动成立：npm 发布成功不代表 Release 存在（`gh release view <tag>` 才是 Release 真值）；npm 发布成功也不代表 registry 可见（镜像缓存延迟，直查官方 API 为准）；
- 发布流程先跑门禁再构建（`lib/` 为构建时产物，官方包 files 精确含 lib 不含 src），版本号是 package.json 的 manifest 字段；tag 指向的 commit 决定发哪个版本。

## 三、tag 指向错误的修正与指针漂移防御

### 3.1 发版前 Tag 指针一致性核验（防静默发旧代码）
在本地推送 tag 之前，高频陷阱是：前期测试或调试时已经打过同名 tag，后续多轮修复提交了新的 commit，但 tag 仍锚定在历史旧提交上。若直接推送，CI 将检出未修复的老代码并发布错误的产物！

**核验标准动作**：
```bash
git rev-parse vX.Y.Z                     # 本地 tag 指向的 commit
git rev-parse HEAD                       # 当前工作区最新 commit
git ls-remote origin refs/tags/vX.Y.Z   # 远端已存在的 tag 指向（如有）
```
若三者（尤其是本地 tag 与 HEAD）不一致，必须立即执行标准纠偏序列。

### 3.2 标准纠偏序列
```bash
git tag -d vX.Y.Z                                # 1. 彻底删除本地旧 tag
# 2. 确认最新提交已干净落库（add 与 commit 分开执行，PowerShell 5.1 不支持 &&）
git add -A; git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: release notes"     # 3. 必须在最新 HEAD 上重新打 annotated tag
git push origin main                             # 4. 先推主分支
git push origin vX.Y.Z --force                   # 5. 强制覆盖远端 tag 触发最新 CI
```

- 远端 tag 更新后，`git ls-remote --tags origin vX.Y.Z` 应指向新 SHA；
- force-push tag 是发布修正的常规安全操作（release 已建时另需处理 Release 指向）；
- **CHANGELOG 提取健壮性**：CI 发版脚本通常通过正则 `/^## \[${escVer}\].*/` 切片提取更新日志。发布前必须确保版本小节直接位于开篇顶层，避免遗留未关闭的 `[Unreleased]` 或散落文本导致 GitHub Release 正文提取落空或为空。

## 四、PowerShell 拼接命令的坑

`cmd1 && cmd2` 在 PowerShell 不是合法语法（ParserError: InvalidEndOfLine）——分两条 `pwsh` 调用跑，或写 `.ps1`。

## 四之二、网络间歇性与重试纪律

推送与发布过程中会遇到**同一条命令连续失败又连续成功**的情况（连接超时、连接重置）。
这不是权限问题，也不是凭据问题，而是网络路径不稳定。

**处置纪律**：

1. 带退避重试，重试之间确认前一次确实失败再继续；
2. 把「可重试的连接失败」与「确定性的命令失败」（拒绝、认证错、冲突）分开计数，
   不要把前者算进后者；
3. 判据：连续探测同一目标若干次，只要稳定有一次成功，就说明是间歇而非阻断；
4. 连接类失败**不要**写进产品的缺陷记录，那是环境问题，
   混进缺陷记录是最难清理的一类污染。

**推 tag 的额外风险**：主分支推送成功、tag 推送失败，会留下「代码已上线但未发布」的半状态。
处置：tag 推送与主分支推送视为一次原子操作，任一失败都重试到成功再往下走；
重试仍失败时，先核对远程 tag 是否已被创建（可能推送已生效只是回执丢失），
再决定是否重打。

## 四之三、本地 CLI 未登录时，发布链的责任边界

发布流水线通常由远端 CI 承担凭据（发布 token 与仓库 token 都是 secret）。
这带来一个常见疑问：**本地 CLI 没登录能不能推**。

| 动作 | 是否依赖本地 CLI 登录 |
| --- | --- |
| `git push`（分支与 tag） | 否，走 git 自身的凭据助手 |
| 触发远端流水线并完成发布 | 否，流水线用 secret |
| 本地验证流水线结果 | 需要远端 API 可读（匿名可读则不必登录） |
本地 `gh` 未登录时，**用远端 HTTP API 的匿名只读端点核对结果**，不要因此跳过验证。
只有需要本地创建/修改 Release 或写操作时才必须登录。

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
