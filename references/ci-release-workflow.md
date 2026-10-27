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
apps/cli  <-  @deepseek-ai/dsh@<version>
```

---

## 三、依赖引擎声明与 CI 环境避坑指南

### 1. package.json 的 engines 切勿锁死 pnpm 版本
- **典型症状**：在 `package.json` 中声明了 `"engines": { "node": ">=20", "pnpm": ">=11" }`，本地开发一切正常，但在 GitHub Actions 等 CI Runner 上执行 `pnpm install --frozen-lockfile` 时突然崩溃，报错：  
  ` ERR_PNPM_UNSUPPORTED_ENGINE  Expected version: >=11, Got: 10.x`。
- **连锁反应（恶性死锁）**：若尝试将 CI 中的 `pnpm/action-setup` 强行指定为 `version: 11`，在 `node-version: 20` 的容器中，最新版 pnpm 内部引用的新 Node 内置模块（如 `node:sqlite`）又会抛出 `ERR_UNKNOWN_BUILTIN_MODULE`，导致依赖安装彻底瘫痪！
- **最佳工程实践**：
  - 学习大厂优秀开源库（如 `dsh-superpower`）的黄金准则：`package.json.engines` **只声明 Node 底座版本**（如 `"node": ">=20"`），**绝不写死 `engines.pnpm`**；
  - 高版本包管理器的偏好建议仅在 README 顶部作为生态徽章（Badges）呈现；
  - CI 工作流中的 `pnpm/action-setup` 与 `actions/setup-node` 严格按 LTS 稳定兼容基线搭配（Node 20 配 pnpm 10，Node 22 配 pnpm 11+）。

### 2. PowerShell CLI 命令中管道符 | 的语法陷阱
- **典型症状**：在 Windows PowerShell / pwsh 中通过 CLI 命令更新云端配置或 GitHub 仓库简介（如 `gh repo edit --description "A | B"`）时，命令直接报错或返回非零 ExitCode。
- **根因分析**：PowerShell 的词法分析器在解析双引号字符串时，管道符 `|` 极易被误识别为命令行数据流管道（Pipeline Operator），导致命令被从管道处硬生生切成两段执行。
- **最佳工程实践**：
  - 在 PowerShell / pwsh 下传递包含 `|` 的参数时，**统一使用单引号包裹**：`gh repo edit --description 'A | B'`；
  - 若在模板字符串中动态拼接，优先使用反引号（`` `| ``）进行显式转义。

## 四、CI 纯净容器编译与单测对等依赖缺失陷阱 (CI Clean Container Peer Dependency & Scope Resolution Trap)

### 3. 单包插件工程的 CI 缓存踩坑与工作区声明隔离（The Empty Workspace File Trap）
- **典型症状**：在 GitHub Actions 流水线中，构建任务在刚进入 `actions/setup-node@v4`（配置了 `cache: pnpm`）时瞬间崩溃退出（Exit Code 1），日志报错：  
  ` ERROR  packages field missing or empty`  
  `For help, run: pnpm help store`  
  导致流水线连 `pnpm install` 步骤都未开始就地暴毙。
- **根因分析**：本地在执行 `pnpm update` 或某些依赖维护命令时，pnpm 可能在单包工程根目录自动生成了一个默认但空的 `pnpm-workspace.yaml`。若开发者未加甄别随 Git commit 提交到了远程，GitHub Actions 的 `actions/setup-node` 插件在检测到根目录存在 `pnpm-workspace.yaml` 时，会强制以 monorepo 多包工作区模式执行 `pnpm store path --silent` 来探测缓存目录；而因为该文件没有合法的 `packages:` 声明，pnpm 的 store 查询命令立刻抛错拒绝执行。
- **最佳工程实践**：
  - 单包（Single Package）DSH 插件工程**严禁提交无有效 packages 声明的 `pnpm-workspace.yaml`**；
  - 本地维护依赖后，执行 `git status` 必须严格审查是否有意外生成的 `pnpm-workspace.yaml`，若有必须立即物理删除（`git rm -f pnpm-workspace.yaml`）；
  - 单包工程应保持根目录纯净，仅保留 `package.json` 与 `pnpm-lock.yaml`。
### 4.1 典型症状与跨端假象

在本地开发机执行 `npm test` 全部通过，一旦推送到 GitHub Actions 远程 Ubuntu Runner（`npm ci` + `npm test`）却在单测启动阶段瞬间崩溃：
```text
# Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-scope' imported from /home/runner/work/.../node_modules/@deepseek-ai/dsh-skill/lib/index.js
#   code: 'ERR_MODULE_NOT_FOUND'
```

### 4.2 深度根因分析

