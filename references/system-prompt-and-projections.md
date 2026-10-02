# DSH 系统提示词动态注入、会话事件流与状态投影 (Projection) 权威指南 (DSH 0.2.0-rc.2)
---

## 一、系统提示词动态编排架构 (`ctx.systemPrompt`)

在 DSH 中，大模型每次发起请求前看到的 System Prompt（系统提示词）并不是写死的单一段落，而是由核心大动脉服务 `ctx.systemPrompt`（所属包 `@deepseek-ai/dsh-system-prompt`）**按优先级权重（Order / Rank）动态收集、过滤并拼装**而成的。

### 1. 注册专属系统提示词片段 (Section)
插件可以通过 `ctx.systemPrompt` 在系统提示词中追加自己的业务引导或规则定义：

```js
export const inject = ['systemPrompt'];

export function apply(ctx) {
  // 注册有序的提示词段落
  ctx.systemPrompt.addSection({
    id: 'my-coding-guidelines', // 段落唯一标识
    order: 40,                  // 排序权重：数字越小越靠前（核心原则约 10~30，业务补充约 40~80）
    content: () => {
      // 支持动态返回文本，例如注入当前时间或动态策略
      return `## 自定义代码规范\n- 严禁硬编码测试密钥\n- 所有模块导出必须包含 JSDoc 注解`;
    }
  });
}
```

### 2. 专家级环绕中间件 (`system-prompt/assemble`)
若需要在提示词最终交付给模型前进行全局拦截、审计或占位符替换，可以监听 `system-prompt/assemble` waterfall 环绕事件：

```js
ctx.waterfall('system-prompt/assemble', async (assembly, next) => {
  // 1. 调用 next() 执行下游收集流程
  const finalAssembly = await next();

  // 2. 对最终组装出的提示词文本进行安全过滤或动态宏替换
  if (finalAssembly.systemText.includes('{{CURRENT_WORKSPACE}}')) {
    finalAssembly.systemText = finalAssembly.systemText.replace(
      '{{CURRENT_WORKSPACE}}',
      process.cwd()
    );
  }

  return finalAssembly;
});
```

---

## 二、会话事件流 (SessionEvent) 仅追加哲学

`ctx.sessions`（所属包 `@deepseek-ai/dsh-session`）是 DSH 状态的**绝对唯一真源**：

### 1. 核心铁律：仅追加日志 (Append-Only Log)
- 所有会话历史（用户消息、模型回复、工具调用、审批记录、计划变更）均作为不可变的 `SessionEvent` 顺序落盘（JSONL 格式）；
- **严禁任何插件通过 Node.js 原生 `fs` 直接修改底层 `.jsonl` 文件**！直接修改会破坏会话序号指纹（`SessionSeq`）与 SHA-256 结构校验，导致会话无法反序列化崩溃；
- 任何状态变化（如取消、编辑、修剪），必须通过追加新的事件（带 `surfaceOp: 'replace'` 或专属事件）来合法表达。

---

## 三、状态投影体系 (`ctx.sessionProjections`) 实战

既然所有数据都是离散的事件，那么业务层如何知道“当前会话还有哪些未完成的 Todo”、“当前计划状态是什么”？

DSH 官方引入了基于事件溯源（Event Sourcing）的 **状态投影引擎 (`ctx.sessionProjections`)**：

```
  离散的仅追加事件流 (SessionEvents)
  [user/message] ──► [tool/call] ──► [todo/write] ──► [tool/result]
                                           │
                                 经过纯函数折叠器 (Pure Fold)
                                           ▼
                          计算出实时的业务状态快照 (Snapshot)
                          { todos: [{ id: 1, text: '...', status: 'done' }] }
```

### 1. 编写自定义投影单元 (Projection Definition)
插件可以向系统注册自己的投影单元，随会话事件流自动向前驱动（Eager Fold）：

```js
export function apply(ctx) {
  ctx.sessionProjections.register({
    id: 'my-task-tracker',
    // 1. 定义初始状态
    initial: () => ({ completedTasks: 0, activeTasks: [] }),
    // 2. 纯函数折叠器：遇到特定事件时计算下一时刻的状态（绝不产生副作用）
    fold: (state, event) => {
      if (event.type === 'tool/result' && event.data?.toolName === 'task_complete') {
        return {
          ...state,
          completedTasks: state.completedTasks + 1
        };
      }
      return state;
    },
    // 3. （可选）将状态转换为供前端消费的精简视图
    toClientView: (state) => ({ count: state.completedTasks })
  });
}
```
- 框架自动负责每会话的水位线（Watermark）缓存与变更通知，开发者无需手动轮询！

---

## 四、工作区变更观察与事件联动 (`workspace-changes`)

官方核心包 `@deepseek-ai/dsh-workspace-changes` 为插件提供了感知模型写文件行为的能力：

### 1. 轮次变更快照
在每个 Agent 轮次（Turn）结束时，系统会自动执行 Git Diff 对比，并生成结构化的变更摘要：
- `WorkspaceChanges`：包含新增、修改、删除的文件清单；
- `WorkspaceFileDiff`：包含具体文件的修改 Diff 块（Hunks）。

### 2. 插件自动化响应实战
插件可以通过监听轮次完成或工作区变更事件，实现自动格式化或安全审计：

```js
export function apply(ctx) {
  ctx.on('agent/turn-end', async ({ sessionId, turnId }) => {
    // 查询该轮次造成的文件变动
    const changes = await ctx.workspaceChanges?.getTurnSummary(sessionId, turnId);
    if (changes && changes.files.length > 0) {
      ctx.logger('audit').info(`轮次 ${turnId} 修改了 ${changes.files.length} 个文件:`, changes.files.map(f => f.path));
    }
  });
}
```
