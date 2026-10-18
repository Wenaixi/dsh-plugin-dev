# 会话格式 V4 演进、平滑迁移与语义检查点架构

> 适用范围：DSH v0.2.1+ 架构下历史会话数据升级、Agent Teams 团队事件持久化、无损迁移管道 (`session-format-v3-to-v4`)、语义检查点策略与 SQLite 本地检索集成的开发与维护。
> 核心命题：**Session 格式是 DSH 智能体执行历史与上下文缓存的唯一真源；从 V3 到 V4 的演进不仅拓展了多智能体收件箱、计划模式与目标折叠事件，更通过确定性迁移管道、引用恒等短路转换保全了 Prompt Cache 哈希，配合只在语义边界落盘的检查点策略与原生 SQLite 高速 FTS 检索，实现了性能与数据强一致性的统一。**

---

## 一、为什么需要 Session 格式 V4

DSH 的会话日志底层采用严格基于行分隔的 JSONL（Append-Only）格式记录。随着 DSH 向多智能体协同、自主目标与计划模式演进，原有的 V3 会话格式在表达能力与协议严密性上面临以下核心局限：

1. **缺乏对多智能体团队收件箱的原生支撑**：
   在 Agent Teams 架构中，父智能体向子智能体分发任务、团队成员之间交换信件、以及动态向收件箱插入或拼接消息（如 `agent/inbox/spliced`、`team/member`、`team/message/queued`、`team/message/delivered`、`team/task`），需要一等公民级别的事件类型，而非简陋地伪装在普通文本流中；
2. **缺乏目标驱动与计划模式的快照折叠**：
   自主目标系统产生的 `goal/change` 事件、计划模式产生的 `plan/mode` 事件在 V3 中缺乏规范化的数据模式约束，容易被旧版校验器误判为非法未知事件；
3. **废弃松散的 Generic Plugin 包装，推行 Producer-Owned Source Kinds**：
   V3 广泛使用形如 `{ kind: "plugin", plugin: "..." }` 的包装器，导致消息来源层级冗余、来源所有权模糊。V4 要求消息来源必须是由生产者原生拥有的精确类型（如 `ptc-mode`、`runtime-context`、`compact-checkpoint`），彻底消灭过渡包装；
4. **工具按需延迟加载 (Deferred Tool Schemas)**：
   V4 在请求标头 (`request/header`) 的工具声明中引入了 `deferLoading: true` 字段，允许智能体在庞大工具集中按需激活工具，大幅缩减上下文首包开销；
5. **清理历史废弃语法 (Retired Syntax)**：
   严禁在常规消息内容块中嵌套已废弃的 `tool-result` 独立包装块，严禁无 `ignorable: true` 标记的 `tool/code-dispatch`，杜绝语义歧义。

---

## 二、迁移管道架构：defineSessionFormatMigration

DSH 采用可插拔的格式迁移管道架构，所有格式跃迁均通过 `defineSessionFormatMigration` 进行严格声明：

```text
+---------------------------------------------------------------------------------+
|                       V3 -> V4 迁移管道流水线                                    |
|                                                                                 |
|  [ V3 Session JSONL ]                                                           |
|          |                                                                      |
|          v                                                                      |
|  1. assertReleasedV3Header(header) -----> 标头校验与版本跃迁 (version: 3 -> 4) |
|          |                                                                      |
|          v                                                                      |
|  2. ReleasedV3ToV4Stage 阶段执行                                                |
|     +------------------------------------------------------------------------+  |
|     | a. 密实序号校验 (Dense seq: event.seq === mapping.length)              |  |
|     | b. 重启与中断观测 (observeRestart -> 插入 turn/end { reason: interrupted }) |
|     | c. 未知可忽略事件提升 (namespaceV3OpaqueEvent -> plugin:<type>)          |  |
|     | d. 稠密索引重映射 (remapV3References -> 修正跨事件 seq 引用)           |  |
|     | e. 消息属主源改写 (rewriteV3MessageSource -> 剥离 plugin 外壳)         |  |
|     | f. 内容块命名空间迁移 (migrateV3EventContent -> plugin:<blockType>)    |  |
|     +------------------------------------------------------------------------+  |
|          |                                                                      |
|          v                                                                      |
|  3. finish() 子智能体证据绑定 (回填 subagent/catalog 事件)                      |
|          |                                                                      |
|          v                                                                      |
|  [ V4 Session JSONL (校验 assertReleasedV4Header 与 assertV4RowAdmission) ]     |
+---------------------------------------------------------------------------------+
```

