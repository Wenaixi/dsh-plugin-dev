# 核心能力切面与架构映射 (Seams Architecture)

DeepSeek Harness (DSH 0.2.0-rc.2) 的设计精髓在于**切面（Seam）化设计**：不存在特权或硬编码的内置逻辑，所有产品能力均被切分为抽象契约，由配置可替换的插件实现。

一个标准的 Seam 包含三层角色：
1. **接口声明 (Service Definition)**：定义方法与事件契约的包或服务。
2. **实现提供方 (Service Provider)**：具体提供该能力的插件（如 DeepSeek 适配器、SQLite 存储）。
3. **消费者 (Consumer)**：使用该服务的业务插件或面向模型的工具。

## DSH 核心八大能力切面全表

| 切面名称 | 声明包与 ctx 属性 | 默认提供方 (Default Provider) | 替代实现举例 (Alternative Providers) | 核心职责 |
| --- | --- | --- | --- | --- |
| **SessionLog** | `@deepseek-ai/dsh-session`<br>`ctx.sessions` | `session-memory` + `persistence-fs` | `session-sqlite`, 云端同步数据库 | 仅追加的 `SessionEvent` 唯一真源日志与状态快照管理 |
| **SystemPrompt** | `@deepseek-ai/dsh-system-prompt`<br>`ctx.systemPrompt` | `system-prompt` 基础装配器 | 专用微调模板装配器、业务定制提示词注入器 | 动态收集提示词片段与模型可见工具 Schema 生成 |
| **ToolRuntime** | `@deepseek-ai/dsh-tools`<br>`ctx.tools` | `dsh-tools` 标准执行管线 | 外部 MCP 代理网关、PTC 单一代码执行管线 | 工具注册、输入校验、执行把关卫士与展示投影 |
| **Agent / Loop** | `@deepseek-ai/dsh-agent` (`ctx.agents`)<br>`@deepseek-ai/dsh-agent-loop` (`ctx.agentLoop`) | `agent-loop` 标准单轮迭代器 | 树状规划驱动器、并发团队协同调度器 | 实现 `AgentFactory` 接口，驱动单步感知-思考-执行循环 |
| **LlmRuntime** | `@deepseek-ai/dsh-llm`<br>`ctx.llm` | `llm-deepseek` (官方 API 适配器) | `llm-pi-ai`, 本地 Ollama, OpenAI 兼容网关 | 屏蔽大模型厂商差异，分发统一 `StreamChunk` 流式序列 |
| **Settings / Forms** | `@deepseek-ai/dsh-settings`<br>`ctx.settings` | `dsh-config-editor` | 企业统一配置中心拉取器 | 偏好表单抽象与 `cordis.patch.yml` 事务性持久化 |
| **Credentials** | `@deepseek-ai/dsh-credentials`<br>`ctx.credentials` | 操作系统密钥环与本地 `.env` | 云 KMS、HashiCorp Vault 扩展插件 | 用户 API Key 与敏感环境变量受控注入与脱敏 |
| **ClientModules** | `@deepseek-ai/dsh-client-modules`<br>`ctx.clientModules` | Web GUI 静态资源合并与 Combo 服务 | Headless 无头模式空适配器 | 扫描已安装双面插件，向前端注入 `window.__DSH_BOOT__` |

## 插件依赖倒置法则

在编写 DSH 插件时，必须遵守依赖倒置原则：
- **依赖接口声明包**：只依赖声明接口的抽象包（如 `@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-tools`），在 `inject` 中按服务名声明。
- **严禁依赖具体实现包**：绝不直接 `import` 具体提供方实现（例如不要在业务代码中直接 `import { DefaultAgentLoop } from '@deepseek-ai/dsh-agent-loop'`），以确保底座在更换驱动器或沙箱环境时业务逻辑完全不受影响。
