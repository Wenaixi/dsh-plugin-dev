# 双面插件与 Web UI

## 数据流

宿主激活插件并注册插槽，宿主页面在匹配位置提供 props，浏览器运行面加载客户端模块并渲染组件；用户操作通过宿主允许的表单或通信通道写入，宿主持久化后重新提供状态。组件只消费 props，不携带宿主上下文。

## 选择落点

先按界面语义选择插槽，再查目标版本的插槽规范、父子声明和注册参数。插槽未声明时可能静默不执行；注册成功不等于用户能看见。一个功能保持一个写入入口，避免多处状态语义漂移。

## 两侧纪律

宿主负责服务、权限、持久化和运行时事实；浏览器负责渲染和用户交互。文案、主题和 UI 原子组件使用宿主规定的注入方式。客户端构建格式、外部依赖白名单和导出边界必须按目标宿主核验。

### 客户端模块导出规范与服务注入依赖声明 (Client Inject Contract)

双面插件的浏览器半侧产物（`lib/client.js`）由宿主客户端的 Cordis 微内核动态加载与激活。必须严格捍卫以下导出契约：

1. **必须显式声明客户端注入服务**：
   客户端插件入口（`src/client.entry.ts`）必须同时显式导出 `inject` 数组与默认导出对象：
   ```ts
   export const inject = ['slots', 'locale']
   export default { apply, inject }
   ```
2. **冷启动时序与“隐式依赖被邻居满足”陷阱**：
   - 若未声明 `inject`，Cordis 判定插件无外部依赖，在客户端引导的极早期（bootstrap 刚结束）立即调用 `apply(ctx)`；
   - 此时宿主前端服务（如 `ctx.slots`、`ctx.locale`）尚未挂载完毕（为 `undefined`），插件内执行 `ctx.slots.inject(...)` 立即抛出未捕获 TypeError，导致 entry fiber 初始化失败，启动器判定为 `failed`（启动遮罩显示 `web boot: 1 entry did not activate`）；
   - 在装有几十个其他插件的日常 profile 中，该缺陷会被其他插件提前唤醒服务的行为隐匿掩盖（假阳性），唯有在仅装基础插件的纯净隔离实例冷启动时才会彻底暴露；
3. **双端元数据严格同步**：
   `package.json` 的 `dsh.client.inject` 作为宿主分发层索引，与代码内部导出的 `inject` 数组必须 100% 同步。

## 真机验收

按模块加载、插槽命中、组件渲染、事件命中、写入落盘、重新读取六步取证。控制台错误、空错误容器、组合资源缓存和遮罩都要单独排查。点击后必须回读接口或文件；截图和 DOM 存在只能证明显示，不能证明写入。

## 常见失效

- **客户端冷启动崩溃**：未显式声明 `inject: ['slots', 'locale']`，导致在纯净新实例中 `ctx.slots` 为 undefined，抛未捕获异常被标记为 `failed`（`web boot: 1 entry did not activate`）。
- **本地调试指向 pnpm 快照副本**：未建直通工作区的目录联接，导致源码修改重构建后宿主继续命中旧快照，改动不生效。
- **客户端产物仍是旧版本**：构建未执行或 rev 因 mtime 未变命中浏览器长缓存。
- **组件收到不可用的宿主对象**：未对不可信数据做防污清洗与默认值兜底。
- **插槽语义或父级声明不匹配**：在非目标插槽位置挂载或使用了已废弃的插槽 ID。
- **组件崩溃被宿主转换为空节点**：组件内部抛错导致宿主降级为空的 `<div data-slot-error>`。
- **样式只定义未注入**：CSS 规则未通过宿主注入通道挂载或热重载时 Disposer 未清理导致标签堆叠。
- **UI 显示成功但实际配置未改变**：表单 mutate 失败或并发点击导致 revision 乐观锁版本撕裂。

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