1. **宿主注入 vs 脱机单测脱节**：
   - 在生产或真实 DSH 运行时中，`@deepseek-ai/dsh-scope` 或类似的基础底座包是由宿主运行时作为单例容器全局提供的；
   - 但在脱机单元测试中（例如 Provider 行为单测），测试直接以纯 Node.js ESM 模式加载编译产物，依赖链条直接击穿到底层源码。
2. **内部隐式直接引用**：
   - 上游底座包（如 `@deepseek-ai/dsh-skill`）在其已发布的编译产物 `lib/index.js` 顶层直接写着：
     ```javascript
     import { NamedEntries, ScopedLayers, scopeChainOf, scopeOf } from "@deepseek-ai/dsh-scope";
     ```
3. **npm ci 与 legacy-peer-deps 的深层拦截**：
   - DSH 插件为了避免复杂的对等依赖递归冲突，通常在 `.npmrc` 中配置了 `legacy-peer-deps=true`；
   - 在本地机器上，开发者先前调试或全局安装过宿主，包通常已被缓存或存在于上层目录中（假阳性）；
   - 但在 GitHub Actions 的全新干净 Ubuntu 容器中，`npm ci` 只会严格安装 `package-lock.json` 中登记的直接依赖，不会自动为对等依赖拉取深层关联包，导致运行时解析瞬间爆出 `ERR_MODULE_NOT_FOUND`。

### 4.3 黄金工程规范：构建与测试对等依赖显式声明

- **核心铁律**：**凡是在本地编译（tsc）或单测运行时链路中会被直接 import 的包，严禁仅寄希望于宿主注入，必须显式在 `package.json.devDependencies` 中登记，并完整同步至 `package-lock.json`**。
- **配置示例**：
  ```json
  {
    "peerDependencies": {
      "@deepseek-ai/cordis": ">=4.0.4 <5.0.0",
      "@deepseek-ai/dsh-skill": ">=<version> <0.3.0-0",
      "@deepseek-ai/schemastery": ">=3.18.4 <4.0.0"
    },
    "devDependencies": {
      "@deepseek-ai/cordis": "^4.0.5",
      "@deepseek-ai/dsh-skill": "^<version>",
      "@deepseek-ai/dsh-scope": "^<version>",
      "@deepseek-ai/schemastery": "^3.18.5"
    }
  }
  ```
- 锁文件同步命令必须带 `--package-lock-only`，确保开发依赖与版本声明零差异入锁：
  ```bash
  npm i --package-lock-only
  ```

---

## 五、宿主微内核对等依赖严格版本门禁规则 (DSH Host Peer Dependency Semver Gate Rule)

### 5.1 宿主版本拦截机制

DSH 微内核在引导 profile（`prepareProfile` / `loadProfileDirectory`）时，会对所有声明式插件行的 `peerDependencies` 与当前宿主自身的实际版本执行严格语义化版本（Semver）校验。

一旦插件声明的 `peerDependencies` 下限高于当前运行的宿主版本，宿主加载器会在启动阶段**无情执行静默或警告级物理禁用**：
```text
dsh: disabling profile plugin row "<rowId>": Plugin <name>@<version> is incompatible with dsh <version>: peerDependencies {"@deepseek-ai/dsh-skill":"^<version>"}.
Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime.
```
此时宿主虽然可能继续启动，但插件行被物理标记为 disabled，服务不注册、界面不挂载，表现为极其隐蔽的功能完全失效。

### 5.2 最佳声明实践：生命周期跨度版本区间 (Range Syntax)

为了让插件既能充分享受最新小版本引入的修复和新能力，又不会在相近小版本（如 RC 迭代期）被宿主直接当作不兼容而禁用：
- **反模式（过度收窄）**：`"@deepseek-ai/dsh-skill": "^<version>"`（在 <version> 宿主上直接被物理禁用）；
- **反模式（远古宽松包袱）**：`"@deepseek-ai/dsh-skill": ">=0.0.1-rc.1 <0.3.0-0"`（允许远古老版本，迫使代码充斥降级垫片）；
- **标准范式（生命周期区间）**：
  ```json
  {
    "peerDependencies": {
      "@deepseek-ai/cordis": ">=4.0.4 <5.0.0",
      "@deepseek-ai/dsh-skill": ">=<version> <0.3.0-0",
      "@deepseek-ai/schemastery": ">=3.18.4 <4.0.0"
    }
  }
  ```
- **设计判据**：
  1. 彻底斩断远古已废弃的大版本包袱（如 0.0.x / 0.1.x）；
  2. 下限设为当前核心架构定型时的基准 RC 版本（如 `<version>`）；
  3. 上限严格卡死在下一次重大架构重构前（如 `<0.3.0-0`），平滑承接宿主小版本补丁更新。
