# DSH 插件开发实战示例库

<p align="center">
  <samp>
    <strong>中文</strong> ·
    <a href="./README.en.md">English</a>
  </samp>
</p>

本目录收录了 DeepSeek Harness (DSH) 官方规范下的完整实战插件示例。所有示例均采用 DSH Bundle 组合包规范、纯 JavaScript/ESM 编写、零构建步骤、即装即用。每个示例均针对 DSH 架构设计中的一种特定能力与核心规则，配有独立的配置声明与生命周期管理。

---

## 一、架构选型决策矩阵

在编写 DSH 插件前，请根据扩展目的选择最轻量且契合官方架构的插件形态：

| 业务需求 | 推荐插件形态 | 核心机制与 API | 对应示例工程 | 官方规范参考 |
| --- | --- | --- | --- | --- |
| 定时任务、状态轮询、外部系统连接 | **基础生命周期插件** | `name`, `apply`, `ctx.effect` | [hello-plugin](./hello-plugin) | `references/plugin-anatomy.md` |
| 为大模型注册可调用的新工具 | **模型工具插件** | `inject: ['tools']`, `defineTool` | [greet-tool](./greet-tool) | `references/tools.md` |
| 提供全局可共享的有状态服务能力 | **服务提供方插件** | 继承 `Service`, `super(ctx, name)` | [service-provider](./service-provider) | `references/services.md` |
| 工具权限控制、安全过滤、执行审计 | **事件流水线拦截插件** | `tools/pre-execute` (waterfall), `next()` | [event-interceptor](./event-interceptor) | `references/events.md` |
| 携带强类型配置参数、多环境部署 | **规范配置插件** | `Schemastery`, `!!js` 动态求值 | [configurable-plugin](./configurable-plugin) | `references/config.md` |
| 跨项目能力分发、多角色解耦 | **三角色架构包** | Definition / Provider / Consumer | `cfbridge` 生产规范 | `references/three-roles.md` |

---

## 二、示例工程深度解析

### 1. hello-plugin：生命周期管理与自清理原则

- **目录**：`./hello-plugin`
- **核心定位**：演示 DSH 插件的最小入口结构与“所有注册都是副作用”原则。
- **架构要点**：
  - 导出 `name = 'hello-plugin'` 与 `apply(ctx)`。
  - 任何脱离 Cordis 内建 API 管理的资源（如 `setInterval`、原生 WebSocket 连接、文件句柄），必须包装在 `ctx.effect(() => { return () => cleanup() })` 中。
  - 当插件卸载、热重载（HMR）或被显式 `fiber.dispose()` 时，Cordis 框架保证执行返回的清理函数，彻底杜绝内存与句柄泄露。
- **快速验证**：
  ```bash
  dsh plugin --profile demo add ./examples/hello-plugin
  dsh --profile demo
  ```

---

### 2. greet-tool：类型化模型工具与无损输出

- **目录**：`./greet-tool`
- **核心定位**：演示如何使用第一方推荐的 `defineTool` 注册模型工具。
- **架构要点**：
  - `inject: ['tools']`：显式声明依赖，确保在工具注册表就绪后再执行注册。
  - `parameters`：声明参数类型与描述，框架在进入 `execute` 前自动校验输入，防止无效调用穿透到工具内部。
  - `output.schema` 与 `output.render`：`execute` 仅返回规范的 JSON 数据值（严禁在 execute 内部直接返回自然语言文本块）；面向人类或模型阅读的文本统一由 `output.render` 进行投影转换。
  - 遵守 `exec.signal`：当上层取消会话或超时时，异步操作能够及时中止。
- **快速验证**：
  ```bash
  dsh plugin --profile demo add ./examples/greet-tool
  dsh --profile demo
  # 在会话中向智能体发送：Use greet tool to greet Ada.
  ```

---

### 3. service-provider：面向服务的依赖注入架构

- **目录**：`./service-provider`
- **核心定位**：演示如何向 DSH 全局上下文提供可复用的服务（Service）。
- **架构要点**：
  - 继承 `Service` 基类：在构造函数中通过 `super(ctx, 'memoryCache')` 注册，实例自动挂载到 `ctx.memoryCache`。
  - 声明周期跟随：服务内部通过 `this.ctx.effect` 注册数据清空逻辑，卸载时整洁退出。
  - 消费方安全等待：消费者插件通过 `inject: ['memoryCache']` 声明强依赖，Cordis 框架保证依赖未满足前消费方始终保持 `PENDING`，无需在业务代码中到处编写 `if (!ctx.memoryCache)` 保护代码。
- **快速验证**：
  ```bash
  dsh plugin --profile demo add ./examples/service-provider
  dsh --profile demo
  # 日志将按序打印消费者成功读取缓存：operational
  ```

---

### 4. event-interceptor：流水线拦截与安全门禁

- **目录**：`./event-interceptor`
- **核心定位**：演示基于事件系统的安全拦截、权限门禁与审计日志。
- **架构要点**：
  - **流水线模式（Waterfall）**：监听 `tools/pre-execute`。
  - **核心铁律**：waterfall 监听器**必须调用 `await next()`**。若调用不合法，返回 `{ kind: 'deny', reason: '...' }` 即可提前短路执行链；若合法，必须调用 `next()` 传递给下游，绝不可遗漏。
  - **广播模式（Emit）**：监听 `tools/result`，以只读方式获取不可变的执行结果，用于输出审计日志与指标上报。
