# dsh-remote-storage-plugin

演示前端 React 通过 Typert Remote RPC 调用 Node.js 宿主服务，并将数据安全写入 `ctx.storage.domain` 领域持久化存储的全栈插件范例。

---

## 核心架构特性

1. **服务端 @Remote 服务**：继承 `Service` 类并在 Context 上挂载为 `remoteStorage`；
2. **四大签名硬约束**：方法签名严格禁止对象解构、禁止默认值、单一名命对象参数、末位协作 `signal`；
3. **领域存储持久化**：使用 `ctx.storage.domain` 注册带有 Zod 模式校验的独立命名空间表，告别散落写文件；
4. **前端远程 RPC 调用**：浏览器组件通过 `ctx.remote.remoteStorage.addNote()` 与宿主无缝通信；
5. **零上下文组件铁律**：React 组件不接收 `ctx`，通过 Props 传递通信函数。

---

## 运行与验证

```bash
# 1. 静态合规性校验
node scripts/validate_plugin.mjs examples/remote-storage-plugin

# 2. 安装并加载
dsh plugin --profile web add ./examples/remote-storage-plugin
```
