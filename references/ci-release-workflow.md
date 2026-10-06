# CI 发布流水线：push 全量测试 + tag 发版

> 适用范围：为 DSH 插件仓库搭建 GitHub Actions 双流水线——push/PR 到 main 只跑全量测试，打 `v*` tag 才跑全量测试并发布 npm + 建 GitHub Release。

## 一、两条流水线的分工

| 触发 | job 内容 | 目的 |
| --- | --- | --- |
| `push: branches: [main]` + `pull_request` | typecheck + 单测 + build | 每次代码进 main 前证明可构建 |
| `push: tags: ['v*']` | 同上全量测试 + `pnpm publish` + `gh release create` | 发版即发布 |

- 发布流水线**先跑全量测试再发**，不要把 publish 放在测试之前；`pnpm publish --no-git-checks` 跳过 git 状态检查（tag 触发时工作区可能非干净）。
- `npm publish` 与 `gh release create` 是两套独立产物：npm 成功不代表 Release 存在，验证要分开查（见 publish-npm-verification.md）。

## 二、必踩的四个坑（按出现顺序）

### 1. 锁文件没入库 → `ERR_PNPM_OUTDATED_LOCKFILE`

`pnpm install --frozen-lockfile` 要求 `pnpm-lock.yaml` 已提交且与 package.json 一致：

- 仓库若在 `.gitignore` 里忽略了锁文件（常见于「库不锁依赖」的旧习惯），CI 里 `--frozen-lockfile` 直接失败；去掉忽略并提交锁文件。
- 锁文件与 package.json 不一致（如某传递依赖被源码间接使用但从未声明）报 `1 dependency was removed: <pkg>`——补 `devDependencies` 后重跑 `pnpm install --lockfile-only` 再提交。

### 2. 构建工具需要新 Node API → 在旧 node 上崩

tsdown（rolldown）用到 `Promise.withResolvers`，这是 **Node 22+** 的 API。`actions/setup-node` 配 `node-version: 20` 时构建步骤报 `TypeError: Promise.withResolvers is not a function`。**CI 的 node-version 直接用 22**（或与本地开发版本一致），不要默认 20。

### 3. `NODE_AUTH_TOKEN` secret 必须手动配，OIDC 404 不致命

GitHub Actions 里 `setup-node` 的 `registry-url` 会尝试 OIDC 令牌交换，输出 `Skipped OIDC: ERR_PNPM_AUTH_TOKEN_EXCHANGE ... 404` 是**噪音不是失败**。真正驱动 publish 的是 `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`：

- 用本机 `~/.npmrc` 里的 `//registry.npmjs.org/:_authToken=` 值，`gh secret set NPM_TOKEN -R <owner>/<repo> --body '<token>'` 写入（token 是机密，配完不要在日志里回显）。
- 发布失败若报 `Failed to publish ... (status 404): {"error":"Not found"}`，几乎都是 token 缺失/错误，不是包名问题。

### 4. tag 打在旧 commit → 版本号对不上

版本号是 package.json 的 manifest 字段，tag 指向的 commit 决定发哪个版本。bump 提交没落地就打了 tag，Release 会发旧版本：

```bash
git tag -d v1.2.3                       # 删本地
git add -A -- <bump 相关文件>; git commit -m "chore: bump to v1.2.3"   # 先补提交
git tag v1.2.3                          # 在正确 commit 重打
git push origin main
git push origin v1.2.3 --force          # 远端 tag 强制更新
```

## 三、发布后验证

1. 直查官方 registry（本地是 npmmirror 会假阴性）：`fetch('https://registry.npmjs.org/@scope%2Fpkg')` 看 `dist-tags.latest` 与新版本；
2. `gh release view vX.Y.Z` 确认 Release 存在（不是草稿、不是预发布）；
3. 间隔约 20 s 等 registry 传播，再复核一次。

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径；版本号取自各包 package.json 的 version 字段。

```text
apps/cli  <-  @deepseek-ai/dsh@0.2.0-rc.2
```
