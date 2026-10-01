# event-interceptor

<p align="center">
  <samp>
    <strong>中文</strong> ·
    <a href="./README.en.md">English</a>
  </samp>
</p>

事件拦截与流水线中间件示例（bundle 格式，纯 JavaScript，无需构建）。演示如何利用 Cordis 的 `waterfall` 机制拦截工具执行、实施安全门禁，并通过广播事件进行审计追踪。

## 演示内容

1. **流水线拦截（Waterfall）**：挂载 `tools/pre-execute` 拦截点，展示调用 `next()` 继续执行与返回 `{ kind: 'deny', reason: '...' }` 提前短路。
2. **硬规则遵守**：显式演示官方硬规则——**waterfall 监听器必须调用 next()**，避免误漏调用导致工具执行流水线卡死挂起。
3. **不可变结果审计**：监听 `tools/result` 广播事件，在工具调用结束时输出审计日志。
4. **生命周期自解绑**：通过 `ctx.on` 注册的事件监听器随插件卸载自动解除绑定，不残留进程级监听泄露。

## 安装与验证

```bash
# 安装到指定 profile
dsh plugin --profile demo add ./examples/event-interceptor

# 检查配置层插入
dsh --profile demo --dump-config

# 启动运行
dsh --profile demo
```

## 扩展建议

- **权限确认**：可在中间件中返回 `{ kind: 'ask', message: '...' }` 触发人工交互确认。
- **参数改写**：可在调用 `next()` 前对参数进行脱敏、规范化处理。
- 相关标准见 `references/events.md`（五种分发模式）与 `references/plugin-forms.md`（钩子插件与权限门禁）。
