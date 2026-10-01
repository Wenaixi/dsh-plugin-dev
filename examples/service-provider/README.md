# service-provider

<p align="center">
  <samp>
    <strong>中文</strong> ·
    <a href="./README.en.md">English</a>
  </samp>
</p>

自定义 Cordis 服务与依赖注入示例（bundle 格式，纯 JavaScript，无需构建）。演示如何继承 `Service` 基类向全局上下文暴露命名能力，并通过 `inject` 声明依赖进行安全消费。

## 演示内容

1. **提供服务**：继承 `Service` 并在构造函数中调用 `super(ctx, 'memoryCache')`，将能力挂载到 `ctx.memoryCache`。
2. **依赖注入**：消费方插件通过 `inject: ['memoryCache']` 声明强依赖，Cordis 框架保证在依赖未就绪前插件保持 `PENDING`，就绪后才调用 `apply`。
3. **副作用自动清理**：在服务内部使用 `this.ctx.effect()` 注册销毁逻辑，当插件卸载或被热替换时自动回收资源与定时器。

## 安装与验证

```bash
# 安装到指定 profile
dsh plugin --profile demo add ./examples/service-provider

# 检查配置层插入
dsh --profile demo --dump-config

# 启动运行，查看服务就绪日志
dsh --profile demo
```

控制台将输出：
```
[cache-consumer] memoryCache service ready, performing cache ops...
[cache-consumer] read from cache: operational
```

## 与标准的对应关系

- **服务声明**：符合 `references/services.md` 中的 Service 基类规范。
- **生命周期**：符合 `references/plugin-anatomy.md` 中的 Fiber 状态机与卸载清理原则。
- **解耦设计**：服务提供方不依赖消费方，任何后续插件只需 `inject: ['memoryCache']` 即可获取缓存能力。