### 1. 标头断言与迁移定义

```typescript
export const sessionFormatV3ToV4 = defineSessionFormatMigration({
  name: "@deepseek-ai/dsh-session-format-v3-to-v4",
  fromVersion: 3,
  toVersion: 4,
  migrateHeader(header) {
    assertReleasedV3Header(header);
    return {
      ...header,
      version: 4
    };
  },
  createStage() {
    throw new SessionFormatUnsupportedMigrationError(
      "V3 catalog migration requires explicit historical child facts, including an empty array for a parent without children"
    );
  },
  validateTargetHeader: assertReleasedV4Header
});
```

### 2. 管道阶段运行细节 (ReleasedV3ToV4Stage)

当父会话需要迁移时，必须通过 `createSessionFormatV3ToV4(children)` 绑定历史上所有子智能体的物理事实。迁移阶段包含以下核心处理：

1. **异常中断探测与补全 (`observeRestart`)**：
   如果会话在回合进行中遭遇非正常终止（例如进程意外退出），下一个事件直接为 `turn/start`，迁移管道会自动在两回合之间注入一个标准的 `turn/end` 事件，携带 `data: { turn: interrupted, reason: { kind: "interrupted" } }`，保全会话回合状态机的对称开闭；
2. **稠密序号重映射 (`remapV3References`)**：
   由于插入了中断事件或回填了事件，原有的绝对事件序号发生位移。管道维护一个 `mapping: number[]` 映射表，对 `command/done`（`sourceEventSeq`）、`compaction/summary`（`shadowedRange` 与 `shadowedSeqs`）、`session/title`（`messageSeqs`）、`image/offload`（`targets.seq`）以及 `surfaceOp` 的区间范围进行原子重算；
3. **来源生产者提升 (`rewritePluginSource`)**：
   将历史 `kind === "plugin"` 的包装解构为精确分类：
   - 改名表映射：`compact` 映射为 `compact-checkpoint`；`tools-code-mode` 与 `tools-ptc` 映射为 `ptc-mode`；`dsh-compaction-basic` 映射为 `compact-basic`；`@deepseek-ai/dsh-system-prompt` 映射为 `runtime-context`（若角色为 system 则为 `system-prompt`）；
   - 官方同名表：如 `goal`、`team-message`、`plan-mode`、`agent-instructions` 等直接保留为自身名字；
   - 社区插件：一律规范化为 `plugin:<plugin_name>`；
4. **回填子智能体目录 (`subagent/catalog`)**：
   在会话的 `finish` 阶段，依据传入的子会话元数据，按创建时间顺序在父会话末尾追加 `subagent/catalog` 事件，使得多智能体拓扑关系在 V4 下完全可溯源。

---

## 三、消息遍历与转换契约 (mapEventMessages)

在 LLM 应用中，保持历史上下文哈希与 Prompt Cache（前缀缓存）一致性是极致降低延迟与成本的关键。如果迁移器在遍历事件时产生哪怕一个无关字段的重排或无谓的浅拷贝，都会破坏上游缓存键。

### 1. 深度安全的恒等遍历器

`mapEventMessages` 是格式迁移中访问第一方消息载荷的权威入口：

