# g03 · references/plugin-anatomy.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop/web profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：34
- OK：29
- WRONG：0
- STALE：0
- CONFLICT：0
- UNVERIFIED：5

## 逐条报告

### [UNVERIFIED] 文档 L104：「每个插件模块必须导出小写连字符命名的字符串 name」

- **现文**：每个插件模块必须导出小写连字符命名的字符串 name，供 Cordis 跟踪生命周期与日志排查。
- **问题**：Cordis RegistryService.resolve 对插件 name 无格式校验（任何字符串均可；cordis/lib/index.js:1619-1641 仅校验「函数或含 apply 的对象」）；「小写连字符」是 DSH 条目 id 的约束（dsh-app-boot 的 patch schema），不是插件模块导出 name 的强制格式。作为规范语句过强。
- **证据**：@deepseek-ai/cordis/lib/index.js:1619-1641（plugin() 对 name 无格式校验）；@deepseek-ai/dsh-app-boot/lib/index.js:2906-2908（id 格式约束 schema，与 name 分离）。

### [UNVERIFIED] 文档 L167-168：「事件一旦在类型声明里标注了 @mode，就只能用对应方法派发，混用无效」

- **现文**：派发有五个互不通用的方法：ctx.emit / ctx.waterfall / ctx.parallel / ctx.serial / ctx.bail。事件一旦在类型声明里标注了 @mode，就只能用对应方法派发，混用无效。
- **问题**：五个派发方法本身有源码证据（@deepseek-ai/cordis/lib/index.js:271-325）；但「@mode 标注后混用无效」在运行时无强制——cordis/src/events.ts 全文件仅一处 @mode 标注（internal/config，L337），dispatch 不做 mode 匹配检查，纯类型层约束。作为教学性描述可接受，但「混用无效」无运行时证据。
- **证据**：@deepseek-ai/cordis/src/events.ts:337（唯一 @mode 标注）；@deepseek-ai/cordis/lib/index.js:258-264（dispatch 不校验 mode）。

### [UNVERIFIED] 文档 L180-187：四角色模型（core / seam / bundle / service）

- **现文**：DSH 官方将每种能力划分为四种角色之一：core（每个组合必启动的主干服务）、seam（可替换能力缝）、bundle（具体组合包）、service（独立服务）。
- **问题**：全库 grep「role: core / 四种角色 / core / seam / bundle / service」在宿主源码中无此枚举出处。「seam」一词官方有使用（authorization seam、filesystem seam、PTC execution seam、directory-picker seam，见各包 README），但「core / seam / bundle / service」四角色枚举是知识库自己的归纳，无官方类型定义支撑。
- **证据**：grep role: core / core.*seam.*bundle.*service 全库 0 命中；「seam」仅作为描述性词汇散见于包 README。

### [UNVERIFIED] 文档 L207：「ScopeKey 是不透明对象，按身份比较（原语从不检视对象内部）」

- **现文**：ScopeKey 是不透明对象，按身份比较（原语从不检视对象内部）。
- **问题**：dsh-scope 的 createScope(ctx, key, options) 中 key 由调用方传入任意对象；@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js:634-635 声明 ScopeKey = object（不透明类型 ✓）。「按身份比较」符合 WeakMap 键语义 ✓；但「原语从不检视对象内部」的表述属于对实现（scopeParents/carrierKeys WeakMap）的推断，无对应文档句。
- **证据**：@deepseek-ai/dsh-scope/lib/index.js:296-314（createScope/scopeOf）；@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js:634-635（export type ScopeKey = object）。

### [UNVERIFIED] 文档 L217：「host 与 client 不得复用同一 Cordis Context 键：TS 声明合并会同时看到两种类型」

- **现文**：host 与 client 不得复用同一 Cordis Context 键：TS 声明合并会同时看到两种类型。
- **问题**：这是知识库的工程纪律（教学性条文），宿主源码中无「禁止 host/client 同名 ctx 键」的强制实现；作为最佳实践可接受，但无法用源码验证。
- **证据**：grep host.*client.*Context 键冲突相关强制逻辑 0 命中。

其余 29 条断言（插件三种形态与 apply 入口、函数/对象/服务类插件示例、Service 构造器 (ctx, name?) 两参、无 start/stop 钩子与 [Service.init] 静态符号、构造期 ctx.effect 注册清理、name/inject/Config/Schema 要素、默认值填回副作用、可逆副作用与 fiber 跟踪、apply 闭包状态规则、peerDependencies 纪律、Context Proxy 本质、extend/isolate/intercept 语义、ctx.root/fiber/registry/reflect/events/logger 句柄、get/set/provide/accessor/mixin、ctx.timer 四助手（实际混入还含两个 deprecated 别名 setTimeout/setInterval）、ctx.plugin 返回 Fiber、ctx.inject 简写与可逆语义、ctx.effect 立即执行与逆序清理与 INACTIVE_EFFECT/TypeError 错误语义、ctx.on/once、五种事件派发方法、ctx.isolate 示例、dsh-scope 三函数签名（createScope(ctx,key,options)/scopeOf/scopeTarget(base,key)）、作用域派发机制、依赖倒置法则、单复数 ctx 键命名规则、双面插件指引）均有源码行号证据，判定 OK。