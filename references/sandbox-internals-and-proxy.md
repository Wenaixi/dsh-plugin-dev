# DSH 沙箱底层隔离 (Windows ACL / Landlock)、图像转储与出站网络代理权威指南 (DSH 0.2.0-rc.2)
---

## 一、沙箱底层物理隔离原理 (Windows ACL 与 Linux Landlock)

DSH 提供了三种标准的沙箱模式（`read-only`、`workspace-write`、`danger-full-access`）。许多开发者好奇：**DSH 没有启动庞大的 Docker 容器或轻量虚拟机，它是如何在不用容器/虚拟机的前提下限制子进程文件写权限的？（无官方时限数字；Windows 首次工作区授权是急切全树传播，大目录可达数十秒）**

### 1. Windows 平台黑科技：WRITE_RESTRICTED 令牌与 ACL 交集检查
官方核心包 `@deepseek-ai/dsh-sandbox-windows-acl` 直接调用 Windows NT 内核安全原语：
1. **限制性令牌 (Restricted Token)**：为运行命令的子进程创建一个受限令牌（`CreateRestrictedToken` 一次性施加 `DISABLE_MAX_PRIVILEGE|SANITIZE_STATE|LUA_TOKEN|WRITE_RESTRICTED` 四标志，attrs=13——`WRITE_RESTRICTED` 是组合的一部分而非单独标志）；
2. **受限 SID (Restricting SIDs)**：为当前工作区目录和每个会话/工作区各自随机的私有临时子目录（`mkdtempSync(join(tmp,'dsh-'))`，**不是系统的 Temp 根**）分配特定的限制性 SID；
3. **DACL 交集检查 (Intersection Check)**：沙箱通过 `SetEntriesInAclW` 一次写入 Write ACE（能力 SID 允许 + world SID `FILE_DELETE_CHILD` 拒绝 + Low 完整性标签 no-write-up）。Windows 内核在执行文件写入时，**当且仅当进程同时具备普通写入权限与限制性 SID 写入权限时才放行**！
- **核心收益**：除了允许写入的工作区和临时目录外，系统盘、用户主目录、系统关键文件的写入全部被内核底层直接拒绝。注意机制事实：工作区 ACE 是**常驻**的（复用缓存、绝不撤销），临时 ACE 可回收；首次授权是**急切的全树传播**（大目录上可达数十秒），不是零开销。

### 2. Linux 平台：Landlock 原生内核沙箱
Linux 平台采用**探测制链**：`PLATFORM_CHAINS.linux = ["bwrap", "landlock"]`，**bwrap 优先**，Landlock 是第二候选（经 node-addon-system 的 landlock-run 探测，旧 ABI 报告 partial）；不支持时 fail-closed，不是回退。Landlock 对子进程的文件系统访问树（Path-based Access Rights）进行细粒度封锁；文档中的「Linux 5.13+」无官方出处，已删。

---

## 二、沙箱结果三状态严格判别法 (Three-State Outcome Discrimination)

编写执行系统命令的插件时，必须严格区分以下三种本质不同的执行结果，**严禁混为一谈**：

| 状态分类 | 物理现实 | 系统判定与典型错误 | 应对策略 |
| :--- | :--- | :--- | :--- |
| **1. 正常安全拦截 (Policy Denial)** | 命令语法合法，但试图写入沙箱禁止的路径 | 沙箱正常履职，返回 `[sandbox: file access denied]` | 提示用户确认是否需要切换到 `workspace-write` 或 `danger-full-access`。 |
| **2. 执行器崩溃 (Runner Failure)** | 命令**从未真正被操作系统执行过** | 抛出 `SandboxUnavailableError` 或环境缺失 | 排查沙箱依赖是否损坏、可执行程序路径是否存在，不可归咎于命令本身。 |
| **3. 业务进程退出码失败 (Exit Code Failure)** | 命令已经在沙箱内完整执行，但业务代码报错 | 进程自身返回 `exitCode !== 0`（如 `git checkout` 分支不存在） | **退出状态非 0 绝对不能证明 runner 失败**！应如实提取 stderr 供模型分析。 |

---

## 三、多模态图像外置转储与会话自愈 (`image-offload`)

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

## 四、出站网络代理 (HTTP Proxy) 与 Undici 全局调度器

在很多企业内网、合规专线或需要梯子的开发环境中，如何确保插件和模型调用能够稳定访问外部网络？

### 1. 核心痛点：Node.js 原生 `fetch` 忽略环境变量
- Node.js 原生的全局 `fetch` 函数**默认不会读取系统的 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**！
- 这会导致即使在终端 `export HTTP_PROXY=...`，直接调用 `fetch` 依然会直连并发生超时或网络断开。

### 2. DSH 官方底层解决方案：Undici 全局调度器
官方核心库 `@deepseek-ai/dsh-http-proxy` 在宿主启动时执行以下动作：
1. 从启动环境（`launch-environment`）中解析用户配置的代理策略（支持 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 与 `NO_PROXY` 白名单）；
2. 将代理策略安装为底层 HTTP 引擎 **Undici 的全局调度器 (Global Dispatcher)**；
3. **透明覆盖效果**：由于全局 `fetch` 底层由 Undici 驱动，因此系统内所有的 LLM 适配器、网页搜索、MCP over HTTP、以及**第三方插件内部调用的原生 `fetch()`**，全部自动、无感知地享受代理网络加持，插件开发者零代码侵入！
