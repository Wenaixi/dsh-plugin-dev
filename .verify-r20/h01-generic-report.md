# h01 · 通用性审查报告（SKILL.md / README.md / references/README.md）

核实基线：DSH 0.2.0-rc.2（官方发布物版本，不在本轮剔除范围）
核实时间：2026-10-04
审查类型：R20 通用性专项（仓库专属细节剔除），非 API 核实

## 结论概览

- 审查断言总数：3 份文件通读 + 全量关键词 grep 复核
- WRONG-GENERIC：6（第三方点名 1 / 本机路径快照 1 / 日期与实测快照 2 / profile 专属配置 2）
- 保留判断（官方发布物 / 仓库门面，不标）：3
- 已确认非问题的靶子：SKILL.md 七之二无 3080 与 desktop 残留；本机版本号（node/pnpm/python 具体版本）全库零命中；L382 allow-version 示例已用 `<profile>` 占位符

## 逐条报告

### [WRONG-GENERIC] SKILL.md L330：Playwright 示例写死本机 Chrome 可执行文件绝对路径

- **现文**：`executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",`
- **问题**：这是本机（Windows 默认安装位）的环境快照。Linux/macOS、便携版 Chrome、其他浏览器或换机后该路径即失效；通用技能不应把单机路径写成规范。
- **应为**：改为「环境变量覆盖 + 注释说明」形态，如：
  `executable_path=os.environ.get("CHROME_PATH") or r"C:\Program Files\Google\Chrome\Application\chrome.exe",`
  并在正文说明：DSH 自带 Playwright 不含浏览器二进制，executable_path 应指向本机已安装浏览器（Windows 默认 Chrome 安装位仅为兜底，跨平台用 `CHROME_PATH` 等环境变量指定）。
- **证据**：SKILL.md:330（grep "chrome" / "Program Files" 命中同 1 行）

### [WRONG-GENERIC] SKILL.md L70/L74：五步工作流示例把本机 profile 名 web 写进通用命令

- **现文**：L70 `dsh --profile web --patch ./my-plugin/cordis.patch.yml`；L74 `dsh --profile web --dump-config`
- **问题**：profile 名（web/desktop 或其他）是本机安装实例的命名快照；不同机器 profile 名不同，写成 web 会把「本机配置」当通用规范。L310 的 `dsh <profile>` 占位写法才是通用形态，本文件内部即不一致。
- **应为**：两处统一改为 `dsh --profile <profile> --patch ./my-plugin/cordis.patch.yml` 与 `dsh --profile <profile> --dump-config`（profile 名按本机实际取值，下文已用 `<profile>` 占位符之处不变）。
- **证据**：SKILL.md:70、SKILL.md:74（grep "--profile web" 命中）

### [WRONG-GENERIC] README.md L66/L69：快速开始示例把本机 profile 名 web 写进通用命令

- **现文**：L66 `dsh plugin --profile web add ./path/to/my-plugin`；L69 `dsh --profile web --dump-config`
- **问题**：同 SKILL.md L70/L74；README 是面向所有读者的门面，profile 名不应写死。
- **应为**：`dsh plugin --profile <profile> add ./path/to/my-plugin` 与 `dsh --profile <profile> --dump-config`。
- **证据**：README.md:66、README.md:69（grep "--profile web" 命中）

### [WRONG-GENERIC] references/README.md L38：索引点名「三大明星插件（终端输入、侧边卡片、壁纸引擎）」

- **现文**：「源码级解密三大明星插件（终端输入、侧边卡片、壁纸引擎）的真实注入代码」
- **问题**：「三大明星插件」指代的是某次实测时点的具体第三方插件组合，读者在新环境无法对应到具体包，属单次实测快照式点名；「壁纸引擎」还带第三方插件名联想（dsh-plugin-wallpaper-engine）。
- **应为**：泛化为「源码级解密多个代表性第三方插件的真实注入代码（覆盖终端输入、侧边卡片、壁纸等形态）」。
- **证据**：references/README.md:38（grep "三大明星" / "壁纸" / "终端输入" 命中）

### [WRONG-GENERIC] references/README.md L107：社区图谱条目写死「约 100 个，2026-10 快照」

- **现文**：「由 GitHub topic:dsh-plugin 高星仓库（约 100 个，2026-10 快照）逐一分析蒸馏的」
- **问题**：仓库数量与取样日期是单次实测快照，后续读者无法验证，且会随社区增长漂移。
- **应为**：删去快照数字与日期：「由 GitHub topic:dsh-plugin 高星仓库逐一分析蒸馏的」，或保守写作「（截至撰写时约 100 个）」。
- **证据**：references/README.md:107（grep "2026" / "快照" 命中）

### [WRONG-GENERIC] references/README.md L126：重构经验条目带增补日期与本机门禁计数

- **现文**：「2026-10-04 增补：……门禁计数随环境（本机 85 / CI 84 类）文档要注明口径或直接不写数字」
- **问题**：增补日期是历轮档案痕迹（非知识内容），「本机 85 / CI 84」是本机环境计数快照，会随环境漂移；该句本身已主张「不写数字」，自相矛盾。
- **应为**：去掉「2026-10-04 增补：」前缀；计数句改为「门禁计数随环境不同（如某台机器 85 类、CI 84 类），文档要注明口径或直接不写数字」。
- **证据**：references/README.md:126（grep "2026" / "本机" 命中）

## 保留判断（不标 WRONG）

- DSH 0.2.0-rc.2 / Cordis 4.0.4 版本表述（SKILL.md L3/L17、README.md L7-L8、references/README.md L1 等）：官方发布物版本号，属官方发布信息，不算仓库专属；版本基线更新属知识层职责（见 CLAUDE.md 三-6）。
- README.md L4-L15 徽章与 L77「基于 omdsh-dev/dsh-plugin-dev」：仓库自身门面声明，不构成对读者的规范断言，不影响通用性，保留。
- references/README.md L67「desktop profile 的 Electron 独占守卫」与 SKILL.md L193「桌面版」：desktop 指桌面版运行时形态（通用结论），非本机 profile 名快照，保留。
- references/README.md L107「每条经验带出处仓库」：是 community-patterns.md 的取证方法属性（第三级证据），非正文点名，保留（仅快照数字与日期需泛化，见上）。
- SKILL.md L310/L313/L321 的 `dsh <profile>` 与 `127.0.0.1:<port>`：已用占位符，正确。
- SKILL.md L384/L411「pnpm 24 小时发布冷却期」：pnpm 包管理器行为描述（非本机快照），保留。