```typescript
export function mapEventMessages(
  event: SessionEvent,
  transform: (message: JsonObject) => JsonObject
): SessionEvent {
  const data = event.data;
  if (!isSessionFormatJsonObject(data)) return event;

  // 1. 单消息事件：user/message
  if (event.type === "user/message") {
    const message = transform(data);
    return message === data ? event : { ...event, data: message };
  }

  // 2. 包装消息事件：developer/message, system/message, assistant/message, tool/result
  if (
    event.type === "developer/message" ||
    event.type === "system/message" ||
    event.type === "assistant/message" ||
    event.type === "tool/result"
  ) {
    if (!isSessionFormatJsonObject(data["message"])) {
      throw new SessionFormatError(event.type + " requires a message");
    }
    const message = transform(data["message"]);
    return message === data["message"] ? event : {
      ...event,
      data: { ...data, message }
    };
  }

  // 3. 数组消息事件：agent/inbox/spliced, session/title-llm-request
  const key = event.type === "agent/inbox/spliced"
    ? "inserted"
    : event.type === "session/title-llm-request"
      ? "messages"
      : undefined;

  if (key === undefined) return event;

  const messages = data[key];
  if (!Array.isArray(messages)) {
    throw new SessionFormatError(event.type + " requires message array");
  }

  const mapped = messages.map(transform);

  // 核心守卫：若数组中每一个元素均保持引用恒等，直接返回原始事件对象！
  return mapped.every((message, index) => message === messages[index])
    ? event
    : {
      ...event,
      data: { ...data, [key]: mapped }
    };
}
```

### 2. 恒等快速短路原则 (Identity-Preserving Short-Circuit)

- **引用未变则零重分配**：只有当某条消息的内容或属性确实被改写时，才创建局部新对象；只要未发生改写，直接向上返还原始引用；
- **保全 Prompt Cache**：未发生语义漂移的历史对话轮次在内存中维持不变，序列化输出的字节流与历史哈希完全吻合，保障模型服务端命中古老的前缀缓存。

---

## 四、语义检查点策略 (session-checkpoint-policy)

在传统的应用中，要么每产生一个细微日志就写一次磁盘（造成灾难性的 IO 阻塞与锁竞争），要么仅在内存驻留定期定时刷盘（遭遇断电或崩溃时丢失关键决策上下文）。

DSH 实现了基于语义边界的检查点策略 (`@deepseek-ai/dsh-session-checkpoint-policy`)。该插件注入 `llm`、`sessionPersistence`、`sessions`、`tools` 服务，在以下三个关键语义接缝执行强一致性刷盘：

```text
[ 智能体决策流 ]
       |
       v
1. agent/pre-step --------------------> await ctx.sessions.flush(agent.session)
       |                                (步进前落盘当前轮次状态)
       v
2. llm/stream ------------------------> await ctx.sessions.flush(session)
       |                                (向模型发送流式请求前落盘前缀)
       v                                 * 失败则阻止请求，实施 Fail-Closed
3. tools/execute (顶层工具执行) -------> await ctx.sessions.flush(agent.session)
                                        (执行外部副作用前落盘工具调用参数)
```

### 1. 拦截接缝一：`llm/stream` 前置检查点
在构建下游模型流式请求之前，通过异步生成器包装器延迟流的创建：
```typescript
function afterCheckpoint(ctx, session, next) {
  return (async function* () {
    await ctx.sessions.flush(session);
    yield* next();
  })();
}
```
**安全收益**：确保发送给模型的所有上下文在物理磁盘上已绝对持久化。如果刷盘失败，直接阻断网络调用，杜绝“模型已经开始生成但输入上下文尚未持久化”的脑裂现象。

### 2. 拦截接缝二：`tools/execute` 顶层工具分发前置检查点
只有顶层工具调用（`exec.parent === undefined`）才触发持久化，嵌套子工具复用外部已落盘的调用上下文。
在调用工具实体之前执行刷盘，若此时检测到中止信号（`exec.signal.aborted`），直接短路返回标准的中止结果：
```typescript
{
  content: [{ type: "text", text: "Error: tool call aborted before dispatch" }],
  isError: true,
  error: {
    message: "tool call aborted before dispatch",
    info: { name: "AbortError", code: TOOL_ABORTED_BEFORE_DISPATCH }
  }
}
```

