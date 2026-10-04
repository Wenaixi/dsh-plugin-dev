# 静默失效排错

## 三分法

先判断故障属于哪一类：

1. **代码没有执行**：入口未解析、依赖未就绪、apply 未调用、客户端未进入加载图。
2. **契约被吞掉**：字段、服务、插槽、exports、事件或写入命中条件错误，宿主把错误变成空结果。
3. **解析到了别的东西**：旧产物、旧缓存、错误版本、错误 profile、错误路径或错误 registry。

## 证据循环

提出一个可证伪假设，找到对应观测点，读取运行时真值，做最小对照实验，只改变一个变量，再回读真值。区分代码阅读结论、静态检查结果、行为测试结果和真实运行时结果。

## 门禁设计

行为问题用运行时调用、接口或落盘状态验证；产物问题用 import、模块加载和 tarball 清单验证；结构问题用字段断言和反向断言验证。测试不要只读源码文本证明功能存在，也不要使用永远为真的断言。重要断言要人为破坏后确认失败。

## UI 特别规则

宿主状态正常不等于浏览器渲染正常；DOM 存在不等于事件命中；点击完成不等于写入成功；截图正常不等于持久化成功。每次写操作后读取真实接口或文件，并在失败时收集浏览器控制台、网络、模块加载图和错误节点证据。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.4
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@0.2.0-rc.2
packages/extensions/cordis-client-runner  <-  @deepseek-ai/dsh-cordis-client-runner@0.2.0-rc.2
```
