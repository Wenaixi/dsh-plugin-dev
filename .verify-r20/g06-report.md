# g06 · references/skill-provider.md + references/provider-catalog-invalidation.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：64
- OK：57
- WRONG：4
- STALE：0
- CONFLICT：0
- UNVERIFIED：3

## 逐条报告

### [WRONG] skill-provider.md L12：契约包「必须 peer 依赖，不能当 dependencies 拉进来」不成立

- **现文**：`// contract 包：@deepseek-ai/dsh-skill（seam，必须 peer 依赖，不能当 dependencies 拉进来）`
- **问题**：绝对化断言被宿主自证反例推翻。官方宿主 dsh 与 dsh-base 两个包都把 @deepseek-ai/dsh-skill 放在 dependencies（而非 peer），因为它同时是 SkillRegistry 服务实现（extends Service，super(ctx, "skills")），宿主要自己装配注册表。peer 依赖是「插件作者引用契约类型」的惯例，不是硬性规则。
- **应为**：`// contract 包：@deepseek-ai/dsh-skill（服务定义 + 注册表实现；插件通常 peer 引用以复用宿主实例，宿主 dsh/dsh-base 自身以 dependencies 兜底装配）`
- **证据**：@deepseek-ai/dsh/package.json 与 @deepseek-ai/dsh-base/package.json 的 dependencies["@deepseek-ai/dsh-skill"] = "0.2.0-rc.2"（peerDependencies 无此项）；@deepseek-ai/dsh-skill/package.json peerDependencies = { cordis ~4.0.4, dsh-scope 0.2.0-rc.2, dsh-llm 0.2.0-rc.2 }（无自引）；dsh-skill/lib/index.js:132 super(ctx, "skills")。

### [WRONG] skill-provider.md L79：候选 invocation「缺省时宿主补双开」不成立

- **现文**：`| invocation | 缺省时宿主补 { modelInvocable: true, userInvocable: true } |`
- **问题**：候选路径上注册表不补默认。validateCandidate → validateInvocation(candidate.invocation) 对 undefined 直接放行（不抛错也不补）；若补了值则必须含两布尔。补双开只发生在两处，都不在宿主对 provider 候选的校验里：register() 输入构造（runtime 技能）与 filesystem frontmatter 解析。候选缺 invocation 的真实后果是 toSummary 带出 invocation: undefined，下游 isModelInvocable(summary) 读 undefined.modelInvocable 抛 TypeError——既不是「补双开」也不是「静默降级」。
- **应为**：`| invocation | 必须是含 modelInvocable/userInvocable 两布尔的对象；缺省不被拒绝也不被宿主补全（放行 undefined，下游读 invocation 会崩）。双开补全仅发生在 register() 输入与 filesystem frontmatter 缺省时 |`
- **证据**：dsh-skill/lib/index.js:457（validateInvocation 调用）、504-505（if (invocation === void 0) return;）、203-206（register 补双开）、dsh-skill-filesystem/lib/index.js:849-858（parseInvocationPolicy 缺省双开）、dsh-skill/lib/index.js:491-503（toSummary 原样带 invocation）。

### [WRONG] skill-provider.md L81：resourceBase 只写 { kind: 'directory', path }，形状写窄

- **现文**：`| resourceBase | 可选，{ kind: 'directory', path }，供技能正文解析相对资源 |`
- **问题**：契约类型 SkillResourceBase 是三种 kind 的 closed union（directory / url / opaque），渲染层 renderResourceHint 同样三分支处理。表格只写 directory 一种，会把「url / opaque 合法」的事实隐藏。
- **应为**：`| resourceBase | 可选，{ kind: 'directory', path } | { kind: 'url', url } | { kind: 'opaque', description }，供技能正文解析相对资源 |`
- **证据**：dsh-tool-cordis/lib/types/api-catalog.js:7023-7025（SkillResourceBase 三支 union 声明）；dsh-skill/lib/index.js:71-81（renderResourceHint 三分支）。

### [WRONG] skill-provider.md L180：「只改 list() 会让模型目录里看不到它，但 skill 工具调用依然成功」与源码矛盾