### 3. 拦截接缝三：`agent/pre-step` 步进检查点
在智能体开始消费收件箱或执行下一步之前，确保会话处于最新刷新状态。

---

## 五、SQLite 高速检索接缝 (session-query-sqlite)

在会话规模膨胀至数千事件后，基于内存线性扫描或纯文本 JSONL 遍历的搜索会导致界面明显卡顿。DSH 提供了基于 Node.js 原生 SQLite 的高速全文检索扩展包 (`@deepseek-ai/dsh-session-query-sqlite`)。

### 1. 原生内置引擎架构

该包直接采用 Node.js 内置的 `node:sqlite` 模块中的 `DatabaseSync` 引擎，具有三大优势：
1. **零第三方二进制依赖**：无需安装或编译带有本地 C++ 插件的 `better-sqlite3`，彻底避免多平台构建失败与 Electron ABI 错位问题；
2. **极速同步执行**：在专用线程或检索服务中以亚毫秒级完成复杂布尔查询；
3. **物理安全与所有权防护**：
   - 设定专属应用 ID：`SESSION_QUERY_SQLITE_APPLICATION_ID = 1146308689`；
   - 设定严格派生模式版本：`SESSION_QUERY_SQLITE_SCHEMA_VERSION = 8`；
   - 若发现已存在数据库的 `application_id` 不匹配，直接抛错拦截，防止误删或覆盖用户的其他 SQLite 文件。

### 2. 派生只读表结构

检索服务通过在磁盘或内存（`:memory:`）中维护 8 张核心派生表构建全文检索视图：
- `search_state`：维护增量同步游标与最新处理的会话 seq；
- `persisted_sessions`：会话元数据（ID、标题、父子会话链、创建时间）；
- `persisted_docs`：拆分出的文档切片（包含 turn、step、角色与消息摘要）；
- `persisted_docs_idx` / `persisted_docs_content` / `persisted_docs_data` / `persisted_docs_docsize` / `persisted_docs_config`：由 SQLite FTS（全文检索）虚拟表自动维护的倒排索引与统计数据。

当开发者通过客户端检索会话或通过工具调用 `session_query` 时，引擎优先走本地 SQLite 倒排索引，秒级返回数十万字工程会话中的高相关上下文片段。

---

## 六、工程最佳实践与反模式清单

| 维度 | [错误] 反模式 | [正确] 最佳实践 |
| --- | --- | --- |
| 格式迁移 | 自行编写正则替换 JSONL 文件中的字段名做“就地升级” | 严谨通过 `createSessionFormatV3ToV4` 管道迁移，保全序号稠密性与中断闭环 |
| 缓存保护 | 在会话中间件中对消息对象盲目使用 `{ ...msg }` 展开拷贝 | 遵守 `mapEventMessages` 范式，无变更时严格返回原引用，保全 Prompt Cache |
| 磁盘写入 | 插件私自调用 `fs.writeFile` 频繁落盘中间状态 | 依赖 `session-checkpoint-policy` 在语义边界统一协调 `ctx.sessions.flush` |
| 会话检索 | 手工读取整个 `.jsonl` 文件逐行 `JSON.parse` 并正则搜索 | 使用 `session-query-sqlite` 驱动，利用原生 FTS 索引进行高并发游标分页检索 |

---

## 相关 DSH 源码

```text
packages/session/session-format-v3-to-v4  <-  @deepseek-ai/dsh-session-format-v3-to-v4@0.2.1-rc.2
packages/session/session-checkpoint-policy  <-  @deepseek-ai/dsh-session-checkpoint-policy@0.2.1-rc.2
packages/session/session-query-sqlite     <-  @deepseek-ai/dsh-session-query-sqlite@0.2.1-rc.2
```
