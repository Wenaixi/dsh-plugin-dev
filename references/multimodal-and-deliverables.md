# DSH 多模态附件、人机交互提问与最终交付物呈递权威指南 (DSH 0.2.0-rc.2)
---

## 一、最终交付物呈递规范 (Deliverables & `present` 工具)

在 DSH 中，大模型生成的重要实体文件（如 Office 文档、PDF 报告、数据分析图表、打包好的项目代码包），**严禁仅在回复文本中打印冷冰冰的文件绝对路径**！

官方核心包 `@deepseek-ai/dsh-tool-present` 与 `@deepseek-ai/dsh-client-ui-deliverables` 提供了专门的**最终交付物卡片机制**：

```
  Agent 执行完成生成报表
            │ 调用 present({ files: [{ path: 'output.xlsx', description: '数据报表' }] })
            ▼
  前端弹出 Deliverables 交付卡片
  ┌────────────────────────────────────────────────────────┐
  │ 📄 output.xlsx (数据报表)                              │
  │    [👁️ 侧边栏预览]   [📂 默认应用打开]   [📁 文件管理器显示]     │
  └────────────────────────────────────────────────────────┘
```

### 1. `present` 工具核心参数契约
- `files`: 交付文件数组，默认 `maxFiles=8`（配置项，每次 1..maxFiles；工具描述建议单次 1-4 个）；返回 {turn, files} 并追加 deliverables/presented 会话事件；
- `files[].path`: 目标文件的相对路径或绝对路径；
- `files[].description`: 面向用户的简要说明文案；
- **前端渲染效果**：调用成功后，系统会在回复下方生成独立的交付物卡片区，用户可直接点击按钮调用系统原生程序（Native Open）打开文件，体验极其丝滑。

---

## 二、人机协同交互提问 (`ask_user_question` 与 `ctx.userQuestions`)

当 Agent 运行到关键歧义点需要人类做决策时（例如选择环境模式、确认是否覆盖数据），**严禁直接结束轮次并在对话里反复打字询问**！

官方提供了人机协同中断恢复机制：`@deepseek-ai/dsh-user-questions`（服务 seam）与 `@deepseek-ai/dsh-tool-ask-user`（模型工具）。

### 1. 交互提问工作原理
1. Agent 调用 `ask_user_question` 工具，传入结构化的问题与选项定义；
2. DSH 工具执行流水线在此处**优雅挂起（Pause Turn）**，轮次不报错也不结束；
3. 前端 Web GUI 弹出结构化的提问卡片（支持单选题、多选题、自定义输入框）；
4. 人类用户勾选或输入后点击提交，DSH 捕获用户选择并反序列化恢复执行流水线，将答案作为工具结果交付给模型继续推进！

### 2. 结构化问题参数示例
```json
{
  "questions": [
    {
      "id": "deploy_target",
      "header": "选择部署环境",
      "question": "请确认本次代码将要部署的目标集群：",
      "options": [
        { "label": "Staging 测试环境 (Recommended)", "description": "自动跑全量回归测试" },
        { "label": "Production 生产集群", "description": "直接对真实流量生效" }
      ],
      "multi_select": false
    }
  ]
}
```

---

## 三、多模态图像附件与持久化引用 (`dsh-attachment-local`)

DSH 提供了强大的多模态附件存储抽象：`@deepseek-ai/dsh-attachment-local`：

### 1. 附件规范化与安全落盘
- 用户拖入输入框的图片文件，会自动进入本地存储池（位于 `$DSH_HOME/attachments`）；
- 系统根据 `normalizationPolicy` 配置（maxPixels/maxDimension/maxBytes）自动校验文件大小、分辨率，并归一化为单帧 8-bit sRGB/sRGBA（有 alpha 走 WebP 否则 JPEG，GIF 坍单帧）；
- 生成带类型的不可变引用标识（`ImageAttachmentRef`），并在会话事件日志中持久化；
- 请求组装时由提供方适配器调 `AttachmentStore.readImageRequest` 解析引用为 LLM 原生视觉块（块类型是 `Image`，无 `ImageContentBlock` 之名）。

---

## 四、长上下文工具结果智能剪枝 (`compaction-tool-result-pruner`)

当会话进行几十轮之后，历史工具调用的巨大输出（例如跑 `git diff` 输出的几万字文本、`ls -R` 列出的几千个文件）会迅速挤爆模型的上下文窗口。

官方核心包 `@deepseek-ai/dsh-compaction-tool-result-pruner` 提供了**零模型开销、回放一致（Replay-Safe）的工具结果剪枝器**：

### 1. 剪枝策略与标记替换
- 剪枝器通过纯算法监控每个历史 `tool/result` 消息的字符长度；
- 距离当前轮次超过阈值的早期陈旧工具结果，系统自动将其文本内容安全替换为结构化摘要：
  ```
  [tool result pruned: 42,150 bytes truncated to conserve context window]
  ```
- **核心收益**：无需调用昂贵的大模型做二次摘要，毫秒级释放数万 Token 窗口，彻底杜绝超长上下文导致的 Context Window Exceeded 报错！
