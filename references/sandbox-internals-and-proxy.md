# DSH 沙箱底层隔离 (Windows ACL / Landlock)、文件观察策略与出站网络代理权威指南
---

## 一、沙箱底层物理隔离原理 (Windows ACL 与 Linux Landlock)

DSH 提供了三种标准的沙箱模式（`read-only`、`workspace-write`、`danger-full-access`）。DSH 没有启动笨重的 Docker 容器或轻量虚拟机，而是在宿主进程内直接调用操作系统内核安全原语，实现亚毫秒级启动与严格的写权限物理隔离。

### 1. Windows 平台：WRITE_RESTRICTED 令牌与 DACL 交集检查
官方核心包 `@deepseek-ai/dsh-sandbox-windows-acl` 直接调用 Windows NT 内核安全 API：
1. **限制性令牌 (Restricted Token)**：为运行命令的子进程创建受限令牌，通过 `CreateRestrictedToken` 一次性施加 `DISABLE_MAX_PRIVILEGE | SANITIZE_STATE | LUA_TOKEN | WRITE_RESTRICTED` 四标志组合（attrs=13）；
2. **受限 SID (Restricting SIDs)**：为当前工作区目录和会话专属的私有临时子目录（`mkdtempSync(join(tmp, 'dsh-'))`，严格禁止使用系统全局 Temp 根目录）分配特定的限制性能力 SID；
3. **DACL 交集检查 (Intersection Check)**：沙箱通过 `SetEntriesInAclW` 写入精密的 ACE 组合：
   - 能力 SID 允许写（Allow ACE）；
   - World SID `FILE_DELETE_CHILD` 显式拒绝，防止子进程篡改或删除上级目录；
   - Low 完整性标签（Low Integrity Label `no-write-up`），阻止向同级或高级完整性目标写数据；
4. **内核级双重判定铁律**：Windows NT 内核在判定写访问时，**当且仅当调用方的主令牌同时满足标准 DACL 与 Restricting SIDs 权限列表时才予以放行**！任何对系统盘、用户主目录或关键配置的写入均被内核驱动直接拒绝。

**物理特性说明**：
- 工作区 ACE 属于**常驻复用缓存**（绝不撤销），临时目录 ACE 在生命周期结束时回收；
- 首次向工作区目录赋予 ACE 时，执行的是**急切的全树递归继承传播**，在超大工程目录上首次授权可能耗时数十秒。

### 2. Linux 平台：Landlock 内核沙箱与 bwrap 探测链
Linux 平台采用探测制后备链：`PLATFORM_CHAINS.linux = ["bwrap", "landlock"]`：
- 优先使用 `bwrap` (Bubblewrap) 建立用户命名空间隔离；
- 第二候选为通过 `landlock-run` 调用内核原生 Landlock LSM 模块，对子进程的文件系统路径访问权限树进行细粒度路径封锁；
- 平台不支持时严格执行 **Fail-Closed 闭环阻断**，绝不降级至无隔离运行。

---

## 二、Win32 ACL 与文件观察策略 (fs-observation-policy) 的纵深协同

在 DSH 安全体系中，很多开发者容易混淆沙箱拦截与文件观察策略拦截。实际上，两者分别位于操作系统内核与应用层，构成了强大的**纵深防御体系 (Defense-in-Depth)**：

```
  大模型发起文件写入请求: edit('src/app.ts', ...)
                    │
                    ▼
  【第一道防线：应用层逻辑网关】dsh-fs-observation-policy (WeakMap 观察表)
  - 校验当前会话此前是否合法读取过该文件？
  - 比对当前磁盘纳秒复合指纹 dev:ino:size:mtimeNs:ctimeNs 与观察记录是否一致？
  - [未读先写] -> 阻断！抛出 FS_NOT_OBSERVED
  - [并发被改] -> 阻断！抛出 FS_STALE_VERSION
                    │ (放行)
                    ▼
  【第二道防线：进程内互斥锁】dsh-fs-local (withLock)
  - 按 targetKey 进入进程内 FIFO 互斥队列，串行化写操作，杜绝同进程竞争
                    │ (放行)
                    ▼
  【第三道防线：内核级物理隔离】dsh-sandbox-windows-acl / Landlock
  - 启动子进程，施加 WRITE_RESTRICTED 受限令牌与能力 SID
  - 目标路径是否在工作区或专用临时子目录内？
  - [越界写入系统盘/上级目录] -> 内核硬拒绝！返回 [sandbox: file access denied]
                    │ (放行)
                    ▼
  【原子落盘】writeFileAtomic (随机临时后缀写入 + 原子 rename 覆盖)
```