- **现文**：`只改 list() 会让模型目录里看不到它，但 skill 工具调用依然成功，这是「看起来生效了其实没生效」的典型形态。`
- **问题**：dsh-tool-skill 的 skill 工具 execute 对 list() 返回的 summary 做第一道检查：if (!isModelInvocable(summary)) throw new Error('skill X is not available for model invocation')。只在 list() 里把 invocation 布尔改掉（不剔除条目），summary.modelInvocable 即 false，工具在第一道检查就抛错——不会「成功」。只从 list() 剔除条目则抛「unknown or no longer available」。无论哪种单改，execute 都不会成功；真正的不一致是「get() 返回未屏蔽定义」时用户显式 invocation 路径（agent/pre-step 注入）仍会生效。
- **应为**：`只改 list() 会让模型目录不可见，且 skill 工具调用同样被拦（报「该技能对当前不可见」）；只改 get() 则目录仍显示、用户显式 invocation 仍注入——两处必须按同一屏蔽表改写`
- **证据**：dsh-tool-skill/lib/index.js:145-150（summary 检查在 get 之前）、168-196（pre-step 对 get 返回定义检查 isUserInvocable）。

### [UNVERIFIED] skill-provider.md L109：「宿主在选择候选之后还会再检查一次取消，并把加载过程与取消赛跑」的「赛跑」实现细节

- **现文**：`宿主在选择候选之后还会再检查一次取消，并把加载过程与取消赛跑，以免不合作的 provider 拖死调用方。`
- **问题**：waitWithAbort 把加载 promise 与 abort 事件竞速（dsh-skill/lib/index.js:525-545）是「赛跑」的机制本体；「选择候选之后还会再检查一次取消」指 get() L253（throwIfAborted 在 collect 后）。两半都有源码，但「以免不合作的 provider 拖死调用方」只兑现到「让调用方立即 settle」，后台仍在跑的 provider 无法终止（README.zh L139 自述）。断言语义 OK，仅「拖死」字面需注意是调用方等待而非 provider 本身。
- **证据**：dsh-skill/lib/index.js:250-264（get 内 collect 后 throwIfAborted）、525-545（waitWithAbort 竞速）。

### [UNVERIFIED] provider-catalog-invalidation.md L76：watcher / fs/observed 的触发源列举

- **现文**：`目录变更由 filesystem provider 自调 control.invalidate()（chokidar / fs/observed），注册表再广播给消费方。`
- **问题**：官方 filesystem 包的 watcher 事件经 queueInvalidation 合并后确实调用注册表级 invalidate（dsh-skill-filesystem/lib/index.js:462-471）；fs/observed 也确由 dsh-tool-fs / dsh-tool-str-replace-editor 的 write/edit 工具 emit（dsh-tool-fs/lib/index.js:206,360,590,743,1031；dsh-tool-str-replace-editor/lib/index.js:76,134,152,184,218），filesystem 在 ctx.on("fs/observed") 中过滤 write/edit 并 invalidate（L57-60、L564-568）。断言成立。「chokidar / fs/observed」的列举与源码一致。
- **证据**：dsh-skill-filesystem/lib/index.js:57-60、462-471、564-568；dsh-tool-fs/lib/index.js:206/360/590/743/1031；dsh-tool-str-replace-editor/lib/index.js:76/134/152/184/218。

### [UNVERIFIED] provider-catalog-invalidation.md L30 后半：「宿主 UI / agent-loop 订阅它去重取目录」无源码支持

- **现文**：`skills/change 是注册表「我变了」的消费方通知缝——宿主 UI / agent-loop 订阅它去重取目录。官方运行时全树零订阅者；它不是给提供者的回调。`
- **问题**：全树 grep（@deepseek-ai 全部包 + dsh 宿主，约 12400 文件）skills/change 仅 4 处：dsh-skill/lib/index.js:404 广播、dsh-skill README×2、dsh-tool-cordis api-catalog 声明。on("skills/change") 订阅点官方树 0 命中：dsh-client-ui-*、dsh-agent-loop、dsh-api-session-controller（sessionSkillCatalog 每次请求时直接重查 registry，无事件订阅）均未订阅。「宿主 UI / agent-loop 订阅它」作为事实陈述未获本机源码证实（且与同句「零订阅者」语义张力）；但本机 desktop profile 第三方插件确有订阅（@wenaixi/cfbridge/lib/cfbridge.js:656、@wenaixi/dsh-ponytail/lib/ponytail.js:133、@wenaixi/dsh-superpower/lib/superpowers.js:120），证明该事件确实可用。建议把「宿主 UI / agent-loop 订阅它去重取目录」降格为「设计意图：为消费方准备的广播缝」或删除该半句；「零订阅者（官方树）」断言本身核实通过。
- **证据**：grep skills/change 全 asar 4 处、on("skills/change") 官方树 0 命中；desktop profile 第三方 3 处订阅；dsh-api-session-controller/lib/index.js:2293-2307（无事件订阅，直接 list）。

