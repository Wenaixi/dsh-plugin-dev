# 官方上游源码与官方文档核验指引 (DSH 0.2.0-rc.2)

本技能库所有架构结论均来自官方一手来源。当本地指南与官方源码冲突时，**一律以官方源码为准**，并按本文件指引的方式回溯核实。

---

## 一、官方上游源码仓库 (GitHub)

| 资源 | 地址 | 说明 |
| :--- | :--- | :--- |
| 主仓库 | https://github.com/deepseek-ai/deepseek-harness | 官方 monorepo，默认分支 master，发布 tag 如 v0.2.0-rc.2 |
| 包清单 | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/README.md | 全量官方包命名、分组与职责的第一手索引 |
| 模块依赖图 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/module-graph.md | 包与包之间的依赖边，用于判断该依赖谁、绝不该依赖谁 |
| Cordis 教程 | https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/index.md | 仓库内的 Cordis 入门教程源文件 |
| 子系统文档 | https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/subsystems | 每个子系统一篇，例如 attachment.md |
| 包内 README | packages/域/包名/README.md | **单包最权威的说明**：组合规则、配置项、设计理由都写在包里 |
| 类型声明 | 发布物 lib/index.js 内联 JSDoc 与 lib/types/*.js；多数包无 .d.ts（types 字段指向不存在的 lib/types/*.d.ts） | 运行时真实契约，含 inject、Config、declare module 扩展 |

### 1. 优先读包内 README，而非汇总文档

官方把「组合规则」「配置语义」「设计理由」写在每个包自己的 README 里，汇总文档只给结论。遇到细则争议时，**先打开该包的 README 与类型声明**。

---

## 二、官方文档站 (GitHub Pages)

站点根：https://deepseek-harness.github.io/deepseek-harness/

### 1. 双语入口

- 英文版：https://deepseek-harness.github.io/deepseek-harness/en/... 
- 简体中文版：https://deepseek-harness.github.io/deepseek-harness/... （**去掉 /en/ 即为中文版**，页面路径完全一致）

### 2. 权威页面全清单（已逐页核实存在）

**概念层 (Concepts)**

| 主题 | 页面地址 | 对应本库文档 |
| :--- | :--- | :--- |
| 整体架构 | https://deepseek-harness.github.io/deepseek-harness/en/reference/ | services.md |
| Cordis 入门 | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-primer | plugin-anatomy.md |
| 能力切面与核心服务 | https://deepseek-harness.github.io/deepseek-harness/en/reference/capability-seams | services.md |
| 智能体生命周期 | https://deepseek-harness.github.io/deepseek-harness/en/reference/agent-lifecycle | tools.md、three-roles.md |
| 工具执行流水线 | https://deepseek-harness.github.io/deepseek-harness/en/reference/tool-execution-pipeline | tools.md |
| API 网关 | https://deepseek-harness.github.io/deepseek-harness/en/reference/api-gateway | remote-rpc-guide.md、three-roles.md |
| 子系统索引 | https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/ | 全库各专题 |

**自动生成目录 (Generated reference)**：仅在 BEGIN/END GENERATED markers 之间的生成区禁手改（gen-cordis-catalog 等重写该区），文档源文件整体可编辑；

| 目录 | 页面地址 | 对应本库文档 |
| :--- | :--- | :--- |
| 插件配置目录 | https://deepseek-harness.github.io/deepseek-harness/en/reference/config-catalog | config.md |
| 工具 Schema 目录 | https://deepseek-harness.github.io/deepseek-harness/en/reference/tool-catalog | tools.md |
| 持久化事件目录 | https://deepseek-harness.github.io/deepseek-harness/en/reference/persistence-catalog | events.md |

**Cordis 核心 API**

| 模块 | 页面地址 |
| :--- | :--- |
| Context | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/context |
| Events | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/events |
| Fiber | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/fiber |
| 插件注册表 | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/registry |
| Service | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/service |
| 继承面 | https://deepseek-harness.github.io/deepseek-harness/en/reference/cordis-api/inherited |

**开发与速查**

| 主题 | 页面地址 |
| :--- | :--- |
| 快速开始 | https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart |
| 开发基础 | https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/ |
| Cordis 教程 | https://deepseek-harness.github.io/deepseek-harness/en/develop/cordis-tutorial/ |
| 新增一个包 | https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-package |

---

## 三、本地已安装的官方包（最快的真相来源）

无需联网即可核对契约。本机存在两处官方包目录：

| 用途 | 路径 | 内容 |
| :--- | :--- | :--- |
| 全局安装本体 | npm全局根/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/ | 官方核心包与共享依赖，含 cordis、dsh-tools、dsh-session、dsh-system-prompt 等 |
| Profile 本地 | DSH_HOME/profiles/&lt;profile&gt;/node_modules/ | 该 profile 自行安装的第三方插件（界面、增强类） |

Windows 上全局本体通常位于：

npm 全局根（`npm root -g` 查询；Windows 默认 %APPDATA%\npm\node_modules）下的 @deepseek-ai/dsh/node_modules/@deepseek-ai/

### 1. 单包结构速查

```
包名/
├── package.json      # name / inject / dsh.client / exports（插件身份与声明）
├── README.md         # 组合规则、配置语义、设计理由（最权威说明）
└── lib/
    ├── index.js       # 打包产物（顶部注释写明服务角色与挂载名；内联 JSDoc 即类型契约，发布物无独立 index.d.ts）
    ├── index.js      # 运行时实现（已打包，含完整注释头）
    └── types/        # 细分类型定义与品牌类型（Branded Types）
```

### 2. 从类型声明头部直接读出插件身份

官方每个包的 lib/index.js（打包产物）顶部注释写明服务角色与挂载名，**这是最快速的身份判定方式**（发布物无独立 index.d.ts；declare module 声明合并在源码 TS 层，文档站 cordis-api 页由 gen-cordis-catalog 生成）：

```ts
/**
 * Service Definition for the credential-reference capability seam (`ctx.credentials`).
 * @module @deepseek-ai/dsh-credentials
 */
