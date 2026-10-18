# DSH 领域存储 (Storage Domain)、持续伪终端 (PTY) 与检查点策略权威指南
---

## 一、领域数据存储体系 (ctx.storage.domain)

在 DSH 中，插件如果需要持久化自己的自定义业务数据（例如爬虫采集的历史记录、用户的自定义规则集、插件私有配置），**绝不应该使用 Node.js 原生 fs.writeFile 在任意目录随处散落写入文件**！

官方核心包 `@deepseek-ai/dsh-storage` 与 `@deepseek-ai/dsh-storage-domain` 提供了严格的**三层存储解耦架构**：

```
  业务插件消费方 (Consumer)
          │ 调用 domain.table('t').put/get/delete/update (强类型)
          ▼
  领域数据层 ctx.storageDomain.open(spec) (加载时校验、派发变更事件、按名隔离)
          │
          ▼
  存储枢纽 ctx.storage (后端驱动注册表 BackendRegistry)
          │
          ▼
  物理驱动实现 (如 dsh-storage-json，拥有物理落盘与文件 IO)
```

### 1. 核心铁律：业务插件只依赖领域层
- 业务插件**严禁直接碰底层的 StorageBackend 物理驱动**；
- 业务插件必须先用 `defineDomain({ name, version, tables: { t: domainTable(schema) }, global? })` 声明领域规范（记录模式用 zod），再 `await ctx.storageDomain.open(spec)` 打开，拿到 `domain.table(name)` 表句柄；
- **写入路径不做 zod 校验**：校验只在 open 加载历史时进行，失败抛 `DomainError invalid-record`（可配 `invalidRecords: 'backup-and-skip'` 备份跳过）；写路径错误是 `missing-key` / `closed`；
- `ctx.storage.domain` 只是 hub 的 form 访问器（返回 DomainFacility 实例，供挂载与诊断），业务消费走 `ctx.storageDomain`。这保证了无论未来底层驱动迁移到 SQLite、LevelDB 还是云端存储，插件业务代码零改动。

### 2. 声明并使用自定义存储领域实战
```js
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const inject = ['storageDomain']

export async function apply(ctx) {
  // 1. 声明数据记录的 Zod Schema
  const BookmarkSchema = z.object({
    title: z.string(),
    url: z.string().url(),
    createdAt: z.number()
  })

  // 2. 声明领域规范并打开（版本号非负整数；表记录模式用 zod）
  const bookmarks = defineDomain({
    name: 'bookmarks',
    version: 1,
    tables: { bookmarks: domainTable(BookmarkSchema) }
  })

  // 3. 打开领域（由调用方持有并负责关闭），拿到表句柄
  const bookmarkDomain = await ctx.storageDomain.open(bookmarks)

  // 4. 强类型读写操作
  async function saveBookmark(id, data) {
    await bookmarkDomain.table('bookmarks').put(id, data)
  }

  async function getBookmark(id) {
    return await bookmarkDomain.table('bookmarks').get(id)
  }
}
```

---

## 二、SQLite 会话查询大动脉 (session-query-sqlite)

在长周期 Agent 任务中，应用程序需要对海量的历史会话日志进行检索、过滤和上下文回溯。官方提供了 `ctx.sessionQuery` 统一查询服务：
- **抽象 Seam**：`@deepseek-ai/dsh-session-query`；
- **官方默认实现**：`@deepseek-ai/dsh-session-query-sqlite`。

### 1. 核心设计哲学
1. **内存优先统一逻辑语料 (Live-Preferred Logical Corpus)**：
   读取会话历史时，内存中处于活跃状态的 `ctx.sessions` 是权威真源并优先解析；未加载进内存的历史记录由持久化层（`ctx.sessionPersistence`，如 JSONL）填补。若内存头与磁盘头的不可变元数据发生冲突，系统将 fail-closed 报错并拒绝错误合并；
2. **深拷贝解耦与无观察泄露 (Detached Results)**：
   所有查询 API（`listEvents`、`readSurface`、`traceEvent`）返回的对象均为深拷贝克隆，不保留对底层活动实例的任何引用，杜绝上层业务逻辑意外污染会话底层状态；
3. **SQLite FTS5 全文检索引擎**：
   在 `@deepseek-ai/dsh-session-query-sqlite` 中，系统利用 SQLite 的 FTS5 倒排索引扩展，对五大表面事件（用户输入、模型响应、工具结果）进行高性能分词，支持毫秒级全文检索与 BM25 相关度排序。

---

## 三、持续交互式伪终端体系 (ctx.terminals)

普通的命令行工具只能执行一次性命令并在命令退出后返回全部文本。但当插件需要管理长期运行的服务（如本地 Vite 开发服务器、长编译任务、交互式 REPL）时，单次执行原语无法胜任。

官方核心包 `@deepseek-ai/dsh-terminal` 提供了**所有者作用域的持续 PTY 伪终端服务 (`ctx.terminals`，挂载键为复数)**：