## 附：重点靶子逐项结论（无需逐条展开的部分）

以下断言均核实通过（OK），此处仅列靶子与关键证据锚点：

1. registerProvider 同步工厂返回 Cordis effect disposer：dsh-skill/lib/index.js:147-183（create(control) 同步调用 L159；返回 layers.effect 的 disposer L164-178；dispose 时 undo+abort，ScopedLayers.effect onChange → invalidateCache）。
2. SkillProvider 只有 list/get 两方法：README.zh L82「list() 返回候选项、get() 加载正文」；registerProvider 还要求 provider.name（L160）；实现类另有内部方法不属契约。
3. 候选必填字段校验：name 正则 L17 / isSkillName L29-31 / validateCandidate L453-454；description 非空 L455-456；rank 有限 L460；invocation 形态 L457+L504-510；candidate.provider 必须等于提供方名 L461-462。
4. rank 小者胜：compareIndexedCandidates L519-521 升序（rank → providerOrder → localOrder），collectLayer L314 排序后 L319-322 seen.has 去重先到占位。
5. 六类根 rank 表：dsh-skill-filesystem L21-25 常量（100/200/300/400/500）+ BUNDLED_SKILL_RANK=600（dsh-skill L23）；roots() L150-188 与 source 名一一对应；projectRoot 最近含 .git 祖先 L807-815。
6. RUNTIME_RANK 250 L21、RUNTIME_PROVIDER "runtime" L20+L161 保留名、register() 同层同名先到先得加 warn L193-200。
7. complete:false 语义：数组=完整 L414-418；对象带 complete:false 不进缓存（collect L288-295 仅 cacheable 时 set；collectFresh L298-311 任一 !cacheable → 整体 false）；watcher 启动失败才 complete:false（filesystem list L93-108，discoverRoot 非缺失错误另经注册表 L350-355 捕获也为不完整，README.zh L85/L150 表述一致）；目录缺失返回空数组=完整空状态 L620-627/L639-651。
8. AbortSignal 贯穿：throwIfAborted L547-549、waitWithAbort L525-545（get L256 竞速 + L253 复查）、filesystem readSkillText L709-727 透传 signal 且 AbortError 继续抛、循环体内探测（README.zh L139 不响应取消的 provider 无法终止）。
9. 屏蔽技能唯一通道=覆盖 invocation 布尔而非 filter：skill 工具 execute 对 summary/definition 双查 isModelInvocable（dsh-tool-skill L145-150）；pre-step 对 get 结果查 isUserInvocable（L181-184）；invocation 是四种组合全保留（README.zh L55-62）。
10. 双失效（control.invalidate 加自清快照）：filesystem 自调 control.invalidate（L80 watchManager 构造 + L462-471）；第三方 superpowers 提供 live 样本（L84-87 invalidate() = control.invalidate + catalog.invalidate；L120-128 双事件监听）。
11. provider-catalog-invalidation.md：notifyChange 零 payload L403-412（dispatch("emit", ["skills/change"]) 无参数）；监听器内反向 invalidate 同步递归栈溢出成立（notifyChange try/catch 只吞监听器自身错误 L404-411，不抑制重入；control.invalidate 守卫只查注册存活 L151-157）；registerProvider 工厂返回值捕获（PC L52-68 正反例与 dsh-skill L159 一致）；filesystem roots 与 watcher 关系（roots L150-188、observeRoots L205-238、evictedProject 才 invalidate L237、queueInvalidation 微任务合并 L462-471）。

## 取证说明

- read 工具对 asar 路径抛 BigInt 绑定错误，全部源码取证经 run_code 内 node:fs 直接读取 asar 内文件完成；行号以实际读取内容为准。
- 被核实文档未做任何修改；本报告之外未创建任何文件（仅读取 .verify-r20/g06-report.md 以登记写前置）。