declare module '@deepseek-ai/cordis' {
    interface Context { credentials: Credentials }
}
```

- 第一段注释 = 这个包扮演什么角色（Definition 定义 / Provider 提供方 / Consumer 消费方 / Library 纯库）；
- declare module 块 = 往 Context 上挂了什么、叫什么名字；
- export declare const inject = 它启动前必须等哪些服务就绪。

---

## 四、事实核验三级证据强度 (Verification Triad)

任何架构结论在下结论前，按以下三级证据强度核验：

```
[最弱] 官方文档站散文描述
        ↓ 若与下层冲突则弃用
[中等] 官方仓库 packages/包名/README.md
        ↓ 若与下层冲突则弃用
[最强] 本地 lib/*.js 真实实现（含内联 JSDoc；多数包无 .d.ts）
        ↓ 若与运行时不符则弃用
[运行时] 宿主真实行为
```

### 1. 运行时验证优先级最高

- 工具清单以 ctx.tools.schemas() 的运行时结果为准，静态目录会随版本漂移；
- 服务是否真的挂载，用 ctx.get('服务名') 判断，返回 undefined 即该能力未装配；
--dump-config **不会加载插件**，用它验证插件是否生效会得到假阳性；真实判据是端口监听 + 首页返回 200 text/html。

---

## 五、版本升级后的回溯流程

DSH 迭代频繁，出现与本库描述不符的行为时，按此顺序处理：

1. **确认版本**：dsh --version，并核对 DSH_HOME/profiles/&lt;profile&gt;/compatibility.json；
2. **看上游变更**：比对 Releases 与 packages/README.md 的包增删；
3. **读本地新码**：打开对应包的新版 lib/index.js（内联 JSDoc 与 lib/types/*.js），确认 inject 与 Config 是否变化；
4. **跑运行时验证**：以 ctx.tools.schemas()、ctx.get('服务') 与实际启动日志为准；
5. **回写本库**：修正对应 references/*.md 中与源码冲突的表述，并在 CLAUDE.md 的校准表中追加一条记录。

---

## 六、常见误区

| 误区 | 事实 |
| :--- | :--- |
| 只读官方文档站就动手写插件 | 文档站整体偏后端，但前端已有成体系章节（slots 插槽层次与注册契约、settings 设置面板 API、cookbook adding-a-settings-card）；插槽 key 枚举、优先级与样式变量仍须以运行时 catalogs 与本地源码为准 |
| 直接改 DSH_HOME/settings.yaml | 该文件已废弃，启动时会被自动重命名为 settings.yaml.imported；一切配置走 cordis.patch.yml |
| 把 src/ 当作发布产物 | 运行时加载的是 lib/，src/ 仅用于 TypeScript 源码与官方仓库查阅 |
| 用 --dump-config 证明插件可用 | 该命令不加载插件，只能证明配置被解析 |
| 依赖 dsh-agent-loop 扩展 | ctx.agentLoop 是唯一具体循环实现（全库仅 dsh-agent-loop 挂载）；扩展循环驱动需直接依赖 dsh-session/dsh-llm/dsh-system-prompt/dsh-tools 等服务，dsh-agent 本体零运行时依赖，不能经由它拿到循环能力 |
