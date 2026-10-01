# 插件配置与 Schemastery

配置系统允许插件定义强类型配置结构，并在运行时通过 Schemastery 进行验证与默认值填充。在 DeepSeek Harness (DSH) 中，配置既支持代码声明，也遵循严格的补丁叠加规范。

## 定义 Config 类型与 Schema

插件应导出 `interface Config` 与同名 `Config` Schemastery 运行时校验 Schema。默认值直接定义在 Schema 中：

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-configurable-plugin'

export interface Config {
  apiKey?: string
  endpoint: string
  maxRetries: number
  verbose: boolean
  features: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().role('secret').description('API 认证凭据'),
  endpoint: Schema.string().default('https://api.example.com/v1').description('服务接口基地址'),
  maxRetries: Schema.number().min(0).max(10).default(3).description('请求失败最大重试次数'),
  verbose: Schema.boolean().default(false).description('是否输出详细运行日志'),
  features: Schema.array(Schema.string()).default([]).description('启用的特性标签列表'),
})

export function apply(ctx: Context, config: Config) {
  // apply 执行时，config 已完成类型校验并合并了默认值
  console.log('Endpoint:', config.endpoint)
  console.log('Max retries:', config.maxRetries)
}
```

## 常用 Schemastery 构造器

- `Schema.string()`: 字符串类型，可搭配 `.role('secret')` 标记为密码脱敏，`.pattern(regex)` 正则匹配。
- `Schema.number()`: 数值类型，可搭配 `.min(n)`、`.max(n)`、`.step(n)`。
- `Schema.boolean()`: 布尔类型。
- `Schema.array(innerSchema)`: 数组类型。
- `Schema.dict(valueSchema)`: 键值对字典对象。
- `Schema.union(['optionA', 'optionB', 'optionC'])`: 枚举联合类型。
- `Schema.intersect([SchemaA, SchemaB])`: 结构交叉类型。
- `Schema.hidden()`: 运行时专用字段，从前端表单或配置文件序列化中隐藏。

## 配置的真实生效落点 (至关重要)

### 废弃警告：不要修改 settings.yaml

`$DSH_HOME/settings.yaml` 是早期版本的历史文件，**现已完全废弃**。在 DSH 启动时，`@deepseek-ai/dsh-settings` 的 `importLegacyDocument()` 会将其自动改名为 `settings.yaml.imported`，并将其中的节区导入至配置补丁。修改 `settings.yaml` 或 `settings.yaml.imported` **不会产生任何效果**。

### 唯一合法落点：cordis.patch.yml

用户和安装脚本修改配置的真实落点是对应 Profile 目录下的补丁文件：

```
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

例如对于默认 Web 界面，路径为 `$DSH_HOME/profiles/web/cordis.patch.yml`。

## 补丁写入语义与语法

### 1. 全量替换语义 (Wholesale Replacement, Not Deep-Merged)

在 `cordis.patch.yml` 中，对既有插件条目的 `config` 字段修改是**整体替换，不进行深度合并**（Config is replaced wholesale, not deep-merged）。

如果某个插件原本拥有 `apiKey`、`endpoint`、`maxRetries` 三个字段，而在 patch 中仅声明了：

```yaml
- id: my-plugin-entry
  config:
    maxRetries: 5
```

则原有配置中的 `apiKey` 与 `endpoint` 将被全部抹除！因此：**修改既有插件配置时，必须将该插件全部需要保留的配置字段完整写入**。

### 2. 插入新插件 (insert 语法)

在补丁中声明全新安装的插件时，使用 `- insert:` 顶层节点：

```yaml
- insert:
    - id: my-custom-plugin
      name: '@my-scope/dsh-custom-plugin'
      config:
        endpoint: 'https://api.custom.com'
        maxRetries: 5
        verbose: true
      disabled: false
```

### 3. 条件激活与环境变量控制

补丁支持 JS 表达式标签（`!!js`）进行环境条件求值：

```yaml
- insert:
    - id: mcp-custom-service
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: custom-service
        transport: streamable-http
        url: !!js process.env.CUSTOM_MCP_URL
      disabled: !!js '!process.env.CUSTOM_MCP_URL'
```

当环境变量 `CUSTOM_MCP_URL` 不存在时，该插件实例将被禁用，避免启动时因缺少环境变量而报错。

### 4. 覆盖已有插件条目

修改由底层 Bundle（如 `dsh-base`、`dsh-web-app`）提供的内置插件时，直接按条目 `id` 定位：

```yaml
- id: better-sidebar
  name: dsh-better-sidebar
  config:
    titleBarCompat: true
```

若目标 `id` 在当前组合中不存在，DSH 仅会在控制台打印跳过警告，不会阻止系统启动。

## 历史节区名称映射 (Legacy Mappings)

若从旧版文档或脚本迁移，需注意以下历史节区名称已重命名为现代条目 ID：

| 旧版 Section 名称 | 现代 Profile 条目 ID | 对应说明 |
| --- | --- | --- |
| `ui-onboarding` | `ui-settings-general` | 通用界面设置与引导 |
| `ui-developer-tools` | `ui-settings` | 开发者工具设置 |
| `shell` | `pwsh-sandbox` (Windows) / `bash-sandbox` (其他平台) | 终端执行沙箱环境配置 |

## 调试与验证配置树

在修改 `cordis.patch.yml` 后，应通过 CLI 命令导出合并后的完整配置树，以排查语法错误或验证配置覆盖结果：

```bash
# 验证 web profile 的合并配置
dsh --profile web --dump-config

# 验证控制台 TUI profile 的合并配置
dsh --profile dsh-tui --dump-config
```

如果 `--dump-config` 正常输出 YAML 树且 stderr 为空，说明补丁语法解析正确。
