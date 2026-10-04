# 双面插件与 Web UI

## 数据流

宿主激活插件并注册插槽，宿主页面在匹配位置提供 props，浏览器运行面加载客户端模块并渲染组件；用户操作通过宿主允许的表单或通信通道写入，宿主持久化后重新提供状态。组件只消费 props，不携带宿主上下文。

## 选择落点

先按界面语义选择插槽，再查目标版本的插槽规范、父子声明和注册参数。插槽未声明时可能静默不执行；注册成功不等于用户能看见。一个功能保持一个写入入口，避免多处状态语义漂移。

## 两侧纪律

宿主负责服务、权限、持久化和运行时事实；浏览器负责渲染和用户交互。文案、主题和 UI 原子组件使用宿主规定的注入方式。客户端构建格式、外部依赖白名单和导出边界必须按目标宿主核验。

## 真机验收

按模块加载、插槽命中、组件渲染、事件命中、写入落盘、重新读取六步取证。控制台错误、空错误容器、组合资源缓存和遮罩都要单独排查。点击后必须回读接口或文件；截图和 DOM 存在只能证明显示，不能证明写入。

## 常见失效

- 客户端产物仍是旧版本。
- 组件收到不可用的宿主对象。
- 插槽语义或父级声明不匹配。
- 组件崩溃被宿主转换为空节点。
- 样式只定义未注入。
- UI 显示成功但实际配置未改变。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@0.2.0-rc.2
packages/client/ui-primitives  <-  @deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2
packages/client/ui-renderer  <-  @deepseek-ai/dsh-client-ui-renderer@0.2.0-rc.2
packages/client/ui-slots  <-  @deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2
```
