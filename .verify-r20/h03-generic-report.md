# h03 · 通用性审查报告（仓库专属细节剔除）

审查基线：六个 references 文件 vs 「通用技能知识库」定位（所有 DSH 插件开发者复用）
审查时间：2026-10-04
审查员：h03

## 结论概览

- 审查文件数：6（community-patterns / official-upstream-and-docs / debugging-and-troubleshooting / tools / multimodal-and-deliverables / slash-commands-and-input-triggers）
- WRONG-GENERIC 主条目：26（合并 L35/L43 为一条后 25）
  - community-patterns.md：13
  - official-upstream-and-docs.md：2
  - debugging-and-troubleshooting.md：6
  - tools.md：5
  - multimodal-and-deliverables.md：0
  - slash-commands-and-input-triggers.md：0
- 顺带发现（非本类别，供 Lead 参考）：2

判定原则（按任务书）：
- community-patterns.md 的**出处标注**（括号点名、表格例子列、issue 编号、「X 印证」）属第三级社区图谱证据链，保留；只有**把仓库行为写成通用结论/把仓库内部细节当示例**的句子才标。
- 官方包（@deepseek-ai/*）实现细节、版本号、官方字段（personaPrefix、SessionStartSource、rank 档位、事件名版本史等）属官方发布物，不标。
- 「0.2.0 全包 0 命中」这类针对官方包的 grep 核实结论属官方事实，不标（但重复插入见顺带 A）。

## 逐条报告

### [WRONG-GENERIC] community-patterns.md L8：图谱快照日期写死
- 现文：`> **证据强度**：本文件全部条目来自对上游仓库源码/README/patch 的直接阅读（2026-10-03 快照），属于"第三级证据"（社区实现）`
- 问题：2026-10-03 是单次快照日期，必会漂移；但这是第三级证据的取证时效声明，不冒充通用事实
- 应为：保留快照性质但去具体日期：`（最近一次快照阅读）`；若 Lead 认为证据时效声明有价值也可保留，交由 Lead 决定
- 证据：community-patterns.md:8

### [WRONG-GENERIC] community-patterns.md L15：topic 仓库数统计快照写死
- 现文：`topic:dsh-plugin 话题下 17306 个仓库里，真正是 DSH 插件的不到两成。`
- 问题：17306 是单次统计快照，GitHub topic 仓库数持续增长，精确数必然过期
- 应为：`topic:dsh-plugin 话题下的高星仓库中，真正是 DSH 插件的不到两成（精确统计随话题增长漂移，不必写死）。`
- 证据：community-patterns.md:15

### [WRONG-GENERIC] community-patterns.md L38：把 dsh-desktop 仓库内部行 id 当示例
- 现文：`dsh-desktop 的 \`- id: ui-brand-official\n  disabled: true\` 覆盖官方内置行；可选插件行要单独放一个 patch 文件（patch 引用不存在的 entry 会让 loader 每次启动都警告）。`
- 问题：ui-brand-official 是 dsh-desktop 仓库自己的行 id，读者 profile 未必有该行；后半个结论（可选行单独放 patch 文件）是通用铁律，保留
- 应为：`某桌面客户端用 \`- id: <官方内置行>\n  disabled: true\` 覆盖官方内置行；可选插件行要单独放一个 patch 文件（patch 引用不存在的 entry 会让 loader 每次启动都警告）。`
- 证据：community-patterns.md:38

### [WRONG-GENERIC] community-patterns.md L204：外部 CLI 版本号快照写死
- 现文：`外部 CLI 版本要钉下限并写明可验证的行为理由（antibrow：2.19.1 是第一个真正结束进程的版本，更老只断连接 → 浏览器残留/锁死/许可证占满）。`
- 问题：2.19.1 是某第三方 CLI 的版本快照，随该 CLI 演进失效
- 应为：`外部 CLI 版本要钉下限并写明可验证的行为理由（某浏览器桥插件实测：某版本起才真正结束进程，更老只断连接 → 残留/锁死）。`
- 证据：community-patterns.md:204

### [WRONG-GENERIC] community-patterns.md L300：实测误判的具体版本号写死
- 现文：`实测把运行中的 0.1.5-rc.3 误判成 0.1.2-rc.1。`
- 问题：具体版本号是单次实测快照，宿主迭代后版本号无意义
- 应为：`实测会把运行中的版本误判成更老的一个（版本号随宿主迭代变化，不必写死）。`
- 证据：community-patterns.md:300

### [WRONG-GENERIC] community-patterns.md L307：本机实测耗时基准写死
- 现文：`注意该 API 默认每次重读 manifest（实测 75ms/2000 条），调用方要缓存。`
- 问题：75ms/2000 条是本机单次实测基准，随机器与数据规模漂移
- 应为：`注意该 API 默认每次重读 manifest（重读有实测成本），调用方要缓存。`
- 证据：community-patterns.md:307

### [WRONG-GENERIC] community-patterns.md L398：本机解析器版本号写死
- 现文：`**js-yaml 4.3.2 实测**无引号 \`!!js !ctx.get(...)\` 抛 "duplication of a tag property"（必然解析失败）`
- 问题：4.3.2 是本机解析器版本快照，依赖升级后表述失效
- 应为：`**js-yaml 实测**无引号 \`!!js !ctx.get(...)\` 抛 "duplication of a tag property"（必然解析失败）`
- 证据：community-patterns.md:398

### [WRONG-GENERIC] community-patterns.md L611：本机单次性能实测数值写死
- 现文：`子进程二进制缺失是**静默性能悬崖**（npx 回退 3.6-6.5s/tap vs 57ms）→ 启动时探测 + warn`
- 问题：3.6-6.5s/57ms 是本机单次实测，机器与工具链不同则不同
- 应为：`子进程二进制缺失是**静默性能悬崖**（npx 回退比原生慢一个数量级以上）→ 启动时探测 + warn`
- 证据：community-patterns.md:611

### [WRONG-GENERIC] community-patterns.md L661：同数值第二次出现
- 现文：`npx 兜底是 60 倍性能悬崖（3.6-6.5s vs 57ms）启动时大声警告。`
- 问题：同 L611，本机单次实测数值，两处应同步泛化
- 应为：`npx 兜底可能是数十倍性能悬崖，启动时大声警告。`
- 证据：community-patterns.md:661

### [WRONG-GENERIC] community-patterns.md L697：点名具体第三方借用包名
- 现文：`@deepseek-ai/dsh-client-ui-voice 是第三方借用官方命名空间的包——判定插件归属看实际仓库（owner/repo + 发布者），不能只看包名。`
- 问题：点名具体第三方包名，该包可能改名/下架；通用结论在后半句
- 应为：`第三方插件可能借用官方命名空间发布（如 @deepseek-ai/* 下的非官方包）——判定插件归属看实际仓库（owner/repo + 发布者），不能只看包名。`
- 证据：community-patterns.md:697

### [WRONG-GENERIC] community-patterns.md L789：协议版本矩阵数量写死
- 现文：`包装宿主工具前先枚举支持版本矩阵（19 个）+ DSH_PACKAGES 清单 + 窄包装白名单`
- 问题：19 是某仓库当前枚举快照，随宿主协议演进漂移
- 应为：`包装宿主工具前先枚举支持版本矩阵（数量随宿主版本演进，勿写死）+ DSH_PACKAGES 清单 + 窄包装白名单`
- 证据：community-patterns.md:789

### [WRONG-GENERIC] community-patterns.md L820：私有 env 变量名写死
- 现文：`无 Config 合法（env 逃生口 DSH_AGY_DISABLE）`
- 问题：DSH_AGY_DISABLE 是 agy 仓库的私有 env 名，对读者无意义
- 应为：`无 Config 合法（env 逃生口，如 <插件>_DISABLE 类自有变量）`
- 证据：community-patterns.md:820

### [WRONG-GENERIC] community-patterns.md L824：依赖数量快照写死
- 现文：`零运行时依赖的插件全用 type-only import（9 个类型增强包）`
- 问题：9 是具体仓库依赖数量快照，随项目变化
- 应为：`零运行时依赖的插件全用 type-only import（类型增强包数量随项目而异）`
- 证据：community-patterns.md:824

### [WRONG-GENERIC] official-upstream-and-docs.md L85：表格里点名两个第三方插件
- 现文：`| Profile 本地 | DSH_HOME/profiles/<profile>/node_modules/ | 该 profile 自行安装的包，如 dsh-better-sidebar、dsh-plugin-wallpaper-engine 等界面与增强插件 |`
- 问题：dsh-better-sidebar / dsh-plugin-wallpaper-engine 是本机 profile 安装的具体第三方包，读者环境未必有
- 应为：`| Profile 本地 | DSH_HOME/profiles/<profile>/node_modules/ | 该 profile 自行安装的第三方插件（界面、增强类） |`
- 证据：official-upstream-and-docs.md:85（grep "dsh-better-sidebar" / "dsh-plugin-wallpaper" 命中）

### [WRONG-GENERIC] official-upstream-and-docs.md L89：写死本机 npm 全局根路径
- 现文：`C:\Users\<用户名>\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`
- 问题：写死本机 Windows npm 全局根，不同安装方式/平台/前缀位置不同
- 应为：`npm 全局根（\`npm root -g\` 查询；Windows 默认 %APPDATA%\npm\node_modules）下的 @deepseek-ai/dsh/node_modules/@deepseek-ai/`
- 证据：official-upstream-and-docs.md:87-89

### [WRONG-GENERIC] debugging-and-troubleshooting.md L35、L43：示例命令固化本机 profile 名 web
- 现文：L35 `dsh --profile web --patch C:/path/to/my-plugin/cordis.patch.yml`；L43 `dsh plugin --profile web add C:/path/to/my-plugin`
- 问题：web 是本机 profile 名，读者 profile 名可能不同
- 应为：`dsh --profile <name> --patch <本地插件目录>/cordis.patch.yml`；`dsh plugin --profile <name> add <本地插件目录>`
- 证据：debugging-and-troubleshooting.md:35,43

### [WRONG-GENERIC] debugging-and-troubleshooting.md L52：示例路径固化 C:\Temp
- 现文：`$env:DSH_HOME = "C:\Temp\dsh-dev-sandbox"`
- 问题：示例路径固化，应使用占位符（低优先级，占位性质尚可）
- 应为：`$env:DSH_HOME = "<临时目录>"`
- 证据：debugging-and-troubleshooting.md:52

### [WRONG-GENERIC] debugging-and-troubleshooting.md L120：点名三个第三方插件包
- 现文：`可对照的社区实现（非 \`@deepseek-ai\` 官方发布）：\`dsh-better-sidebar\`、\`dsh-plugin-wallpaper-engine\`、\`@linxin666/dsh-client-ui-git-graph\`。`
- 问题：点名三个具体第三方包（含个人 scope @linxin666），包可改名/下架，BRIEF 类别 1 靶子
- 应为：`可对照的社区实现（非 \`@deepseek-ai\` 官方发布，如某侧边栏增强、某壁纸引擎、某 git 图插件）。`
- 证据：debugging-and-troubleshooting.md:120（grep "@linxin666" 命中）

### [WRONG-GENERIC] debugging-and-troubleshooting.md L200：本机单次实测写入正文
- 现文：`本机实测 \`cfg.err\` 为 0 字节、\`cfg.log\` 只是一次 \`--dump-config\` 残留的 YAML 树——不要拿它们当诊断入口。`
- 问题：本机单次实测快照，其他机器/版本文件状态可能不同；「无官方写入者（grep 0 命中）」是可靠结论应保留
- 应为：`\`cfg.log\`/\`cfg.err\` 没有任何官方写入者（grep 全库 0 命中）；实测中它们或为空或仅 --dump-config 残留——不要拿它们当诊断入口。`
- 证据：debugging-and-troubleshooting.md:200

### [WRONG-GENERIC] debugging-and-troubleshooting.md L296：本机 desktop 快照冗余
- 现文：`compatibility.json # 精确版本豁免表（**首次执行 allow-version 后才生成**，默认不存在；本机 desktop 无此文件）`
- 问题：本机 desktop 快照，且前文已说「默认不存在」，属冗余本机证据
- 应为：`compatibility.json # 精确版本豁免表（**首次执行 allow-version 后才生成**，默认不存在）`
- 证据：debugging-and-troubleshooting.md:296

### [WRONG-GENERIC] tools.md L104：本机注册快照写入归属表
- 现文：`（默认 \`toolName=subagent\`；本机注册 \`subagent\`=provider \`spawn\` 与 \`subagent_fork\`=provider \`fork\`，另有两个 disabled 实例）`
- 问题：本机 profile 运行时注册快照，其他环境不同
- 应为：`（默认 \`toolName=subagent\`；默认注册 \`subagent\`=provider \`spawn\` 与 \`subagent_fork\`=provider \`fork\`，另有两个 disabled 实例）`
- 证据：tools.md:104

### [WRONG-GENERIC] tools.md L114：本机 desktop profile 状态写入归属表
- 现文：`（**实验性包**，需挂载配套组合包；本机 desktop profile 已注册）`
- 问题：本机 profile 状态，非通用契约
- 应为：`（**实验性包**，需挂载配套组合包方可使用）`
- 证据：tools.md:114

### [WRONG-GENERIC] tools.md L115：本机 profile 的 disabled 状态写入归属表
- 现文：`长周期目标续跑工具（本机 desktop profile 中该条目 \`disabled: true\`，故当前会话不可用）`
- 问题：把本机 profile 的 disabled 状态写进通用工具归属表，读者环境状态不同（不能断言官方默认 disabled）
- 应为：`长周期目标续跑工具（条目是否启用取决于 profile 配置，与 tools 契约本身无关）`
- 证据：tools.md:115

### [WRONG-GENERIC] tools.md L116：本机配置快照写入归属表
- 现文：`（本机 \`tool-subagent\` 配置 \`modelSelectionSettings: true\` 时注册）`
- 问题：本机配置快照
- 应为：`（\`tool-subagent\` 配置 \`modelSelectionSettings: true\` 时注册）`
- 证据：tools.md:116

### [WRONG-GENERIC] tools.md L117-118：modsearch 桥「本机注入」措辞
- 现文：`| \`read_page\` | \`@liustack/modsearch\` 桥（非 @deepseek-ai 官方包） | 读取单页网页内容（本机由运行时注入，官方发布物无此包） |`（x_search 同）
- 问题：桥本身属第三方（已正确标注，保留）；「本机由运行时注入」暗示单机快照，桥是否注入取决于宿主版本
- 应为：`（第三方 modsearch 桥，由宿主运行时按版本注入；非 @deepseek-ai 官方发布物）`
- 证据：tools.md:117-118（grep "modsearch" 命中）

## 顺带发现（非通用性类别，供 Lead 参考）

### [质量] community-patterns.md L151、L374（及 L74）：同一句核实结论被重复插入三次，两次插在句中破坏可读性
- L74 完整句尚通顺；L151 插在「需 agent/created（payload 恒带 source: 'startup'|'resume'|'clear'|'compact'，按 source 值判而非 'source' in payload）；SessionStartSource = 'startup'|'resume'|'clear'|'compact'）——agent/session/created 是旧版事件名，0.2.0 全包 0 命中」之后、L374 完全相同，均为复制粘贴残留，应只保留 L74 一处，L151/L374 恢复原句。
- 证据：community-patterns.md:74,151,374

### [CONFLICT] official-upstream-and-docs.md L132 与 L17 自相矛盾
- L132 写「本地 lib/index.js 与 lib/index.d.ts 真实实现」，L17 写「发布物 lib/index.js 内联 JSDoc 与 lib/types/*.js；多数包无 .d.ts（types 字段指向不存在的 lib/types/*.d.ts）」——证据强度图里应删去 lib/index.d.ts。
- 证据：official-upstream-and-docs.md:17,132
