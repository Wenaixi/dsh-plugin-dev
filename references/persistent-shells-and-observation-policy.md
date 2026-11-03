# 持续伪终端 (PTY) 与强一致文件观察策略守卫

> 适用范围：DSH v0.2.1+ 架构下长驻终端状态保持 (`tool-pwsh-persistent` / `tool-bash-persistent`)、文件写前强观察守卫 (`dsh-fs-observation-policy`) 以及 Windows 原生 DACL 沙箱隔离 (`dsh-sandbox-windows-acl`) 的机制剖析与集成。
> 核心命题：**自动化智能体在执行复杂软件工程任务时，一次性短进程会彻底丢失工作目录与环境变量上下文，而盲目的文件覆写会产生灾难性的代码幻觉与破坏；DSH 通过长驻 PTY 会话保全环境状态并支持任务超时后台晋升，配合基于 WeakMap 的强一致文件观察策略守卫（未读即写坚决阻断），以及基于 Win32 原生 DACL 的底层沙箱，构建了坚不可摧的工程执行防线。**

---

## 一、持久化 Shell 机制：长驻 PTY 会话管理

传统的智能体终端工具通常基于单次短生命周期的子进程（如 `child_process.exec("pwsh -Command ...")` 或 `bash -c ...`）。这种模式存在严重的工程缺陷：
- **状态归零**：每次执行 `cd <dir>` 或激活虚拟环境（如 `source .venv/bin/activate`），进程退出后状态即刻销毁，下一轮命令又回到初始根目录；
- **初始化性能损耗**：PowerShell 等重量级解释器冷启动耗时数百毫秒至数秒，高频调用造成严重卡顿；
- **交互受限**：无法处理需要维持标准输入输出连接的长任务或流式输出。

DSH 引入了面向智能体的持久化伪终端工具集：面向 Windows 环境的 `@deepseek-ai/dsh-tool-pwsh-persistent` 与面向 POSIX/Linux 环境的 `@deepseek-ai/dsh-tool-bash-persistent`。它们直接运行在底层 PTY 接缝 (PTY Seam) 之上。

```text
+-----------------------------------------------------------------------------------+
|                           Agent Session (属主生命周期)                            |
|                                                                                   |
|  +--------------------+        +-------------------------+        +------------+  |
|  |     Agent Loop     | ---->  |   tool-pwsh-persistent  | ---->  | PTY Seam   |  |
|  +--------------------+        +-------------------------+        +------------+  |
|            ^                                |                           |         |
|            |                                v                           v         |
|            |                     [ 命令信标包裹与转义 ]           [ 长驻进程 ]    |
|            |                     - START Nonce 标记              - 保留 $PWD / cd |
|            |                     - Invoke-Expression             - 保留环境变量   |
|            |                     - END Nonce + ExitCode          - 保留 Shell 函数|
|            |                                |                           |         |
|            | 结果提取与截断                 v                           v         |
|            +------------------- [ 轮询/流式管道读取 ] <--------- [ 终端输出流 ]   |
|                                 - 提取精确 ExitCode                               |
|                                 - maybeTruncate 保护                              |
|                                 - 超时则晋升为后台 Job                            |
+-----------------------------------------------------------------------------------+
```

### 1. 状态保全能力

长驻 Shell 在整个智能体生命周期内保持同一进程：
- **工作目录保全**：执行 `cd packages/foo` 后，后续命令直接在该工作目录下执行；
- **环境变量与函数**：导出的环境变量（如 PowerShell 的 `$env:NODE_ENV = "test"` 或 Bash 的 `export FOO=bar`）、定义的辅助函数在会话内全局生效；
- **环境隔离**：不同智能体或子会话之间拥有完全隔离的 PTY 实例，互不串扰。

---

## 二、命令封套协议与退出码提取

由于 PTY 是一个持续开放的字符流设备，无法简单依靠进程退出事件来判断单次命令是否结束。DSH 设计了一套基于随机 Nonce 的命令封套协议。

### 1. PowerShell 命令包裹器实现

以 `tool-pwsh-persistent` 为例，每次执行命令前，系统生成一组唯一的随机标记并对输入文本实施安全转义：

