# 插件打包与分发 (Packaging & Distribution)

在 DeepSeek Harness (DSH 0.2.0-rc.2) 中，可安装与可分发的插件单元被称为**组合包（Bundle）**。Bundle 通过携带配置补丁向指定的**运行装配体（Profile）**贡献能力。

## 核心概念：Bundle vs Profile

Bundle 与 Profile 职责截然不同，在 `package.json` 中携带互斥的 `dsh` 声明。**没有任何包可以同时兼具两者身份**：

| 实体 | 物理形态 | 清单声明 | 核心回答的问题 | 典型命令与用法 |
| --- | --- | --- | --- | --- |
| **组合包 (Bundle)** | npm 包（可发布或本地包） | `dsh.bundle: { patch: ... }` | “这个包贡献什么能力与配置？” | 编写、发布并通过 `dsh plugin add` 安装 |
| **装配体 (Profile)** | 位于 `$DSH_HOME/profiles/<name>` 的目录 | `dsh.profile: { bundles: [...] }` | “当前运行实例由哪些 Bundle 按什么顺序叠加？” | `dsh --profile <name>` 或 `dsh web` 启动 |

## Bundle 目录结构与规范

标准 Bundle 的推荐文件组织如下（支持 Node 纯服务端插件与双面 Client-UI 插件）：

```
my-feature-plugin/
├── package.json          # 声明入口、依赖与 dsh.bundle 清单
├── cordis.patch.yml      # Profile 引入本 Bundle 时应用的配置补丁层
├── lib/
│   ├── index.js          # Node 宿主端入口（导出 apply(ctx)）
│   └── client.js         # (可选) Browser 前端入口（导出客户端 apply(ctx)）
└── README.md
```

### package.json 声明

```json
{
  "name": "dsh-my-feature",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "files": [
    "lib",
    "cordis.patch.yml"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=0.2.0-rc.1"
  }
}
```

注：`dsh.bundle.patch` 支持字符串路径（如 `"./cordis.patch.yml"`），也支持有序文件数组（如 `["./base.patch.yml", "./web.patch.yml"]`）。

## cordis.patch.yml 规范

Bundle 携带的补丁文件用于在装配树中挂载插件实例：

```yaml
- insert:
    - id: my-feature-entry
      name: 'dsh-my-feature'
      config:
        enabled: true
        maxConcurrency: 4
      disabled: false
```

## 安装与卸载命令 (dsh plugin CLI)

DSH 提供了统一的 CLI 命令管理 Profile 中的插件：

```bash
# 1. 向默认 web profile 添加已发布的 npm 插件包
dsh plugin add dsh-my-feature

# 2. 向特定 profile（例如 headless）添加插件
dsh plugin --profile headless add dsh-my-feature

# 3. 从本地目录或本地 tarball 安装
dsh plugin add ./path/to/my-plugin-0.1.0.tgz

# 4. 从 profile 中移除插件
dsh plugin remove dsh-my-feature
```

### `dsh plugin add` 底层执行流程

1. 调用目标 Profile 目录内置的 pnpm，将插件依赖安装至 `$DSH_HOME/profiles/<name>/node_modules`。
2. 读取该插件的 `package.json`，验证其是否声明了 `dsh.bundle.patch`。
3. 自动将该插件包名追加到目标 Profile 的 `package.json` 的 `dsh.profile.bundles` 数组末尾。
4. 在启用 HMR 的长生命周期 Profile（如 `web`）中，配置监听器自动触发实时增量热重载，无需重启整个应用。

## 五大预置 Profile 模板

| Profile 名称 | 内置 Bundles 组合 | 定位与特征 |
| --- | --- | --- |
| `web` | `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` | 浏览器图形界面，支持 Client-UI 插槽与配置热重载 |
| `headless` | `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless` | 命令行一次性无头执行器，禁用 HMR |
| `sdk` | `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-sdk-app` | 供外部应用调用的 JSON-RPC 服务宿主 |
| `sdk-minimal` | `@deepseek-ai/dsh-sdk-minimal` | 极简极速独立启动特例，**不加载 dsh-base** |
| `acp` | `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-acp-app` | Agent Control Protocol 专用服务端 |
