# DSH 插件开发技术参考目录

本目录包含 DeepSeek Harness (DSH 0.2.0-rc.2) 插件开发的全部权威规范、API 契约与底层设计文档。所有内容均基于 DSH 官方最新生成的架构规范与真实生产运行时进行校准。

## 文档架构分类

### 一、微内核与服务架构 (Microkernel & Spine)
- [plugin-anatomy.md](./plugin-anatomy.md)：插件标准解剖学，函数插件与 Service 类插件的结构规范、`name` 与 `inject` 声明。
- [services.md](./services.md)：核心服务大动脉矩阵（`ctx.sessions`、`ctx.tools`、`ctx.agents`、`ctx.llm`、`ctx.systemPrompt` 等），服务生命周期与类型合并声明。
- [context-api.md](./context-api.md)：Cordis 上下文树结构、`ctx.plugin` 挂载、`ctx.effect` 可逆副作用与 `@deepseek-ai/dsh-scope` 作用域隔离。
- [seams.md](./seams.md)：可替换切面（Seams）模型映射，Service Definition、Provider 与 Consumer 三者解耦架构。

### 二、配置系统与补丁机制 (Configuration & Patches)
- [config.md](./config.md)：Schemastery 强类型 Schema 定义、`cordis.patch.yml` 唯一落点与全量替换（Wholesale Replacement）语义、`settings.yaml` 废弃说明。
- [plugin-forms.md](./plugin-forms.md)：设置表单与配置编辑器系统，条目 ID 寻址、表单描述符、乐观并发版本控制与原子写入。

### 三、事件总线与执行管线 (Events & Execution)
- [events.md](./events.md)：Cordis 五大事件派发模式（`emit`、`waterfall`、`parallel`、`serial`、`bail`）全解与 DSH 核心事件清单。
- [tools.md](./tools.md)：`ToolRuntime` 工具注册、`defineTool` DSL、PTC 代码化模式（`presentAs`）、单调安全守卫（`guard`）与多模态 `ContentBlock` 渲染。
- [llm-adapter.md](./llm-adapter.md)：LLM 适配器类开发、`LlmRuntime.registerAdapter`、`StreamChunk` 流式分发协议与互斥 Token 计量准则。

### 四、打包、工作区与多端角色 (Packaging & Multi-Role)
- [packaging.md](./packaging.md)：组合包（Bundle）与装配体（Profile）规范、`package.json` 清单声明与 `dsh plugin add` 完整安装流。
- [workspace-package.md](./workspace-package.md)：Monorepo 多包工作区联调、相对路径引用、软链链接与开发态实时 HMR。
- [three-roles.md](./three-roles.md)：Browser / Host / Worker 三角色物理隔离、双面插件（Dual-Face）标准、SlotRegistry 插槽系统与双通道 IPC 通信网络。
