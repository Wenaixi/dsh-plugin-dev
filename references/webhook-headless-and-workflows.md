# DSH Webhook 外部触发、无头模式 (Headless) 与 PTC 长工作流权威指南 (DSH 0.2.0-rc.2)

> **⚠️ 核心定位声明**
> **本文件是辅助开发 DeepSeek Harness (DSH) 插件中 Webhook 自动化集成、Headless 命令行运行与 PTC 工作流的权威技术规范。**
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 一、Webhook 外部自动化触发架构 (`ctx.webhookRuntime`)

在 DSH 中，插件不仅能响应人类在 Web 界面中的输入，还能作为 **自动化 Webhook 接收端**，监听来自 GitHub、GitLab、CI/CD 系统或企业监控告警的外部 HTTP 请求，并自动唤醒 Agent 执行任务。

官方核心包 `@deepseek-ai/dsh-webhook` 提供了核心大动脉服务 `ctx.webhookRuntime`：

```
  外部系统 (GitHub / 告警 Webhook)
               │ HTTP POST 携带 Payload
               ▼
  DSH 宿主 Webhook 服务端
               │ 验证签名 (VerifiedWebhookDelivery)
               ▼
  ctx.webhookRuntime 规则匹配 (WebhookRule)
               │ 命中规则，自动拉起会话
               ▼
  自动创建关联的 Workspace 会话 (Auto-Drive Session)
               │ 指派 Agent 自动分析代码并修复 Issue
               ▼
  任务完成，自动执行回调或提交 Pull Request
```

### 1. 注册编程式 Webhook 规则
插件可以通过 `ctx.webhookRuntime` 注册自己的事件监听与响应规则：

```js
export const inject = ['webhookRuntime'];

export function apply(ctx) {
  // 注册受信任的 Webhook 处理规则
  ctx.webhookRuntime.registerRule({
    id: 'github-issue-handler',
    providerKind: 'github', // 指定提供方类型
    async callback(delivery) {
      // delivery 包含经过签名验证的 payload
      const payload = delivery.payload;
      if (payload.action === 'opened' && payload.issue) {
        // 返回会话初始化参数，系统自动创建并驱动新会话
        return {
          prompt: `处理新提交的 GitHub Issue #${payload.issue.number}: ${payload.issue.title}\n描述: ${payload.issue.body}`,
          workspaceId: delivery.targetWorkspaceId,
          title: `Issue #${payload.issue.number} 自动化处理`
        };
      }
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
# 1. 基础无头执行
dsh --profile headless --task "分析当前仓库代码中的安全漏洞并输出报告"

# 2. 继承已有会话继续无头执行
dsh --profile headless --session-id <session-uuid> --task "继续运行单元测试并修复失败项"

# 3. ndjson 结构化事件流模式（供其他程序管道消费）
dsh --profile headless --json --task "分析提交历史" > events.ndjson
```

---

## 三、PTC 沙箱工作流管道 (`dsh-workflow-ptc`)

当插件涉及多阶段、长时间运行的复杂计算任务时（如全库大型重构、自动化代码迁移），单轮次的简单工具调用容易发生超时或状态丢失。

官方核心包 `@deepseek-ai/dsh-workflow-ptc` 基于沙箱 Node.js PTC (Program-Tool-Calling) 虚拟机提供了工作流编排能力：

### 1. 核心架构与隔离限制
- **工作流状态持久化**：支持长任务的启动（`WorkflowStartRequest`）、子进程双向通信端口（`ChildPort`）与阶段性断点快照；
- **沙箱资源配额限制 (`WorkerLimits`)**：精确限制工作流 Worker 子进程的最大内存占用、CPU 执行时限与文件写入上限，杜绝死循环或 OOM 耗尽主机资源；
- **文件策略继承**：Worker 进程严格继承当前 Calling Session 的文件策略（`read-only` / `workspace-write`），权限绝不越界。
