# 工作区开发与多包联调 (Workspace Package Development)

在大型项目或 Monorepo 仓库中，通常需要同时开发核心应用和多个插件包。DSH 原生基于 pnpm 构建，完全支持 pnpm workspace 规范与多包联动开发。

## 工作区结构规划

在本地开发工作区中，推荐将宿主测试 Profile 与自定义插件放置在统一的 pnpm monorepo 下：

```
my-dsh-workspace/
├── pnpm-workspace.yaml
├── package.json
└── packages/
    ├── dsh-plugin-foo/        # 插件 A（含 dsh.bundle 声明）
    │   ├── package.json
    │   ├── cordis.patch.yml
    │   └── src/index.ts
    └── dsh-plugin-bar/        # 插件 B
        ├── package.json
        ├── cordis.patch.yml
        └── src/index.ts
```

### pnpm-workspace.yaml 声明

```yaml
packages:
  - 'packages/*'
```

## 在 Profile 中联调本地工作区插件

### 方式 A：相对路径引用 (推荐)

在 Profile 目录（如 `$DSH_HOME/profiles/web`）直接使用 pnpm 相对路径安装本地包：

```bash
cd $DSH_HOME/profiles/web
pnpm add C:/path/to/my-dsh-workspace/packages/dsh-plugin-foo
```

随后在 `$DSH_HOME/profiles/web/package.json` 的 `dsh.profile.bundles` 数组中追加包名 `dsh-plugin-foo`。

### 方式 B：pnpm link 软链联调

```bash
# 1. 在插件目录注册全局软链
cd /path/to/my-dsh-workspace/packages/dsh-plugin-foo
pnpm link --global

# 2. 在目标 profile 目录链接该包
cd $DSH_HOME/profiles/web
pnpm link --global dsh-plugin-foo
```

## 开发态构建与实时 HMR

对于 TypeScript 编写的插件，推荐在插件内部配置构建监听或实时产物输出：

```json
{
  "scripts": {
    "build": "tsc -b && tsdown",
    "dev": "tsdown --watch"
  }
}
```

当运行 `pnpm run dev` 持续生成产物时：
- **服务端 Node 插件**：在 `web` profile 中，可通过 `cordis.patch.yml` 触发配置重载。
- **客户端 UI 插件**：`@deepseek-ai/dsh-client-hmr` 监听到 `lib/client.js` 变更后，将通过 SSE 自动向浏览器下发热替换通知，在不刷新浏览器页面的情况下完成组件重载与样式更新。

## 多包发布的最佳实践

1. **统一类型定义**：共享的类型（如服务接口定义、事件载荷）抽离至纯类型包或根模块导出，避免跨包循环依赖。
2. **peerDependencies 严格解耦**：将 `@deepseek-ai/cordis`、`@deepseek-ai/dsh`、`react` 声明为 `peerDependencies`，确保运行时加载的是宿主统一实例，避免单例服务或 React 上下文因多版本而分裂失效。
3. **发布前校验**：确保 `package.json` 的 `files` 字段显式包含编译后的 `lib/` 目录和 `cordis.patch.yml`，避免遗漏关键补丁导致安装后不生效。
