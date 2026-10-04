# g14 · Webhook/LLM/多模态/内建增强/斜杠命令与输入触发器单据核实

核实基线：DSH 0.2.0-rc.2（asar 真源码 @ E:/newCC/APP/dsh/resources/app.asar/dsh/node_modules/@deepseek-ai）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：82 条（builtin 12 + multimodal 15 + llm 28 + webhook 16 + slash 11）
- OK：78
- WRONG：4
- STALE：0
- CONFLICT：0
- UNVERIFIED：0

## 逐条报告

### [WRONG] webhook-headless-and-workflows.md L38-40：delivery 的 JSON 载荷访问路径错误

- **现文**：`// delivery 快照字段：kind / source / deliveryId / receivedAt + JSON；第二参是 AbortSignal` + `const payload = delivery.payload;`
- **问题**：GitHub 适配器构造的 delivery 不是"顶层 payload"结构，载荷在 `delivery.event.payload` 下：`{ kind, source, deliveryId, event: { name, payload }, receivedAt }`。示例里 `delivery.payload` 恒为 undefined，`payload.action` 直接 TypeError。快照字段注释"…+ JSON"的表述模糊且未落字段名。
- **应为**：注释改为 `delivery 快照字段：kind / source / deliveryId / event{name,payload} / receivedAt`；示例改为 `const payload = delivery.event.payload;`
- **证据**：`dsh-webhook-github/lib/index.js:115-124`（`const delivery = { kind: "github", source: WebhookSourceId(config.source), deliveryId: WebhookDeliveryId(deliveryId), event: { name: eventName, payload }, receivedAt: Date.now() }`）；`dsh-webhook/lib/index.js:228-238`（snapshotDelivery 校验 kind/source/deliveryId/receivedAt，对 event 内容不校验）。

### [WRONG] multimodal-and-deliverables.md L81-84：compaction-tool-result-pruner 触发语义与替换标记文本错误

- **现文**：`距离当前轮次超过阈值的早期陈旧工具结果，系统自动将其文本内容安全替换为：` + `[tool result pruned: 42,150 bytes truncated to conserve context window]`
- **问题**：剪枝器是**内容长度触发**，与"距当前轮次的远近"无关：对当前 surface 上的每个 `tool/result`，当其中文本块总字符数超过 `thresholdChars`（默认 8192）即剪（保留 head 4096 + 标记 + tail 1024），陈旧程度不参与判定；替换标记也不是文中的句子，而是 `\n\n[... tool result middle pruned ...]\n\n`（保留中段替换，不是整条截断报告）。"42,150 bytes truncated to conserve context window" 字样在源码/README 中零命中。
- **应为**：改为"任何 tool/result 消息的文本字符数超过 thresholdChars（默认 8192）即剪（head 4096 + 标记 + tail 1024），与结果的新旧程度无关"；标记示例改为 `[... tool result middle pruned ...]`。
- **证据**：`dsh-compaction-tool-result-pruner/lib/index.js:12-16`（PRUNE_MARKER + DEFAULTS thresholdChars:8192/headChars:4096/tailChars:1024）、`:142-180`（pruneContent 仅按 totalChars > thresholdChars 触发；pruneSession 遍历当前 surface 全部 tool/result，无年龄/距离条件）。grep "tool result pruned" 全库 0 命中。

### [WRONG] multimodal-and-deliverables.md L66：附件存储根路径缺少 v1 版本层

- **现文**：`用户拖入输入框的图片文件，会自动进入本地存储池（位于 $DSH_HOME/attachments）`
- **问题**：本地存储根是 `${DSH_HOME}/attachments/v1`（构造器 `this.root = join(dshHome, "attachments", "v1")`；对象落 `<DSH_HOME>/attachments/v1/objects/<sha256前两位>/<sha256>`），`$DSH_HOME/attachments` 只是父目录。
- **应为**：改为"本地存储池（位于 `$DSH_HOME/attachments/v1`，对象按 sha256 内容寻址）"。
- **证据**：`dsh-attachment-local/lib/index.js:702`（`this.root = join(dshHome, "attachments", "v1")`）、`:19-22`（normalizedImagePath 的 `join(root, "objects", sha256 前两位, sha256)`）；`dsh-attachment-local/README.md:55,84`（"<DSH_HOME>/attachments/v1"）。

### [WRONG] slash-commands-and-input-triggers.md L6：示例命令 /clear 不存在

- **现文**：`用户在输入框中键入以斜杠开头的指令（如 /plan、/compact、/clear）`
- **问题**：官方内置命令注册表只有 plan/compact/feedback/goal/permission/export（另 record/catalog 等内部名），全树 grep 无任何 `name: "clear"` 命令注册，dsh-client-ui-commands 的 BUILTINS 清单也无 clear。
- **应为**：把 `/clear` 换成真实存在的命令，如 `/goal` 或 `/export`（`/plan、/compact、/goal`）。
- **证据**：grep `name: ['"]clear['"]` 在 @deepseek-ai 全库 0 命中（仅命中 goal/change operation 'clear' 等无关声明）；`dsh-client-ui-commands/lib/client.js:146-153`（BUILTINS: goal/plan/feedback/compact/permission/export）。