### 职责分工矩阵
| 比较维度 | 沙箱隔离 (dsh-sandbox-windows-acl) | 文件观察策略 (dsh-fs-observation-policy) |
| :--- | :--- | :--- |
| **防御层级** | 操作系统 NT 内核层（Token / DACL） | 宿主应用层（Cordis 事件网关） |
| **拦截目标** | 物理越界、逃逸、篡改系统关键文件 | 逻辑盲目覆写 (Clobber)、并发脏写、未读即写 |
| **拦截错误** | `[sandbox: file access denied]` 策略拒绝 | `FS_NOT_OBSERVED` 或 `FS_STALE_VERSION` |
| **状态存储** | Windows DACL 物理访问控制列表 | 进程内弱引用映射 `WeakMap<AgentSession, Map>` |
| **生命周期** | 长期有效，跨进程重启常驻 | 会话内存易失，进程重启或会话恢复需重新 read |

---

## 三、沙箱结果三状态严格判别法 (Three-State Outcome Discrimination)

编写执行系统命令的插件时，必须严格区分以下三种本质不同的执行结果，**严禁混为一谈**：

| 状态分类 | 物理现实 | 系统判定与典型错误 | 应对策略 |
| :--- | :--- | :--- | :--- |
| **1. 正常安全拦截 (Policy Denial)** | 命令语法合法，但试图写入沙箱禁止的路径 | 沙箱正常履职，返回 `[sandbox: file access denied]` | 提示用户确认是否需要切换到 `workspace-write` 或 `danger-full-access`。 |
| **2. 执行器崩溃 (Runner Failure)** | 命令**从未真正被操作系统执行过** | 抛出 `SandboxUnavailableError` 或环境缺失 | 排查沙箱依赖是否损坏、可执行程序路径是否存在，不可归咎于命令本身。 |
| **3. 业务进程退出码失败 (Exit Code Failure)** | 命令已经在沙箱内完整执行，但业务代码报错 | 进程自身返回 `exitCode !== 0`（如 `git checkout` 分支不存在） | **退出状态非 0 绝对不能证明 runner 失败**！应如实提取 stderr 供模型分析。 |

---

## 四、多模态图像外置转储与会话自愈 (image-offload)

在多模态插件的开发中，如果一个长会话里包含很多轮次的大图，随着对话推进，巨大的 Base64/二进制图片会迅速占满大模型的上下文窗口，导致外部大模型报错 `IMAGE_OFFLOAD_REQUIRED`。

官方核心包 `@deepseek-ai/dsh-compaction-image-offload` 提供了**自动转储与自愈重试机制**：

```
  模型调用报错: IMAGE_OFFLOAD_REQUIRED (上下文被图片挤爆)
                     │
                     ▼
  image-offload 捕获错误，产生 image/offload 会话事件
                     │
                     ▼
  自动筛选出历史轮次中最早提交的陈旧图片
                     │
                     ▼
  将历史图片替换为紧凑的文本占位符: [Image: uploaded_diagram.png (offloaded)]
                     │
                     ▼
  保留最新轮次的当前图片，自动发起重试 (Retry)，会话成功恢复推进！
```

---

## 五、出站网络代理 (HTTP Proxy) 与 Undici 全局调度器

在企业专线或合规代理开发环境中，确保插件和模型调用稳定访问外部网络至关重要。

### 1. 核心痛点：Node.js 原生 fetch 忽略系统代理环境变量
- Node.js 原生的全局 `fetch` 函数**默认不会读取系统的 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**；
- 这会导致即使在终端 `export HTTP_PROXY=...`，直接调用 `fetch` 依然会直连并发生超时或网络断开。

### 2. DSH 官方底层解决方案：Undici 全局调度器
官方核心库 `@deepseek-ai/dsh-http-proxy` 在宿主启动时执行以下动作：
1. 从启动环境（`launch-environment`）中解析用户配置的代理策略（支持 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与 `NO_PROXY` 白名单）；
2. 将代理策略安装为底层 HTTP 引擎 **Undici 的全局调度器 (Global Dispatcher)**；
3. **透明覆盖效果**：由于全局 `fetch` 底层由 Undici 驱动，因此系统内所有的 LLM 适配器、网页搜索、MCP over HTTP、以及**第三方插件内部调用的原生 `fetch()`**，全部自动、无感知地享受代理网络加持，插件开发者零代码侵入！

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.5
packages/sandbox/sandbox  <-  @deepseek-ai/dsh-sandbox@<version>
packages/sandbox/sandbox-local  <-  @deepseek-ai/dsh-sandbox-local@<version>
packages/sandbox/sandbox-windows-acl  <-  @deepseek-ai/dsh-sandbox-windows-acl@<version>
packages/fs/fs-observation-policy  <-  @deepseek-ai/dsh-fs-observation-policy@<version>
packages/compaction/compaction-image-offload  <-  @deepseek-ai/dsh-compaction-image-offload@<version>
packages/util/http-proxy  <-  @deepseek-ai/dsh-http-proxy@<version>
```
