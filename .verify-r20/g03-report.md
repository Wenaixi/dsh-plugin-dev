# g03 · references/config.md

核实基线：DSH 0.2.0-rc.2（asar 真源码）+ 本机 desktop/web profile 运行时配置
核实时间：2026-10-04

## 结论概览

- 核实断言总数：36
- OK：30
- WRONG：1
- STALE：0
- CONFLICT：0
- UNVERIFIED：5

## 逐条报告

### [WRONG] 文档 L134-150：Web Profile 官方生效的 14 个 Bundles 清单与实际不符

- **现文**：在当前最新的生产基准（2026-10-01）中，Web profile 包含以下 14 个标准组合包：1. @deepseek-ai/dsh-base；2. @deepseek-ai/dsh-web-app；3. dshmarket；4. dsh-context；5. dsh-better-sidebar；6. @wenaixi/dsh-ponytail；7. @wenaixi/dsh-superpower；8. dsh-prompt-history；9. @linxin666/dsh-client-ui-git-graph；10. dsh-plugin-wallpaper-engine；11. @deepseek-ai/dsh-experimental-agent-team-profile；12. @deepseek-ai/dsh-experimental-voice-input-bundle；13. @deepseek-ai/dsh-experimental-schedule-bundle；14. @liustack/modsearch
- **问题**：本机 web profile 实际 dsh.profile.bundles 共 14 项，数量一致但内容差两项：第 12 项 @deepseek-ai/dsh-experimental-voice-input-bundle 不在 web profile bundle 列表中（它属于 @deepseek-ai/dsh-app-boot 的 OPTIONAL_BUNDLES——随安装提供、默认关闭、由插件管理器开启的可选组合包）；文档漏掉了实际生效的 @wenaixi/cfbridge。
- **应为**：第 12 项替换为 @wenaixi/cfbridge，并注明 voice-input-bundle 属可选组合包（OPTIONAL_BUNDLES）默认不启用；或把 11-14 改为实际 14 项（base / web-app / dshmarket / dsh-context / dsh-better-sidebar / @wenaixi/dsh-superpower / dsh-prompt-history / @linxin666/dsh-client-ui-git-graph / dsh-plugin-wallpaper-engine / @deepseek-ai/dsh-experimental-agent-team-profile / @deepseek-ai/dsh-experimental-schedule-bundle / @liustack/modsearch / @wenaixi/dsh-ponytail / @wenaixi/cfbridge）。
- **证据**：C:/Users/Administrator/.dsh/profiles/web/package.json 的 dsh.profile.bundles（14 项，含 @wenaixi/cfbridge，不含 voice-input-bundle）；@deepseek-ai/dsh-app-boot/lib/index.js:552-557（OPTIONAL_BUNDLES 含 @deepseek-ai/dsh-experimental-voice-input-bundle）。

### [UNVERIFIED] 文档 L113-121：包管理器避坑「npm 替代 pnpm」

- **现文**：使用 --legacy-peer-deps 压制非致命 ERESOLVE 警告，npm 默认采用扁平化 node_modules 结构，解析极速且零 OOM；L114「官方 @deepseek-ai/dsh 元包会递归带出 250+ 官方子包」。
- **问题**：--legacy-peer-deps 在 asar 全库（含 dsh/docs 目录与 dsh 包 README）grep 零命中；@deepseek-ai/dsh 的 package.json 直接依赖仅 82 项（其中 @deepseek-ai/* 79 项），「250+ 子包」「官方推荐 npm install --legacy-peer-deps」均无官方出处，属第三方运维经验而非宿主规范。
- **证据**：grep --legacy-peer-deps 全库（@deepseek-ai/* + dsh/docs）0 命中；@deepseek-ai/dsh/package.json dependencies 共 82 项。

### [UNVERIFIED] 文档 L124：「装载前的条目预检」

- **现文**：组合阶段的 bundle 预检 + 装载前的条目预检。
- **问题**：bundle 层预检（evaluatePluginCompatibility）有证据；但「装载前的条目预检」在 cordis-plugin-loader / cordis-plugin-include 的 lib 源码中无 peer 兼容性检查实现（两包仅 package.json 声明自己的 peerDependencies），条目装载本身不做 DSH peer 校验。
- **证据**：@deepseek-ai/cordis-plugin-loader/lib/index.js 与 @deepseek-ai/cordis-plugin-include/lib/index.js 全文 grep evaluatePluginCompatibility / peerDependencies 仅命中各自 package.json。

### [UNVERIFIED] 文档 L164 后半：「运行时 Seam 字段在配置 Schema 中被显式剔除」

- **现文**：运行时 Seam 字段在配置 Schema 中被显式剔除，无法通过静态 cordis.yml 进行持久化配置，必须由插件动态装载。
- **问题**：schema 生成器（dsh-app-boot / dsh-config-editor / dsh/lib）中 grep seam 零命中，未找到「显式剔除 Seam 字段」的实现；该句可能指知识库自己的 Seam 归纳而非宿主配置 Schema 的官方行为。
- **证据**：grep seam @deepseek-ai/dsh-app-boot/lib、@deepseek-ai/dsh-config-editor/lib、@deepseek-ai/dsh/lib 0 命中。

### [UNVERIFIED] 文档 L105-111 第 3 步：鉴权 URL 与 Cookie 断言

- **现文**：dsh web: http://127.0.0.1:3080/?token=<auth-token>；带 token 请求根路径必须返回 303 重定向并设置 dsh-auth-* Cookie；带 Cookie 请求必须返回 200 text/html。
- **问题**：部分有证据（默认端口 3080：@deepseek-ai/dsh-web-app/cordis.patch.yml:174 port: !!js ctx.webStartup.port ?? 3080；303 + dsh-auth- 前缀 Cookie：@deepseek-ai/dsh-client-connection/lib/index.js:403-408 writeHead(303, ..., set-cookie ...) 与 L227 COOKIE_PREFIX = dsh-auth-）。但「启动输出打印 ?token=<auth-token> URL」在 asar 内无对应文案（grep token=? 0 命中），无法确认启动日志格式；「带 Cookie 请求返回 200 text/html」取决于调用方（authorizeIndex 仅放行），非本包可证。
- **证据**：303/Cookie 前缀已证；token URL 文案 grep token=? 全库 0 命中。

其余 30 条断言（四层叠加顺序与全量替换语义、insert 带 id 需 group、!!js new Function with(ctx) 求值形态、disabled 表达式失败进 inactiveEntries 启动警告、settings.yaml 一次性导入与改名时序、dump-config 组合阶段跑 bundle 预检且不 eval !!js、dump-config-schema 执行顶层代码、startup failed 文案、bundle 不兼容跳过写 stderr、allow-version/revoke-version/version-exemptions 豁免族与 compatibility.json、SettingsService 四方法与 ConfigEditor 文件锁、描述符八字段、volatileForm 仅含 volatile 字段、三种写入语义、乐观修订号、internal/config 瀑布入参为 raw config、Schema 默认值吃掉未设置、数据根纪律、生成器目录约束）均有源码行号证据，判定 OK。