### 1. 持续终端核心原语
1. **`spawn(owner, { type, name?, cwd? }, signal)`**：创建长寿命伪终端会话，返回 `{ sessionId, name?, type, pid?, status, motd? }` 快照；真正的后台进程由已注册的后端（如 `dsh-terminal-bash`）承载；
2. **`read(owner, id, { offset?, count? })`**：同步返回一段最近端 scrollback 的分页快照（offset 为相对最新内容的**非负**偏移：0 即最新、越大越深入历史，传负值会抛错；count 为行数上限，默认 500），无等待、无超时，不阻塞；
3. **`startSend(owner, id, { text, submit, signal? })`**：向正在运行的终端写入 `stdin`（`text + (submit ? "\r" : "")` 拼成，不写 `\x03` 模拟中断），返回 `{ done, ... }` 等待句柄；同一会话同一时刻只允许一个活动的 send，并发调用抛 `SEND_ACTIVE`；中断/取消经 `signal(…, 'SIGINT')` 对前台进程组投递真实信号；
4. **`signal(owner, id, signal)`**：向终端进程组发送标准 POSIX 信号（如 `SIGINT`、`SIGTERM`、`SIGKILL`），实现安全收敛与优雅停机；另有 `kill(owner, id, reason?)` 关闭会话、`list(owner)` 列出本所有者可见会话。

---

## 四、语义检查点与崩溃自愈策略 (session-checkpoint-policy)

在长时间运行的 Agent 任务中，如果宿主机器意外掉电或被强制终止，系统如何确保数据完整性？

官方核心包 `@deepseek-ai/dsh-session-checkpoint-policy` 在运行时建立了**三道语义检查点防线 (Durability Checkpoints)**：

1. **模型请求前检查点**：在适配器向外部大模型发起 HTTP 流式请求前，系统先将组装完毕的提示词与请求元数据提交至持久化日志；
2. **顶级工具派发前检查点**：在工具定义的主体 `execute` 代码开始执行前，先持久化记录 `tool/call` 事件（分配不可变的 `callSeq`）；
3. **步骤开始前检查点**：挂在 `agent/pre-step` 钩子上（每步开始前），强制执行 `session/flush`，确保上一步派生状态与文件变更在进入下一步前落盘固化。

### 自愈保障与裂隙修复机制
- **Fail-Closed 闭环**：检查点落盘写入失败时直接熔断，模型适配器或工具主体绝不执行；
- **截断 torn tail 并重放 recovered tail**：扫描日志时把末尾未闭合的记录视作撕裂尾部，先截断到最后一个完整提交点（`tornTruncateTo`），再在首次追加时重放已恢复但尚未提交的 `recoveredTail`，保证追加始终连续；
- **日志头损坏坚决报错**：若首行不是合法 JSON 或不属于本会话格式，直接拒绝打开并报错（corrupt session log），绝不静默丢弃。

---

## 五、挂钟定时 (ctx.schedule) 与后台任务 (ctx.jobs)

### 1. ctx.schedule（@deepseek-ai/dsh-schedule）
- 模型侧通过工具 `schedule_create` / `schedule_list` / `schedule_delete` / `schedule_update` 操作，业务插件消费同一服务；
- 规则持久化在 storage domain `"schedule"`（表 `tasks`，`defineDomain` 声明，加载即校验）；
- 投递依赖 `session/flush` 确认：任务创建/编辑即时落盘于 schedule 的 storage domain（`table("tasks").put`）；仅**投递与送达回执**在 `ctx.sessions.flush()` 确认后才提交；
- 固定频率规则（every）最小间隔 60 秒（`MIN_EVERY_INTERVAL_SECONDS`）。

### 2. ctx.jobs（@deepseek-ai/dsh-jobs + dsh-jobs-local）
- `dsh-jobs` 是抽象注册表接缝（抽象类 `JobRegistry`，直接构造抛错），实现包为 `dsh-jobs-local`；注册名 `jobs`；
- 模型侧工具由 `dsh-tool-jobs` 注册：`job_output` / `job_list` / `job_kill`。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.5
packages/jobs/jobs  <-  @deepseek-ai/dsh-jobs@0.2.1-rc.2
packages/jobs/jobs-local  <-  @deepseek-ai/dsh-jobs-local@0.2.1-rc.2
packages/schedule/schedule  <-  @deepseek-ai/dsh-schedule@0.2.1-rc.2
packages/session/session-checkpoint-policy  <-  @deepseek-ai/dsh-session-checkpoint-policy@0.2.1-rc.2
packages/session-query/session-query  <-  @deepseek-ai/dsh-session-query@0.2.1-rc.2
packages/session-query/session-query-sqlite  <-  @deepseek-ai/dsh-session-query-sqlite@0.2.1-rc.2
packages/storage/storage  <-  @deepseek-ai/dsh-storage@0.2.1-rc.2
packages/storage/storage-domain  <-  @deepseek-ai/dsh-storage-domain@0.2.1-rc.2
packages/storage/storage-json  <-  @deepseek-ai/dsh-storage-json@0.2.1-rc.2
packages/terminal/terminal  <-  @deepseek-ai/dsh-terminal@0.2.1-rc.2
packages/terminal/terminal-bash  <-  @deepseek-ai/dsh-terminal-bash@0.2.1-rc.2
packages/jobs/tool-jobs  <-  @deepseek-ai/dsh-tool-jobs@0.2.1-rc.2
```