```typescript
function markers() {
  const nonce = randomUUID();
  return {
    start: `__DSH_PERSISTENT_PWSH_START_${nonce}__`,
    end: `__DSH_PERSISTENT_PWSH_END_${nonce}:`
  };
}

/**
 * 将命令内容转义以便嵌入双引号包裹的执行封套
 * 优先转义反引号，防止二次逃逸；转义 $ 符号，防止提早变量展开
 */
function quoteForPwsh(value: string): string {
  return value
    .replaceAll("`", "``")
    .replaceAll('"', '`"')
    .replaceAll("$", "`$")
    .replaceAll("\r", "")
    .replaceAll("\n", "`n")
    .replaceAll("\x1B", "`e");
}

function wrapCommand(command: string, marker: ReturnType<typeof markers>): string {
  const body = quoteForPwsh(command);
  return `Write-Output '${marker.start}'; $LASTEXITCODE = $null; $__s = 1; try { Invoke-Expression "${body}"; $__ok = $? } catch { $__ok = $false }; if ($null -ne $LASTEXITCODE) { $__s = [int]$LASTEXITCODE } else { $__s = if ($__ok) { 0 } else { 1 } }; Write-Output ('${marker.end}' + $__s)`;
}
```

### 2. 输出解构与退出状态判定

执行引擎向 PTY 写入包裹后的单行文本后，以 25ms 间隔轮询终端缓冲区：
1. 定位 `marker.start` 与 `marker.end` 的位置，精准截取命令实际输出，滤除命令回显；
2. 从 `marker.end` 后缀中解析数字状态码（`status`），严格映射为工具返回的 `exitCode`；
3. 命令失败时保证 `exitCode !== 0`，供模型判断并触发自愈策略。

---

## 三、输出截断防护、超时挂起与后台任务晋升

### 1. 输出截断防护 (Context Overflow Protection)

终端命令可能会意外产生数万行的庞大输出（如全量日志倾泻或全库构建输出）。无节制地将这些内容送入模型会直接挤爆上下文窗口。

`tool-pwsh-persistent` 与 `tool-bash-persistent` 实施了双重截断保护：
- **安全边界截断 (`maybeTruncate`)**：利用 `truncateWithoutSplittingSurrogatePair` 确保在多字节字符（如 CJK）安全边界处切断，避免产生乱码；
- **指引性截断附注 (`TRUNCATED_MESSAGE`)**：
  ```markdown
  <response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with Select-String in order to find the line numbers of what you are looking for.</NOTE>
  ```
  （Bash 版本对应指引使用 `grep -n` 进行行号定位）；
- **终端回滚溢出告警 (`LOST_PREFIX_MESSAGE`)**：当输出超过终端原生回滚上限（`1000` 行）时，头部内容被硬件流丢弃，工具自动前置注入告警提示，告知模型头部日志已遗失。

### 2. 超时挂起与后台任务晋升 (Job Promotion)

当持久化 Shell 中运行的命令超过指定超时时间（`timeoutMs`）时，DSH **绝不直接杀死底层进程**（因为进程中可能正在执行重要的编译或数据库迁移）：
1. **自动提升为后台 Job**：工具立即脱离前台阻塞等待，将当前正在运行的命令封装为异步 Job 实例，并分配全局 `jobId`；
2. **非阻塞响应**：向模型返回 `kind: "promoted"`，附带已捕获的初步输出和 `jobId`；
3. **后续协同**：模型可以继续执行其他独立工具，后续通过 `job_output(job_id, wait: true)` 收集最终输出，或在必要时通过 `job_kill` 主动终止。

### 3. Shell Reset 自愈机制

当 PTY 遭遇极端不可逆故障（如进程异常退出、管道 Broken Pipe 或终端状态彻底紊乱）时，执行器自动丢弃受损 PTY 句柄，重新孵化全新 Shell，并向模型返回 `SHELL_RESET_MESSAGE`：
> *"The persistent pwsh shell was reset; the next pwsh call starts from the workspace with a fresh current directory and environment."*
指导模型从洁净的工作区重新建立上下文。

---

## 四、文件观察策略守卫 (dsh-fs-observation-policy)

在复杂的代码重构或多文件协同中，智能体容易犯下的严重错误是**凭空臆测文件内容并直接调用写入或编辑工具**。如果文件已被外部修改或存在未注意的细节，直接盲写将造成致命的代码覆盖（Clobber）。

DSH 实现了基于微内核事件监听的强一致文件观察策略守卫 (`@deepseek-ai/dsh-fs-observation-policy`)。

> **当前版本默认关闭**：`dsh-base` 以 `disabled: true` 交付该行，以下机制仅在 profile 的 `cordis.patch.yml` 中显式改回 `disabled: false` 后生效；默认 `write` / `edit` 不要求先读。

### 1. 核心架构与 ObservedStateGate

该插件不向外暴露多余的公开服务，仅通过纯事件监听器接入文件系统生命周期：

```typescript
export class ObservedStateGate {
  /**
   * 弱引用属主映射：Session -> Map<TargetKey, Observation>
   * 当会话销毁或被垃圾回收时，其关联的所有观察状态自动释放，零内存泄漏
   */
  private observed = new WeakMap<Session, Map<string, Observation>>();

