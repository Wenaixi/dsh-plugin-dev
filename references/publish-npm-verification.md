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

1. 递增版本：官方包用裸 SemVer 预发布（如 0.2.0-rc.2；`-dsh.N` 后缀只是社区第三方包约定，官方 289 包 0 命中）；`npm version 0.2.0-rc.3`（前置 `git add -A`）；
2. CHANGELOG 补段（Added/Changed/Removed/Migration，含行为变更声明）；
3. 门禁用仓库真实存在的命令（如 `pnpm typecheck` / `pnpm build`；不存在同名脚本就删该项，官方发包 scripts 无 typecheck/verify/behavior）；
4. commit（version + changelog；lib/ 是构建时产物不提交，版本号是 package.json 的 manifest 字段）→ tag → `git push origin main --tags`；
5. 发布即 npm tarball，官方发布物不带 GitHub Actions/Release（.github/workflows 0 命中）——`gh run watch` 仅在仓库确配 Workflow 时用；
6. 官方 registry API 验证版本与 dist-tags；`gh release view <tag>` 才是 Release 真值（npm 发布成功不代表 Release 存在）；
7. 本地/远端 git 一致（`git rev-parse HEAD` == `git ls-remote origin main`）。
