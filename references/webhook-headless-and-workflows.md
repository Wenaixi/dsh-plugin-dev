# DSH Webhook 外部触发、无头模式 (Headless) 与 PTC 长工作流权威指南
---

## 一、Webhook 外部自动化触发架构 (`ctx.webhookRuntime`)

在 DSH 中，插件不仅能响应人类在 Web 界面中的输入，还能作为 **自动化 Webhook 接收端**，监听来自 GitHub、GitLab、CI/CD 系统或企业监控告警的外部 HTTP 请求，并自动唤醒 Agent 执行任务。

官方核心包 `@deepseek-ai/dsh-webhook` 提供核心大动脉服务 `ctx.webhookRuntime`（**它本身不监听 HTTP**；HTTP 入口与签名校验在适配器包 `@deepseek-ai/dsh-webhook-github`）：

```
  外部系统 (GitHub / 告警 Webhook)
               │ HTTP POST 携带 Payload
               ▼
  适配器 (dsh-webhook-github)
               │ 验证签名（x-hub-signature-256 等）
               ▼
  ctx.webhookRuntime 规则匹配 (WebhookRule)
               │ 命中规则，自动拉起会话
               ▼
  自动创建关联的 Workspace 会话 (Auto-Drive Session)
               │ 指派 Agent 自动分析代码并修复 Issue
               ▼
  HTTP 202 立即返回（fire-and-forget：无完成回调、无结果回报、崩溃即丢）
```

### 1. 注册编程式 Webhook 规则
插件可以通过 `ctx.webhookRuntime` 注册自己的事件监听与响应规则：

```js
export const inject = ['webhookRuntime'];

export function apply(ctx) {
  // 注册受信任的 Webhook 处理规则（方法名 register，不是 registerRule）
  ctx.webhookRuntime.register({
    id: 'github-issue-handler',
    kind: 'github', // 提供方类型字段名是 kind，不是 providerKind
    async run(delivery, signal) {
      // delivery 快照字段：kind / source / deliveryId / event{name,payload} / receivedAt；第二参是 AbortSignal
      const payload = delivery.event.payload;
      if (payload.action === 'opened' && payload.issue) {
        // 返回会话初始化参数即创建 root Session 并 followup；返回 null 表示不创建
        return {
          workspacePath: 'C:/absolute/path/to/repo', // 必需且必须是绝对路径
          title: `Issue #${payload.issue.number} 自动化处理`,
          prompt: `处理新提交的 GitHub Issue #${payload.issue.number}: ${payload.issue.title}\n描述: ${payload.issue.body}`,
          agentPreset: 'standard',      // 需能被 ctx.agentPresets 解析
          permissionPreset: 'default'   // 需能被 ctx.permissionPresets 解析
        };
      }
      return null;
    }
  });
}
```

---

## 二、Headless 无头纯命令行模式 (`dsh-headless`)

在持续集成 (CI/CD)、服务器自动化定时任务或批量基准测试中，往往**不需要启动浏览器前端和 Web 静态服务器**。

官方核心包 `@deepseek-ai/dsh-headless` 提供了专门的单次执行无头驱动器（Headless Runner）：

### 1. 无头运行核心机制
- 纯基于 `dsh-base` 启动，剥离所有 HTTP 路由、Web 服务器与浏览器端插件；
- 通过命令行参数直接向 Agent 派发任务；
- **双流分离设计**：将大模型的思考过程（Reasoning Stream）输出到 `stderr`，将最终的助手回答文本输出到 `stdout`；
- 任务达成稳定状态（Quiescence）后自动刷新会话并退出进程，返回状态码 0；任务失败返回非 0。非常适合直接嵌入 Shell 脚本与 GitHub Actions 流水线！

### 2. 常用命令行与结构化输出
```bash
# 1. 基础无头执行（任务是位置参数，不是 --task）
dsh --profile headless "分析当前仓库代码中的安全漏洞并输出报告"

# 2. 继承已有会话继续无头执行（未知 session id 直接失败退出 1）
dsh --profile headless --session-id <session-uuid> "继续运行单元测试并修复失败项"

# 3. ndjson 结构化事件流模式（含 session/final/status/text/thinking/tool_call/tool_result/error）
dsh --profile headless --json "分析提交历史" > events.ndjson
```

---

## 三、PTC 沙箱工作流管道 (`dsh-workflow-ptc`)

当插件涉及多阶段、长时间运行的复杂计算任务时（如全库大型重构、自动化代码迁移），单轮次的简单工具调用容易发生超时或状态丢失。

服务是 `ctx.workflowEngine`（@deepseek-ai/dsh-workflow），执行引擎是 `@deepseek-ai/dsh-workflow-ptc`（PtcWorkflowEngine）；PTC 是基于沙箱 Node 进程的执行底座（官方未给缩写展开，无 Program-Tool-Calling 全称）：

### 1. 核心架构与隔离限制
- **工作流状态持久化**：支持的编排原语：agent/parallel/pipeline/phase/log/args 六个脚本 hooks；**无 ChildPort、无断点快照**——工作流不检查点（README「No journaling or resume」），进程重启无法续跑；
- **进程侧配额（Node PTC 提供方）**：maxOldGenerationSizeMb(512)/maxOutputBytes(64MB)/maxPendingCalls(128)/timeoutMs(120s, max 600s)；引擎侧是 maxConcurrentAgents/maxTotalAgents/maxItemsPerCall/syncTimeoutMs 的协作式计数。**无 CPU 执行时限（timeout 不是 CPU meter）、无文件写入上限**（配额是协作式非宿主强制）；
- **文件策略继承**：Worker 按 Calling Session 解析出的文件策略执行（`read-only` / `workspace-write`，workflow-ptc 用 sandboxPolicy.resolve({session})）。注意：VM 不是安全边界——进入 Node 后 Node API 仍可用（受所选 OS 文件策略限制），**网络不受文件策略限制**。
