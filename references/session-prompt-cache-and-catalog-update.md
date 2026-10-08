# 会话目录更新机制与大模型 Prompt Cache 保全原理

> 适用场景：任何向会话注入动态条目清单、技能目录、工具声明或环境上下文的 DSH 插件。
> 核心命题：**全局配置变更如何即时通知大模型，同时保全历史多轮对话在 LLM 服务端的高速前缀缓存（Prompt Cache）？**

---

## 一、核心矛盾：动态响应 vs 缓存保全

在 Agent 插件架构设计中，存在一对看似不可调和的矛盾：
1. **全局即时响应需求**：用户在全局设置面板中修改了某项配置（例如开关、语言偏好或环境参数），期望在已存在的旧会话中续聊时，模型能立即获得最新生效的环境，而不是永久停留在旧会话创建时的旧状态中。
2. **大模型 Prompt Cache 成本与延迟约束**：主流大模型提供商（如 DeepSeek 自动前缀缓存、Anthropic Claude Ephemeral Cache、OpenAI Prompt Cache）均基于**严格的前缀连续 Token 匹配（Prefix Matching）**。如果系统为了让模型感知新配置，去“原地篡改或替换”历史第一轮消息中的旧目录，哪怕只变动了一个字符，从该 Token 开始往后的历史所有上下文（几十万 Token）将**全盘脱靶（100% Cache Miss）**，导致首字延迟（TTFT）暴增数十倍、推理账单费用翻倍。

DSH 原生架构通过精妙的 **Append-only 增量替换通知模型** 完美化解了这一矛盾。

---

## 二、DSH 会话底层流转与更新机制

### 1. 会话持久化的 Append-only 契约
- DSH 的会话日志（`Session Log`，如 `.jsonl`）是**纯追加（Append-only）的不可变事件流**；
- 历史上已经发生的事件（`turn/start`、`user/message`、`assistant/message`、`tool/result`）在持久化介质上**绝对只读、绝不回溯改写**；
- 会话的头部（`SessionHeader`）仅记录会话 ID、创建时间、工作区目录（`cwd`）和预设名（`agentPreset`），并不包含插件私有配置的静态快照。

### 2. 轮次前置指纹比对机制（`agent/pre-step`）
DSH 官方在每轮对话发起前，通过瀑布流事件对全量动态条目进行现场指纹比对：
1. **实时采集快照**：调用提供方服务的 `snapshot()`，收集当前运行环境中所有可向模型暴露的候选条目列表；
2. **计算全量内容哈希**：将所有有效条目的关键字段（如名称与描述）规范化序列化后，计算全局 SHA-256 指纹 `digest`；
3. **倒序扫描持久化历史**：从会话当前游标 `seq - 1` 倒序扫描，提取历史事件中最近一次发布的目录条目，计算其持久化历史指纹 `visibleDigest`；
4. **决策分流**：
   - **指纹一致（`digest === visibleDigest`）**：判定外部环境无变动，当前轮次**零注入**（不产生任何冗余通知消息）；
   - **指纹不一致（`digest !== visibleDigest`）**：判定外部环境已发生变更。

### 3. 增量替换通知生成（`renderCatalogUpdate`）
当指纹发生变动时，系统检查历史发布状态：
- 若为全新会话（`history.published === false`）：生成初始目录消息 `renderCatalogMessage`；
- **若为已存在会话（`history.published === true`）**：绝不篡改历史第 1 轮消息，而是在当前轮次的待发消息末尾，动态追加一条带有 `<system-reminder>` 标记的专属替换通知：
  ```xml
  <system-reminder>
  The available catalog changed. This complete catalog replaces every earlier list in this session:

  <available_items>
  - `item-a`: 最新描述/配置
  ...
  </available_items>

  Use only names in this replacement catalog.
  </system-reminder>
  ```
该消息打上 `source: { update: true, entries }` 标记，并以全新的 `user/message` 事件追加到当前轮次事件流中。

---

## 三、大模型 Prompt Cache 保全机理剖析

在上述机制下，发往 LLM 接口的上下文消息数组呈现如下结构：

```text
[第 1 轮: 包含初始目录的历史消息]   ──┐
[第 1 轮: 模型历史回复与工具调用]    │
...                                ├─ 全部保持原样，Tokens 序列逐字一致
[第 N 轮: 历史上下文消息]           │  ──> 100% 命中大模型服务端 Prompt Cache！
[第 N 轮: 模型历史回复]             ──┘
[第 N+1 轮: 用户当前新提问]        ──┐
[第 N+1 轮: 追加的替换通知消息]     ──┴─ 仅当前微量新增 Tokens 未命中缓存
```

### 核心收益
1. **历史缓存高命中率**：哪怕会话已经累积了数十轮对话、十万 Token 以上的上下文，前面的历史前缀没有发生任何移动或变更，服务端 KV 缓存完全命中；
2. **模型认知即时校正**：通过声明性文案（`replaces every earlier list`），模型在注意力机制的最新位置被强力对齐到最新配置，优先采纳最新清单；
3. **缓存前缀递增演进**：当前轮次结束后，包含替换通知的新序列被整体写入缓存，供第 N+2 轮及后续对话继续作为稳定前缀复用。

---

## 四、极端边界：全部禁用时的安全降级

若用户在配置中将所有条目全部关闭（条目数降为 0）：
- 宿主不会静默失败，也不会崩溃；
- 判定 `entries.length === 0` 时，替换通知自动降级为显式的安全断言文案：
  `"No items are currently available through this capability. Do not use names from earlier catalogs."`；
- 依然以追加通知形式投递给模型，阻断模型继续产生幻觉调用。

---

## 五、插件开发者的必须遵守的契约纪律

1. **严禁在插件层试图覆写会话历史**：
   切勿试图通过 Hook 去修改或重写 `session.eventAt()` 或已持久化的历史事件。任何前缀变动都会直接摧毁长会话的 Prompt Cache。
2. **保证变更通知的单向性与指纹真实性**：
   当插件内部状态变化（如开关、语言、选项配置）时，只需通过 Provider 控制器触发注册表失效（如 `control.invalidate()`）并递增宿主 `revision`。宿主会在下一次对话的 `agent/pre-step` 自动完成指纹比对与增量通知派发。
3. **避免无意义的微小波动触发高频更新**：
   若导出的描述字符串带有无意义的动态时间戳、随机数或每次遍历顺序不一致（未排序），会导致 SHA-256 指纹每轮都发生虚假变动，使已存在会话在每一轮都不必要地追加替换通知，白白浪费新增 Token 成本。条目清单必须保持**确定性排序（Deterministic Sorting）**。