  private owner(actor: ToolExecutionActor): Session | undefined {
    return actor?.agent?.session;
  }

  get(owner: Session, targetKey: string): Observation | undefined {
    return this.observed.get(owner)?.get(targetKey);
  }

  set(owner: Session, targetKey: string, observation: Observation): void {
    let byTarget = this.observed.get(owner);
    if (!byTarget) {
      byTarget = new Map();
      this.observed.set(owner, byTarget);
    }
    byTarget.set(targetKey, observation);
  }

  clear(): void {
    this.observed = new WeakMap();
  }

  /**
   * 写入意图裁决：
   * 未见或确认不存在 => createIfAbsent (原子新建，已存在则报错)
   * 确认存在 => replaceIfVersion (基于观察到的物理版本号执行 CAS 替换)
   */
  writeIntent(target: FsTarget, actor: ToolExecutionActor): FsWriteIntent {
    const owner = this.owner(actor);
    const prior = owner ? this.get(owner, target.targetKey) : undefined;
    return prior?.kind === "present"
      ? { kind: "replaceIfVersion", version: prior.version }
      : { kind: "createIfAbsent" };
  }

  /**
   * 编辑意图裁决：
   * 未经权威观察 => 坚决抛出 FS_NOT_OBSERVED 阻断！
   * 确认文件不存在 => 坚决抛出 FS_NOT_FOUND 阻断！
   * 存在 => 提供 observed.version 作为 CAS 版本基底
   */
  editIntent(target: FsTarget, actor: ToolExecutionActor): FsEditIntent {
    const owner = this.owner(actor);
    const prior = owner ? this.get(owner, target.targetKey) : undefined;
    if (!owner || prior === undefined) {
      throw new FsError(`edit requires reading "${target.displayPath}" first`, "FS_NOT_OBSERVED");
    }
    if (prior.kind === "absent") {
      throw new FsError(`cannot edit "${target.displayPath}": not found`, "FS_NOT_FOUND");
    }
    return { version: prior.version };
  }

  /** 记录权威观察结果 */
  observe(target: FsTarget, observation: Observation, actor: ToolExecutionActor): void {
    const owner = this.owner(actor);
    if (owner) this.set(owner, target.targetKey, observation);
  }
}
```

### 2. 守卫拦截铁律

1. **权威观察源 (`fs/observed`)**：
   只有当智能体在当前会话中通过权威方式（如调用 `read` 读取了文件全文/片段，或通过 `glob` 准确命中了文件）之后，文件系统网关才会发出 `fs/observed` 事件，并在 `ObservedStateGate` 中登记该文件的当前哈希版本（`version`）；
2. **写盘强一致 CAS**：
   在调用 `write` 工具写盘时：
   - 若此前从未观察过该文件或确认文件不存在，写盘意图为 `createIfAbsent`。如果磁盘上实际已存在该文件，底层存储引擎原子拒绝，防止静默覆盖；
   - 若此前已确认存在，写盘意图携带 `replaceIfVersion: prior.version`。如果在此期间文件被第三方修改导致版本号漂移，写盘立即以 `FS_STALE_VERSION` 失败；
3. **编辑前必须先读**：
   在调用 `edit` 工具时，若智能体未曾使用 `read` 观察过目标文件，守卫直接抛出 `FS_NOT_OBSERVED`，完全阻止编辑行为进入文件层。这从根本上杜绝了“模型凭空假设某行代码长什么样就直接发起替换”的幻觉行为。

---

## 五、Windows ACL 原生沙箱 (dsh-sandbox-windows-acl)

在 Windows 环境下，操作系统缺乏 Linux 原生的 cgroups、namespaces 与 seccomp 隔离机制。直接运行命令容易因路径越权破坏宿主关键文件。

DSH 实现了基于 Win32 原生访问控制列表 (DACL) 的高安全沙箱 (`@deepseek-ai/dsh-sandbox-windows-acl`)。

### 1. 基于 Koffi 的 Win32 原生 FFI

该模块通过 `koffi` 高性能 FFI 库动态加载 Windows `Advapi32.dll` 与 `Kernel32.dll`，无需本地 C++ 编译：

```typescript
// Win32 ABI 常量
const PROCESS_QUERY_INFORMATION = 1024;
const SE_GROUP_LOGON_ID = 3221225472;

