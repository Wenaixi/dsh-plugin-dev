# event-interceptor 示例插件

演示 DeepSeek Harness (DSH 0.2.0-rc.2) 中工具安全防护与执行审计的官方标准写法。

## 核心机制

1. **单调安全守卫 (`ctx.tools.guard`)**：
   - 符合 DSH 工具执行保护管线的安全设计；
   - 遵循**单调安全法则**：任何守卫只要返回字符串错误原因，调用即被判定为阻断，任何其他守卫无法越权放行；
   - 卸载时返回的 Disposer 自动回滚，零副作用残留。
2. **事件总线审计 (`tools/post-execute`)**：
   - 监听工具执行结果事件，收集耗时与执行状态，供合规审计与日志追踪。

## 安装与测试

```bash
# 1. 复制到工作区并安装
dsh plugin add ./examples/event-interceptor

# 2. 验证配置树
dsh --profile web --dump-config
```
