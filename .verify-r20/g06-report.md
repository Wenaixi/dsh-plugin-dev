# g06 · references/skill-provider.md + references/provider-catalog-invalidation.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：56
- OK：51
- WRONG：4
- STALE：0
- CONFLICT：0
- UNVERIFIED：1

## 逐条报告

### [WRONG] skill-provider.md L12：契约包「必须 peer 依赖，不能当 dependencies 拉进来」不成立

- **现文**：`// contract 包：@deepseek-ai/dsh-skill（seam，必须 peer 依赖，不能当 dependencies 拉进来）`
- **问题**：绝对化断言被宿主自证反例推翻。官方宿主 dsh 与 dsh-base 两个包都把 @deepseek-ai/dsh-skill 放在 dependencies（而非 peer），因为它同时是 SkillRegistry 服务实现（extends Service，super(ctx, "skills")），宿主要自己装配注册表。peer 依赖是「插件作者引用契约类型」的惯例，不是硬性规则。
- **应为**：`// contract 包：@deepseek-ai/dsh-skill（服务定义 + 注册表实现；插件通常 peer 引用以复用宿主实例，宿主 dsh/dsh-base 自身以 dependencies 兜底装配）`
- **证据**：@deepseek-ai/dsh/package.json（dependencies.@deepseek-ai/dsh-skill = "0.2.0-rc.2"）、@deepseek-ai/dsh-base/package.json 同；@deepseek-ai/dsh-skill/package.json peerDependencies = { cordis, dsh-scope, dsh-llm }（无自引）；dsh-skill/lib/index.js:132 super(ctx, "skills")。

### [WRONG] skill-provider.md L79：候选 invocation「缺省时宿主补双开」不成立

- **现文**：`| invocation | 缺省时宿主补 { modelInvocable: true, userInvocable: true } |`
- **问题**：候选路径上注册表不补默认。validateCandidate → validateInvocation(candidate.invocation) 对 undefined 直接放行（不抛错也不补）；若补了值则必须含两布尔。补双开只发生在两处，都不在宿主对 provider 候选的校验里：register() 输入构造（runtime 技能）与 filesystem frontmatter 解析。候选缺 invocation 的真实后果是 toSummary 带出 invocation: undefined，下游 isModelInvocable(summary) 读 undefined.modelInvocable 抛 TypeError——既不是「补双开」也不是「静默降级」。
- **应为**：`| invocation | 必须是含 modelInvocable/userInvocable 两布尔的对象；缺省不被拒绝也不被宿主补全（放行 undefined，下游读 invocation 会崩）。双开补全仅发生在 register() 输入与 filesystem frontmatter 缺省时 |`
- **证据**：dsh-skill/lib/index.js:457（validateInvocation 调用）、504-505（if (invocation === void 0) return;）、203-206（register 补双开）、dsh-skill-filesystem/lib/index.js:849-858（parseInvocationPolicy 缺省双开）、dsh-skill/lib/index.js:491-503（toSummary 原样带 invocation）。

### [WRONG] skill-provider.md L81：resourceBase 只写 { kind: 'directory', path }，形状写窄

- **现文**：`| resourceBase | 可选，{ kind: 'directory', path }，供技能正文解析相对资源 |`
- **问题**：契约类型 SkillResourceBase 是三种 kind 的 closed union（directory / url / opaque），渲染层 renderResourceHint 同样三分支处理。表格只写 directory 一种，会把「url / opaque 合法」的事实隐藏。
- **应为**：`| resourceBase | 可选，{ kind: 'directory', path } | { kind: 'url', url } | { kind: 'opaque', description }，供技能正文解析相对资源 |`
- **证据**：dsh-tool-cordis/lib/types/api-catalog.js:7023-7025（SkillResourceBase 声明）、dsh-skill/lib/index.js:71-81（renderResourceHint 三分支）。

### [WRONG] skill-provider.md L180：「只改 list() 会让模型目录里看不到它，但 skill 工具调用依然成功」与源码矛盾

- **现文**：`只改 list() 会让模型目录里看不到它，但 skill 工具调用依然成功，这是「看起来生效了其实没生效」的典型形态。`
- **问题**：dsh-tool-skill 的 skill 工具 execute 对 list() 返回的 summary 做第一道检查：if (!isModelInvocable(summary)) throw new Error('skill X is not available for model invocation')。只在 list() 里把 invocation 布尔改掉（不剔除条目），summary.modelInvocable 即 false，工具在第一道检查就抛错——不会「成功」。只从 list() 剔除条目则抛「unknown or no longer available」。无论哪种单改，execute 都不会成功；真正的不一致是「get() 返回未屏蔽定义」时用户显式 invocation 路径（agent/pre-step 注入）仍会生效。
- **应为**：`只改 list() 会让模型目录不可见，且 skill 工具调用同样被拦（报「该技能对当前不可见」）；只改 get() 则目录仍显示、用户显式 invocation 仍注入——两处必须按同一屏蔽表改写`
- **证据**：dsh-tool-skill/lib/index.js:145-150（summary 检查在 get 之前）、168-196（pre-step 对 get 返回定义检查 isUserInvocable）。

### [UNVERIFIED] provider-catalog-invalidation.md L30：「宿主 UI / agent-loop 订阅它去重取目录」无源码支持

- **现文**：`skills/change 是注册表「我变了」的消费方通知缝——宿主 UI / agent-loop 订阅它去重取目录。官方运行时全树零订阅者；它不是给提供者的回调。`
- **问题**：全树 grep（node_modules/@deepseek-ai 全部包 + dsh 宿主 lib，7396 个 js 文件）on("skills/change")/on('skills/change') 0 命中：dsh-client-ui-*、dsh-agent-loop、dsh-api-session-controller（sessionSkillCatalog 每次请求时重查 registry）均无订阅。notifyChange 只有 dispatch 方。「宿主 UI / agent-loop 订阅它」作为事实陈述未获本机源码证实（UI 渲染产物可能不在 asar 内），且与同句「零订阅者」语义张力。建议降格为「设计意图：为消费方（UI/模型目录）准备的广播缝」或直接删除该半句；「零订阅者」断言本身核实通过。
- **证据**：grep skills/change 全树仅 5 处（dsh-skill 的 dispatch + dsh-tool-cordis api-catalog 声明）；grep on("skills/change") 0 命中；dsh-api-session-controller/lib/index.js:2293-2307（无事件订阅，直接 list）。