/**
 * 权能掩码：授予读、写、删除与子项删除权限
 * 严格剔除 WRITE_DAC 和 WRITE_OWNER，杜绝受限子进程自行篡改 ACL 或抢夺所有权逃逸
 */
const GRANT_MASK = 1114454;
const FILE_ALL_ACCESS = 2032127;
```

### 2. 受限令牌与 DACL 操纵机制

1. **创建受限进程令牌 (Restricted Token)**：
   调用 Win32 `CreateRestrictedToken`，彻底剥离进程的提权特权（如 `SeDebugPrivilege`、`SeTcbPrivilege`），并绑定当前登录会话的登录 SID（`SE_GROUP_LOGON_ID`）；
2. **专用工作区 SID 授权**：
   为当前工作区生成专有的写访问 SID（`workspaceWriteSid`）以及临时目录 SID（`tempWriteSid`）；
3. **目录安全描述符注入**：
   沙箱在启动受限进程前，通过 `SetNamedSecurityInfoW` 在目标工作区目录的 DACL 中追加一条继承 ACE（Access Control Entry），显式授予 `GRANT_MASK`；
4. **逃逸阻断**：
   由于 `GRANT_MASK` 中被显式扣除了 `WRITE_DAC`（写权限控制列表）与 `WRITE_OWNER`（夺取文件所有者），即使子进程内部运行了具有破坏性的脚本，也绝无可能修改自身或父级目录的安全属性以实现提权越狱。

### 3. 权限拒绝自愈技能 (ACL_DIAGNOSIS_SKILL)

在 Windows 复杂文件系统中，有时会因为父目录继承了来自上一级系统的显式拒绝策略（Deny ACE），导致合法的沙箱写操作产生意外的 `ACCESS_DENIED`。

DSH 将自愈诊断逻辑封装为系统内置技能 `diagnose-windows-sandbox-acl`。当遇到非预期的权限拒绝时：
1. 诊断命令逐级递归回溯目标文件与其所有祖先目录（直至驱动器根目录 `<drive>:\`）；
2. 提取并比对每一层安全描述符中的 DACL 继承链；
3. 精准定位引发冲突的孤立 ACE 项并在当前会话内自动完成现场修复，保障工作区持续可用。

---

## 六、工程最佳实践与反模式清单

| 维度 | [错误] 反模式 | [正确] 最佳实践 |
| --- | --- | --- |
| 终端执行 | 在多步构建中反复使用一次性 `pwsh -Command`，每步重新 `cd` | 采用持久化 PTY 终端（`tool-pwsh-persistent`），保持目录与环境上下文连续 |
| 命令转义 | 将未经转义的外部多行脚本直接拼入终端执行字符串中 | 使用 `quoteForPwsh` 进行双引号、反引号与 `$` 符号的完备转义 |
| 文件写入 | 在没有调用 `read` 查看现有内容的情况下直接调用 `edit` | 严格遵守文件观察策略守卫，先用 `read` 确立观察状态，再执行精准 CAS 编辑 |
| 长任务处理 | 遇到运行超时的耗时任务直接强杀进程抛出错误 | 利用长任务晋升机制转换为后台 `jobId`，后续通过 `job_output` 增量读取 |

---

## 相关 DSH 源码

```text
packages/shell/tool-pwsh-persistent   <-  @deepseek-ai/dsh-tool-pwsh-persistent@<version>
packages/shell/tool-bash-persistent   <-  @deepseek-ai/dsh-tool-bash-persistent@<version>
packages/fs/fs-observation-policy     <-  @deepseek-ai/dsh-fs-observation-policy@<version>
packages/sandbox/sandbox-windows-acl  <-  @deepseek-ai/dsh-sandbox-windows-acl@<version>
```
