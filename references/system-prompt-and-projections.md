# DSH 系统提示词动态注入、会话事件流与状态投影参考指南
---

## 一、系统提示词动态编排架构 (`ctx.systemPrompt`)

在 DSH 中，大模型每次发起请求前看到的 System Prompt（系统提示词）并不是写死的单一段落，而是由核心大动脉服务 `ctx.systemPrompt`（所属包 `@deepseek-ai/dsh-system-prompt`）**按优先级权重（Order / Rank）动态收集、过滤并拼装**而成的。

### 1. 注册专属系统提示词片段 (Section)
插件可以通过 `ctx.systemPrompt` 在系统提示词中追加自己的业务引导或规则定义：

```js
export const inject = ['systemPrompt'];

export function apply(ctx) {
  // 注册有序的提示词段落
  ctx.systemPrompt.section({
    name: 'my-coding-guidelines',       // 段落名（名称唯一，不是 id）
    order: 700,                         // order 升序、数字越小越靠前；仓库核心槽位从 -1000 到 10200 分布（含 800 PTC_ONLY、5000 TOOLS_SDK、9000 DELIVERABLE_FILE_REFERENCES、10000/10100/10200），业务插件宜取 > 600 避开
    text: () => {
      // 支持动态返回文本（text 可以是字符串或函数）
      return `## 自定义代码规范\n- 严禁硬编码测试密钥\n- 所有模块导出必须包含 JSDoc 注解`;
    }
  });
}
```

### 2. 专家级环绕中间件 (`system-prompt/assemble`)

> 提示：真实事件是 `system-prompt/assemble`（waterfall，签名 (assembly, context, next)）。轮次结束的 agent 生命周期事件是 `agent/turn-stopping`（载荷 { agent, turn, signal }）；`turn/end` 是会话事件（载荷 { turn, reason }），可经 `ctx.on('session/event')` 过滤后使用。
若需要在提示词最终交付给模型前进行全局拦截、审计或占位符替换，可以监听 `system-prompt/assemble` waterfall 环绕事件：

```js
ctx.on('system-prompt/assemble', async (assembly, context, next) => {
  // 注册监听用 ctx.on（ctx.waterfall 是派发方法，不是注册方法）；签名是 (assembly, context, next)
  const finalAssembly = await next();

  // 2. 对最终组装出的段落做过滤或替换：assembly 是 { sections, contexts, tools, variables }，
  //    没有 systemText 字段；{{变量}} 插值由 renderPrompt 阶段统一处理，变量名须匹配 ^[a-z][a-z0-9_]*$
  //    （大写占位符如 {{CURRENT_WORKSPACE}} 会抛 malformed prompt variable reference，应注册小写变量）
  const section = finalAssembly.sections.find(s => s.name === 'my-coding-guidelines');
  if (section) section.text = section.text.replace('{{cwd}}', process.cwd());

  return finalAssembly;
});
```

---

## 二、会话事件流 (SessionEvent) 仅追加哲学

`ctx.sessions`（所属包 `@deepseek-ai/dsh-session`）是 DSH 状态的**绝对唯一真源**：

### 1. 核心铁律：仅追加日志 (Append-Only Log)
- 所有会话历史（用户消息、模型回复、工具调用、审批记录、计划变更）均作为不可变的 `SessionEvent` 顺序落盘（JSONL 格式）；
- **严禁任何插件通过 Node.js 原生 `fs` 直接修改底层 `.jsonl` 文件**！直接修改会破坏事件 seq 的连续性（`session event seq X is not contiguous`）、首行 header 结构与格式版本校验（`corrupt session log`），并可能引入未知事件类型而被拒绝重建（会话日志本身没有 SHA-256 完整性校验）；
- 任何状态变化（如取消、编辑、修剪），必须通过追加新的事件（带 `surfaceOp` 的合法 replace 形状 `{ op: 'replace', startSeq, endSeq }`（裸字符串 `'replace'` 会被当作无效 replace 抛错）或专属事件）来合法表达。

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
    stateSchema: myStateSchema, // 必需：zod schema 校验 state
    stateVersion: 1,             // 必需：非负整数，升级需递增
    key: 'my-task-tracker',      // 注意字段名是 key，不是 id
    // 1. 定义初始状态（签名是 (header, inheritedEventCount) => state）
    init: () => ({ completedTasks: 0, activeTasks: [] }),
    // 2. 纯折叠器：遇到特定事件时计算下一时刻的状态（绝不产生副作用；字段名是 apply，不是 fold）
    apply: (state, event) => {
      if (event.type === 'tool/result' && event.data?.toolName === 'task_complete') {
        return { ...state, completedTasks: state.completedTasks + 1 };
      }
      return state;
    },
    // 3. （可选）将状态转换为供前端消费的精简视图（字段名是 wire：{ viewSchema, view }，不是 toClientView）
    wire: { viewSchema: myViewSchema, view: (state) => ({ count: state.completedTasks }) }
  });
}
```
- 框架自动负责每会话的水位线（Watermark）缓存与变更通知，开发者无需手动轮询！

---

## 四、工作区变更观察与事件联动 (`workspace-changes`)

官方核心包 `@deepseek-ai/dsh-workspace-changes` 为插件提供了感知模型写文件行为的能力：

### 1. 轮次变更快照
在每个 Agent 轮次（Turn）结束时，系统会自动执行 Git Diff 对比，并生成结构化的变更摘要：
- `WorkspaceChangesSummary`（字段 turn/cwd/files/total/added/deleted/snapshot，文件项类型 `WorkspaceChangedFile`）：包含新增、修改、删除的文件清单；
- `WorkspaceFileDiff`：包含具体文件的修改 Diff 块（Hunks）。

### 2. 插件自动化响应实战
插件可以通过监听轮次完成或工作区变更事件，实现自动格式化或安全审计：

```js
export function apply(ctx) {
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    // 该轮次工作区变动经 workspace/changes 会话事件落盘后，用 summary(sessionId, seq) 读取
    const seq = /* 那次 workspace/changes 事件的 seq（从会话事件流捕获） */ 0;
    const changes = await ctx.workspaceChanges?.summary(agent.session.id, seq);
    if (changes && changes.files.length > 0) {
      ctx.logger('audit').info(`轮次修改了 ${changes.files.length} 个文件:`, changes.files.map(f => f.path));
    }
  });
}
```
