# 插件设置表单与配置持久化 (Plugin Configuration Forms)

DeepSeek Harness (DSH 0.2.0-rc.2) 为插件提供了统一的用户配置表单（Settings Forms）体系。插件导出的 Schemastery 配置契约会被自动反射为 Web GUI 设置界面的可视化表单控件，并在用户修改后持久化至配置补丁文件。

## 架构模型与核心服务

- **`SettingsService` (`ctx.settings` / `@deepseek-ai/dsh-settings`)**：将当前激活 Profile 中的插件配置字段动态投影为前端表单描述符（Descriptors）。
- **`ConfigEditor` (`@deepseek-ai/dsh-config-editor`)**：提供带文件锁的原子化持久化写入服务，目标为当前 Profile 的 `cordis.patch.yml`。

## 标识寻址与表单隔离

表单系统基于当前 Profile 中条目的**局部唯一标识符（Entry ID）**进行命名空间寻址：
- 若同一个插件包被挂载了多个实例（例如挂载了两个独立的 MCP 客户端实例），只要它们的条目 `id` 不同（如 `id: mcp-context7` 与 `id: mcp-github`），前端设置面板就会自动呈现为两份独立的表单。
- 只有带有明确 `id` 且导出了非空 Schemastery Schema 的条目才会在设置面板生成表单。

## 表单描述符与乐观版本控制 (Optimistic Revision)

每个配置表单的描述符包含以下核心属性：
- **`resolvedValues`**：当前生效的最终配置值（已合并默认值与用户覆盖）。
- **`inheritedValues`**：由底层 Bundle 定义的基础默认配置。
- **`profileOverrides`**：在当前 Profile 的 `cordis.patch.yml` 中显式声明的覆盖字段。
- **`revision`**：用于并发安全保护的递增版本号。前端提交修改时必须附带期望版本号，若中途有其他进程或编辑器更新了文件，保存操作将因版本冲突而安全中止。

## 持久化写入语义规范

当用户在界面点击保存或通过 API 提交配置表单时，底层调用 `ConfigEditor.edit()` 执行写入：

1. **唯一写入目标**：`$DSH_HOME/profiles/<profile>/cordis.patch.yml`。
2. **全量替换规约 (Replaced Wholesale)**：写入的配置字段会完整替换该条目的 `config` 块。**不会执行深合并**。因此表单提交必须提交完整的已解析配置对象。
3. **文件锁保护**：写入过程受文件锁保护，避免并发写入导致 YAML 语法损坏。
4. **HMR 自动触发**：写入完成后，文件监听器自动检测到补丁变动，执行增量重载而无需重启应用。
