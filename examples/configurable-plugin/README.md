# configurable-plugin

<p align="center">
  <samp>
    <strong>中文</strong> ·
    <a href="./README.en.md">English</a>
  </samp>
</p>

规范配置与 Schemastery 校验示例（bundle 格式，纯 JavaScript，无需构建）。演示如何按照 DSH 官方硬规则导出 Schema、在 YAML 中传入覆盖值，以及使用 `!!js` 标签安全求值环境变量。

## 演示内容

1. **类型化 Schema**：导出同名 `Config` Schema 对象，声明类型、默认值、数值区间约束（`min`/`max`）和中文字段描述。
2. **硬规则 6 遵守**：严格使用 Schemastery，不导出普通对象，满足 Cordis Standard Schema 接口规范。
3. **嵌套配置结构**：展示复杂嵌套配置的默认值自动填充与层级解析。
4. **动态环境变量**：在 `cordis.patch.yml` 中演示 DSH 官方 `!!js` 标签语法，动态从 `process.env` 读取值并赋予兜底方案。

## 安装与验证

```bash
# 安装到指定 profile
dsh plugin --profile demo add ./examples/configurable-plugin

# 检查配置层插入与 Schema 展开
dsh --profile demo --dump-config

# 启动运行，查看加载时打印的规范配置
dsh --profile demo
```

## 避坑要点

- **不要在运行时悄悄吞掉配置错误**：如果用户传入了小于 100 的 `timeoutMs`，Cordis 在挂载阶段即会抛出 Schema 校验异常终止启动，防止带病运行。
- **动态变量安全**：敏感 Token 不要直接硬编码在 YAML 文件中，务必使用 `!!js 'process.env.YOUR_TOKEN'` 动态引用。
- 相关标准见 `references/config.md`（配置定义与 Schema 校验）。