- **快速验证**：
  ```bash
  dsh plugin --profile demo add ./examples/event-interceptor
  dsh --profile demo
  ```

---

### 5. configurable-plugin：规范配置 Schema 与动态求值

- **目录**：`./configurable-plugin`
- **核心定位**：演示如何使用 Schemastery 编写工业级配置 Schema 与多环境配置注入。
- **架构要点**：
  - 导出同名 `Config` Schema 对象（使用 `@deepseek-ai/schemastery`），严禁导出未受保护的普通对象。
  - 配置约束表达：通过 `.min()`, `.max()`, `.default()`, `.description()` 声明完备的约束。
  - 动态环境变量（`!!js`）：在 `cordis.patch.yml` 中使用 `!!js 'process.env.VARIABLE'`，安全地从系统环境中注入动态配置，避免敏感信息落盘。
- **快速验证**：
  ```bash
  dsh plugin --profile demo add ./examples/configurable-plugin
  dsh --profile demo --dump-config
  dsh --profile demo
  ```

---

## 三、DSH 插件开发八大硬规则对照表

| 序号 | 规则名称 | 核心原则 | 违规反模式 | 正确示范 |
| --- | --- | --- | --- | --- |
| 1 | **接口以生成参考为准** | 服务名、事件名以官方 TypeScript 接口为准 | 凭直觉猜测 `ctx.toolService` | 查看官方参考或使用 `ctx.tools` |
| 2 | **所有贡献都是副作用** | 注册资源必须可逆，插件卸载时自动全量清理 | 在模块全局作用域启动 `setInterval` | 在 `ctx.effect()` 内启动并返回清理函数 |
| 3 | **Waterfall 必须调用 next()** | 拦截流水线中必须显式传递或有明确短路返回值 | 忘记 `return next()` 导致工具执行无响应 | `const res = await next(); return res;` |
| 4 | **失败要响亮** | 配置非法或依赖缺失时明确报错，拒绝静默吞错 | 在 `apply` 内部用空的 `try-catch` 吞掉错误 | 抛出清晰异常或让 Schema 自动拒绝加载 |
| 5 | **必需依赖用 inject** | 强依赖写进 `inject`，可选依赖用 `ctx.get()` 判空 | 直接访问未声明的 `ctx.xxx` 并假设它存在 | `export const inject = ['tools']` |
| 6 | **配置一律 Schemastery** | 导出类型同名的 Schema 对象，默认值写进 Schema | 导出普通 JavaScript 对象作为 Config | `export const Config = Schema.object({...})` |
| 7 | **工具 execute 返回规范 JSON** | 返回标准业务数据，文本排版交给 render | 在 `execute` 中返回 `[{ type: 'text', text }]` | execute 返回原始对象，`output.render` 负责展示 |
| 8 | **模型可见即已记录** | 新增模型可见输入必须落入会话历史重建链条 | 私下修改会话上下文而不通过合法事件流 | 使用标准事件流或 `agent.inject()` 上报 |

---

## 四、开发者 CLI 命令速查表

```bash
# 1. 向指定 profile 添加本地 bundle 插件
dsh plugin --profile demo add ./examples/greet-tool

# 2. 从指定 profile 卸载插件
dsh plugin --profile demo remove dsh-greet-tool

# 3. 打印当前 profile 最终合并生效的配置图（检查 patch 展开情况）
dsh --profile demo --dump-config

# 4. 以指定 profile 启动 DSH Web 运行时
dsh --profile demo

# 5. 开发时无需打包，直接使用 patch 覆盖启动（源码回路）
pnpm dsh web --patch ./scratch-plugin/cordis.yml

# 6. 使用独立的临时环境安全验证安装（推荐）
$env:DSH_HOME = "C:\Temp\dsh-test"
dsh plugin --profile test-env add ./examples/hello-plugin
dsh --profile test-env --dump-config
```

---

## 五、高频踩坑与排查指南 (Troubleshooting)

### 1. 插件一直处于 PENDING 状态，apply 没有执行
- **原因**：`inject` 数组中声明的服务尚未在系统中注册就绪。
- **排查**：检查 `cordis.yml` 中是否包含了提供该服务的对应插件；如果是可选依赖，请不要放入 `inject`，而是改为在函数内部使用 `ctx.get('serviceName')` 动态判断。

### 2. 工具调用后模型一直等待，直到触发超时
- **原因**：存在监听了 `tools/pre-execute` 的中间件插件，但在逻辑分支中遗漏了 `return next()`，导致整个调用流水线挂起。
- **排查**：检查所有事件中间件，确保在非拦截分支下始终返回 `await next()`。

### 3. 启动报错 "Invalid configuration"
- **原因**：传入的 YAML 配置无法通过插件导出的 Schemastery Schema 校验（例如字段类型不匹配、数值超出了 `min`/`max` 范围）。
- **排查**：运行 `dsh --profile <name> --dump-config` 查看展开后的配置值，比对 `Config` Schema 定义。

### 4. 插件热重载（HMR）后出现重复执行或定时器翻倍
- **原因**：未将事件监听或定时器绑定到 Cordis 上下文，写成了模块顶层全局变量。
- **排查**：将全部生命周期操作放入 `apply`，原生资源使用 `ctx.effect` 包裹。
