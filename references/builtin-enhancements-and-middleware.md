# DSH 官方内置增强插件、死循环防护与实用中间件全景指南 (DSH 0.2.0-rc.2)
---

## 一、工具调用死循环检测与劝告性提醒 (`repeat-tool-reminder`)

在大模型调用工具的过程中，经常会出现**陷入局部死循环**的经典失控现象：模型执行某条命令报错后，由于提示词或上下文局限，持续在接下来的多轮交互中反复调用相同的工具、传入完全相同的参数，白白消耗巨额 Token。

官方核心包 `@deepseek-ai/dsh-repeat-tool-reminder` 提供了极其优雅的**劝告性死循环拦截中间件 (Advisory Repeat-Call Detector)**：

```
  第 1 次调用: bash('git pull') ──► 报错冲突
  第 2 次调用: bash('git pull') ──► 再次报错冲突
  第 3 次调用: bash('git pull') ──► 命中 repeat-tool-reminder 阈值！
                                      │
                                      ▼ 流水线自动注入破局上下文
  [系统劝告提醒]: 你已连续多次使用相同参数调用该工具且未取得进展，请停下来并尝试替代方案！
                                      │
                                      ▼
  模型接收到权威提醒，主动转变策略改用冲突解决步骤
```

### 1. 核心设计哲学：劝告而非暴力掐断
- **不一票否决**：它不直接向工具返回 Deny 错误，也不暴力中断会话；
- **来源归属标记**：通过 tools/post-execute 瀑布在 downstream.additionalContexts 前部注入一条 source={kind: 'repeat-tool-reminder', form: notice} 的**用户角色**提示消息（REMINDER_SOURCE），标签是归类依据（无标签会渲染成普通用户指令）；不否决、不重写调用。

---

## 二、动态时钟与环境事实注入 (`time-context`)

由于大模型的预训练数据具有截止日期，模型在没有外部提示的情况下无法准确感知“今天是哪一年、现在是几点、当前是周几”。

官方核心包 `@deepseek-ai/dsh-time-context` 提供了**精准时间事实注入器**：

### 1. 工作原理与状态投影
- 在每个 agent/pre-step 且未被 reject/abort、距上次注入超过 refreshIntervalMs（默认 10 分钟）时，系统自动读取宿主物理挂钟时间（Wall-Clock Time）与本地 IANA 时区（如 `Asia/Shanghai`）；
- 生成带有 `kind: 'time-context'` 来源标识的结构化时间事实块并注入请求历史；
- 同时在会话状态投影中维护 `timeContext` 单元（stateVersion 2），time-context 自身据此做跨轮次注入节流；该投影当前没有其他子系统消费（dsh-schedule 全用独立 Date.now()）。

---

## 三、用户反馈回流与评估机制 (`message-feedback`)

对于企业级部署或持续优化的 Agent 平台，收集人类对模型输出的直接反馈（点赞、点踩、纠错批注）至关重要。

官方核心包 `@deepseek-ai/dsh-message-feedback` 为定稿的助手消息提供了标准的数据回流渠道：

### 1. 核心能力与安全限制
- 提供通过 Typert Remote 暴露的 `ctx.remote.messageFeedback` 接口，支持前端组件执行 `put`、`delete`、`list` 操作；
- **字节截断保护 (`maxNoteBytes`)**：强制限制用户附带批注笔记的最大 UTF-8 字节长度，防止恶意超大文本撑爆数据库；
- 每条反馈通过消息 ID（`messageId`）与已落盘的 assistant/message 强绑定（put 校验消息存在），并用 `version`/`ifVersion` 乐观锁防覆盖，便于自动化数据集导出与 RLHF 强化学习回流。

---

## 四、包级架构不变量断言守护网 (`dsh-invariants`)

随着插件生态的膨胀，如何确保各个模块之间的契约没有被破坏？

官方核心包 `@deepseek-ai/dsh-invariants` 贯彻了严苛的**伴生断言入口规范 (Companion Invariants Pattern)**：

### 1. 架构设计规范
- 每个核心包除了主入口 `lib/index.js` 外，通常提供一个同级的 `./invariant` 导出（如 `dsh-session/invariant`、`dsh-schedule/invariant`）；
- 主入口只承载业务运行时代号，绝不包含笨重的自检逻辑；
- 诊断与启动检查时，由 `dsh-invariants` 服务根据 `package_allowlist` 动态拉起这些伴生检查规则，验证系统关键状态（如服务单例性、接口实现完备性），在开发阶段提前掐灭隐蔽 Bug！
