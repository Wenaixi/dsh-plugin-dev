# DSH MCP 客户端集成与自定义工具桥接权威指南 (DSH 0.2.0-rc.2)

> **⚠️ 核心定位声明**
> **本文件是辅助开发 DeepSeek Harness (DSH) 插件中 MCP 协议集成与外部工具桥接的权威技术规范。**
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 一、DSH 中的 MCP 架构设计与桥接原理

在 DeepSeek Harness 架构中，外部 MCP (Model Context Protocol) 服务的引入**并不是修改核心代码，而是作为标准的 Cordis 插件装配到系统中**。

官方核心包 `@deepseek-ai/dsh-mcp-client` 扮演了**协议转换桥梁**的角色：
1. 它作为一个独立的插件实例运行，在初始化时与指定的外部 MCP Server 建立连接；
2. 自动拉取 MCP 服务暴露的工具 Schema，并动态注册到 DSH 统一的 `ctx.tools` 工具运行时中；
3. 会话和模型在调用工具时，调用请求透明地经由 DSH 16 阶段拦截流水线，再由客户端桥转发至真实的 MCP Server。

```
┌─────────────────────────┐
│    大模型 / Agent 循环   │
└────────────┬────────────┘
             │ 调用 mcp__context7__query_docs
┌────────────▼────────────┐
│   DSH ctx.tools 运行时  │ (经过 16 阶段拦截、审批、单调 guard 校验)
└────────────┬────────────┘
             │
┌────────────▼────────────┐
│  dsh-mcp-client 插件桥   │ (管理连接池、序列化协议、超时控制)
└────────────┬────────────┘
             │ Streamable-HTTP / StdIO 管道
┌────────────▼────────────┐
│   外部真实 MCP Server   │ (Python FastMCP, Node SDK, 远程服务)
└─────────────────────────┘
```

---

## 二、工具自动命名空间规范 (Namespace Convention)

为了避免多个外部 MCP 服务提供的同名工具（例如两个服务都提供了 `read_file`）发生命名碰撞，DSH 强制执行**命名空间隔离法则**：

所有被桥接进来的工具，在模型可见层统一重命名为：
```
mcp__<serverName>__<rawToolName>
```

- `<serverName>`：在配置中声明的唯一服务命名标识（如 `context7`, `github`, `database`）；
- `<rawToolName>`：外部 MCP 服务原生定义的工具名（如 `search`, `execute_query`）；
- **双下划线 (`__`)**：固定分隔符，模型识别度极高且符合各大 LLM 的 Function Calling 命名规范。

---

## 三、实战：通过 cordis.patch.yml 装配 MCP 插件

在 DSH profile 的 `cordis.patch.yml` 中，可以通过 `- insert:` 语法声明一个或多个 MCP Client 实例：

### 范例 1：连接远程 HTTP/SSE MCP 服务 (以 Context7 为例)
```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: !!js process.env.CONTEXT7_MCP_URL
        headers: {}
        toolCallTimeoutMs: 60000
        failOnStartupError: false
      disabled: !!js '!process.env.CONTEXT7_MCP_URL'
```

### 范例 2：连接本地 StdIO 子进程 MCP 服务 (以 Python FastMCP 为例)
若本地有一个 Python 编写的 MCP 脚本：
```yaml
- insert:
    - id: mcp-local-tools
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: local_dev
        transport: stdio
        command: 'python'
        args: ['C:/scripts/mcp_server.py']
        env:
          PYTHONIOENCODING: 'utf-8'
        toolCallTimeoutMs: 30000
        failOnStartupError: false
      disabled: false
```

---

## 四、核心配置参数权威释义

| 配置字段 | 类型 | 必填 | 官方语义与生产防坑建议 |
| :--- | :--- | :--- | :--- |
| `serverName` | string | 是 | 服务的命名空间标识。**在同一个 profile 中绝对唯一**，用于构成工具名前缀。 |
| `transport` | string | 是 | 通信传输协议：`streamable-http`（现代 HTTP 串流）、`sse`（Server-Sent Events）、或 `stdio`（本地子进程管道）。 |
| `url` | string | 条件 | 当 transport 为 HTTP/SSE 时必填。建议配合 `!!js process.env.VAR` 从环境变量中安全注入。 |
| `command` | string | 条件 | 当 transport 为 stdio 时必填，指定子进程可执行程序（如 `node`、`python`）。 |
| `args` | string[] | 否 | stdio 子进程的启动参数数组。**严格零 Shell 解释**，不得拼接字符串。 |
| `toolCallTimeoutMs` | number | 否 | 单次工具调用最大超时毫秒数，默认 `60000` (60秒)。防外部服务假死挂起。 |
| `failOnStartupError` | boolean | 否 | **生产极力推荐设为 `false`**！若远程 MCP 临时宕机，设为 false 仅记录警告并跳过工具加载，防止整个 DSH 宿主崩溃无法启动。 |

---

## 五、MCP 工具与单调安全守卫 (Guard) 协同

通过 MCP 引入的外部工具同样完全受 DSH 单调守卫体系管控。插件可通过 `ctx.tools.guard` 对 MCP 工具进行细粒度权限拦截：

```js
export function apply(ctx) {
  ctx.tools.guard((exec) => {
    // 匹配特定 MCP 服务下的高危工具
    if (exec.toolName.startsWith('mcp__database__') && exec.toolName.endsWith('drop_table')) {
      return '安全策略阻断：禁止通过 MCP 执行删库操作';
    }
  });
}
```
