# DSH 领域存储 (Storage Domain)、持续伪终端 (PTY) 与检查点策略权威指南 (DSH 0.2.0-rc.2)

> **⚠️ 核心定位声明**
> **本文件是辅助开发 DeepSeek Harness (DSH) 插件中领域数据存储、持续交互式终端与会话检查点的权威技术规范。**
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 一、领域数据存储体系 (`ctx.storage.domain`)

在 DSH 中，插件如果需要持久化自己的自定义业务数据（例如爬虫采集的历史记录、用户的自定义规则集、插件私有配置），**绝不应该使用 Node.js 原生 `fs.writeFile` 在任意目录随处散落写入文件**！

官方核心包 `@deepseek-ai/dsh-storage` 与 `@deepseek-ai/dsh-storage-domain` 提供了严格的**三层存储解耦架构**：

```
  业务插件消费方 (Consumer)
          │ 调用 domain.get() / domain.set() (强类型、Zod 模式校验)
          ▼
  领域数据层 ctx.storage.domain (Schema 校验、派发变更事件、多租户命名空间)
          │
          ▼
  存储枢纽 ctx.storage (后端驱动注册表 BackendRegistry)
          │
          ▼
  物理驱动实现 (如 dsh-storage-json，拥有物理落盘与文件 IO)
```

### 1. 核心铁律：业务插件只依赖领域层
- 业务插件**严禁直接碰底层的 StorageBackend 物理驱动**；
- 业务插件必须通过 `ctx.storage.domain` 声明一个带有 Zod 模式校验的领域规范（`DomainSpec`），获得隔离的命名空间表。这保证了无论未来底层驱动迁移到 SQLite、LevelDB 还是云端存储，插件业务代码零改动！

### 2. 声明并使用自定义存储领域实战
```js
import { z } from 'zod';

export const inject = ['storage'];

export function apply(ctx) {
  // 1. 声明数据记录的 Zod Schema
  const BookmarkSchema = z.object({
    title: z.string(),
    url: z.string().url(),
    createdAt: z.number()
  });

  // 2. 向领域存储注册命名空间表
  const bookmarkDomain = ctx.storage.domain.register({
    name: 'bookmarks', // 唯一表名/命名空间
    schema: BookmarkSchema
  });

  // 3. 强类型异步读写操作
  async function saveBookmark(id, data) {
    // 写入时自动执行 Zod 校验，校验失败抛出 DomainError
    await bookmarkDomain.set(id, data);
  }

  async function getBookmark(id) {
    return await bookmarkDomain.get(id);
  }
}
```

---

## 二、持续交互式伪终端体系 (`ctx.terminal`)

普通的 `bash` 或 `pwsh` 工具只能执行一次性命令并在命令退出后返回全部文本。但当插件需要管理长期运行的服务（如本地 Vite 开发服务器、长编译任务、交互式 REPL）时，单次执行原语无法胜任。

官方核心包 `@deepseek-ai/dsh-terminal` 提供了**所有者作用域的持续 PTY 伪终端服务 (`ctx.terminal`)**：

### 1. 持续终端四大核心原语
1. **`spawnTerminal(spec)`**：创建长寿命伪终端进程，支持配置行列尺寸（cols/rows）、初始命令与环境变量；
2. **`read(request)`**：增量游标读取终端输出字符流（内置等待机制与超时）；
3. **`send(request)`**：向正在运行的终端持续写入 `stdin` 输入或发送快捷键（如 `\x03` 代表 Ctrl+C）；
4. **`signal(request)`**：向终端进程组发送标准 POSIX 信号（如 `SIGINT`、`SIGTERM`、`SIGKILL`），实现安全收敛与优雅停机。

---

## 三、语义检查点与崩溃自愈策略 (`session-checkpoint-policy`)

在长时间运行的 Agent 任务中，如果宿主机器意外掉电或被强制终止，系统如何确保数据完整性？

官方核心包 `@deepseek-ai/dsh-session-checkpoint-policy` 在运行时建立了**三道语义检查点防线 (Durability Checkpoints)**：

1. **模型请求前检查点**：在适配器向外部大模型发起 HTTP 流式请求前，系统先将组装完毕的提示词与请求元数据提交至持久化日志；
2. **顶级工具派发前检查点**：在工具定义的主体 `execute` 代码开始执行前，先持久化记录 `tool/call` 事件（分配不可变的 `callSeq`）；
3. **步骤收敛边界检查点**：在每个轮次步（Step）结束时，强制执行 `session/flush`，确保所有派生状态与文件变更落盘固化。

- **自愈保障**：系统重启时，恢复引擎自动回滚到最后一个带有完整边界的检查点，绝不存在半写入造成的会话反序列化破损！
