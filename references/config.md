# DSH 运行时配置与补丁系统权威指南 (DSH 0.2.0-rc.2)

本文件是 DeepSeek Harness (DSH 0.2.0-rc.2) 配置补丁系统、生效落点、动态表达式求值与运维避坑的官方权威规范。

---

## 目录

- [一、配置系统重大废弃警告](#一配置系统重大废弃警告)
- [二、权威四层叠加落点与全量替换语义](#二权威四层叠加落点与全量替换语义)
- [三、补丁语法与动态表达式规范](#三补丁语法与动态表达式规范)
- [四、权威工程运维与避坑准则](#四权威工程运维与避坑准则)
- [五、Web Profile 官方生效的14 个 Bundles 清单](#五web-profile-官方生效的-14-个-bundles-清单)
- [六、生成器目录规则 (Generator Catalogs)](#六生成器目录规则-generator-catalogs)
- [七、设置表单与配置持久化](#七设置表单与配置持久化)
- [八、多来源优先级与可诊断化](#八多来源优先级与可诊断化)

---

## 一、配置系统重大废弃警告

> **绝对严禁教导用户修改 `$DSH_HOME/settings.yaml`！**
> 该文件在 DSH 0.1.7+ 中已彻底废弃。DSH 启动时会自动将其重命名为 `settings.yaml.imported` 并不再生效。
> 所有插件的增删改查一律通过 `cordis.patch.yml` 声明！

---

## 二、权威四层叠加落点与全量替换语义

代码级真源（见 `@deepseek-ai/dsh-app-boot` 的 `readProfilePatches` 函数）规定补丁严格按以下顺序自底向上逐层求值与覆盖：

1. **组合包自带补丁 (Bundles declared patches)**：
   按所在 profile 的 `package.json` 中 `dsh.profile.bundles` 声明的列表顺序逐个加载；
2. **Profile 本地补丁**：
   `$DSH_HOME/profiles/<profile>/cordis.patch.yml`；
3. **用户全局补丁**：
   `$DSH_HOME/cordis.patch.yml`；
4. **命令行动态 Overlay 补丁**：
   按 CLI `--patch <path>` 参数传入的顺序逐个叠加。

### 覆盖与合并核心语义：全量替换 (Wholesale Replacement)
- 多个补丁层中针对相同 `id` 的插件条目，**后层按行胜出**；
- 条目内的 `config` 对象采用**整体替换，绝不进行深合并 (Replaced wholesale, not deep-merged)**；
- **防坑准则**：在 profile 补丁中修改已有插件的某一个配置项时，**必须提供该插件在该层所需的完整 config 字段**，不能仅传增量字段，否则会导致未列出的缺省字段丢失。

---

## 三、补丁语法与动态表达式规范

### 1. 新增插件条目：`- insert:`
用于向 Cordis Loader 注册新插件条目：
```yaml
- insert:
    - id: my-plugin-id
      name: my-plugin-package-name
      config:
        enabled: true
        port: 8080
      disabled: false
```
- 顶层 `- insert:` 插入根插件列表；
- 若 `- insert:` 提供针对已有条目的插入，目标条目必须是 `group: true` 容器，新增条目会被推入该 group 的配置数组中。

### 2. 修改已有插件配置：`- id:`
直接通过 `id` 索引已有条目并提供全量替换的 `config`：
```yaml
- id: better-sidebar
  name: dsh-better-sidebar
  config:
    titleBarCompat: true
```

### 3. 动态求值标签：`!!js` 表达式
DSH 允许在 YAML 中使用 `!!js` 标签执行安全的 JavaScript 表达式求值：
```yaml
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: streamable-http
        url: !!js process.env.CONTEXT7_MCP_URL
        headers: {}
        toolCallTimeoutMs: 60000
        failOnStartupError: false
      disabled: !!js '!process.env.CONTEXT7_MCP_URL'
```
- **求值沙盒上下文**：通过 `new Function("ctx", "expr", "with (ctx) { return eval(expr) }")` 执行；
- `ctx` 注入暴露了宿主环境信息（如 `dshHomePath`），且可自由访问全局 `process.env`；
- 广泛用于读取环境变量、动态条件禁用（`disabled: !!js '!process.env.VAR'`）。

---

## 四、权威工程运维与避坑准则

### 1. 致命教训：`--dump-config` 假阳性陷阱
**重要结论：`--dump-config` 校验通过，绝对不等于 Web 或 TUI 能够启动成功！**
- **根因**：`--dump-config` 仅解析 YAML 文本树与配置 Schema，**完全不加载插件物理代码，也不校验 peerDependencies**！
- 如果插件版本不兼容、缺少依赖或导出的服务冲突，`--dump-config` 返回 0 字节 stderr 且退出码为 0，但实际启动时整个系统会立刻崩溃（报 `required plugin did not activate`）。
- **官方权威的三步真实启动验收法**：
  ```bash
  # 1. 检查端口是否真实处于 LISTENING 状态
  netstat -ano | findstr "127.0.0.1:3080" | findstr LISTENING

  # 2. 检查启动输出中的鉴权 URL
  # 格式形如：dsh web: http://127.0.0.1:3080/?token=<auth-token>

  # 3. 带 token 请求根路径：必须返回 303 重定向并设置 dsh-auth-* Cookie；带 Cookie 请求必须返回 200 text/html
  ```

### 2. 包管理器避坑：npm 替代 pnpm 规避 OOM
- 官方 `@deepseek-ai/dsh` 元包会递归带出 250+ 官方子包；
- 使用 `pnpm` 解析超大依赖图时，链接阶段极易发生物理内存溢出（OOM，`invalid array length`）；若使用 `pnpm install --prod` 又会错误排除 devDependencies 导致插件全量卡死在旧版本；
- **官方推荐解决方案**：
  ```bash
  cd ~/.dsh/profiles/web
  npm install --legacy-peer-deps --no-audit --no-fund
  ```
  使用 `--legacy-peer-deps` 压制非致命 ERESOLVE 警告，npm 默认采用扁平化 `node_modules` 结构，解析极速且零 OOM。

### 3. 版本兼容性豁免机制 (allow-version)
DSH 0.1.7+ 会在启动时严格检查各插件的 `peerDependencies`。遇到第三方插件尚未适配最新 DSH 但功能完全兼容时，可通过官方豁免命令放行：
```bash
dsh plugin --profile <profile> allow-version <pkg-name>@<version> --dsh-version <exact-dsh-version> --accept-risk
```
该命令会将豁免记录写入 profile 目录下的 `compatibility.json`。

---

## 五、Web Profile 官方生效的 14 个 Bundles 清单

在当前最新的生产基准（2026-10-01）中，Web profile 包含以下 14 个标准组合包：
1. `@deepseek-ai/dsh-base`（基础微内核与大动脉服务）
2. `@deepseek-ai/dsh-web-app`（Web 宿主控制台与会话管理器）
3. `dshmarket`（插件市场）
4. `dsh-context`（上下文增强）
5. `dsh-better-sidebar`（侧边栏扩展）
6. `@wenaixi/dsh-ponytail`（代码精简与极简工程引擎）
7. `@wenaixi/dsh-superpower`（开发超级能力套件）
8. `dsh-prompt-history`（提示词历史记录）
9. `@linxin666/dsh-client-ui-git-graph`（Git 分支图可视化）
10. `dsh-plugin-wallpaper-engine`（动态壁纸与视觉主题）
11. `@deepseek-ai/dsh-experimental-agent-team-profile`（Agent Teams 多智能体协作团队预设）
12. `@deepseek-ai/dsh-experimental-voice-input-bundle`（语音输入套件）
13. `@deepseek-ai/dsh-experimental-schedule-bundle`（挂钟定时提醒系统）
14. `@liustack/modsearch`（多引擎网络搜索桥接）

---

## 六、生成器目录规则 (Generator Catalogs)

在 DSH 源码树中，有三个核心目录由代码生成脚本严格维护：
- `config-catalog`
- `persistence-catalog`
- `tool-catalog`

**规范约束**：
- 这三个目录由 `scripts/gen-*.ts` 脚本根据源码类型定义自动生成，并通过 `verify-*` 脚本在 CI 中校验；
- **严禁任何开发者手动修改这三个目录中的文件**；
- 运行时 Seam 字段在配置 Schema 中被显式剔除，无法通过静态 `cordis.yml` 进行持久化配置，必须由插件动态装载。
## 七、设置表单与配置持久化 (Settings Forms)

插件导出的 Schemastery 配置契约会被自动反射为 Web GUI 设置界面的可视化表单控件，并在用户修改后落盘到本文件第二节所述的补丁层。

### 7.1 核心服务与寻址

- **`SettingsService` (`ctx.settings`, `@deepseek-ai/dsh-settings`)**：将当前激活 Profile 中的插件配置字段动态投影为前端表单描述符（Descriptors）。核心方法：`configure({auto?})`、`describe()`、`update(ns, patch, expectedRevision?)`、`replace(ns, section, expectedRevision?)`、`mutate(ns, ops, expectedRevision?)`。
- **`ConfigEditor` (`@deepseek-ai/dsh-config-editor`)**：提供带文件锁的原子化持久化写入服务，目标为当前 Profile 的配置补丁。设置层只做投影与校验，落盘永远走 patch。
- **标识寻址**：表单系统基于当前 Profile 中条目的**局部唯一标识符 (Entry ID)** 做命名空间寻址。同一插件包挂载多个实例（如两个 MCP 客户端）时，只要 `id` 不同，前端就呈现为多份独立表单；只有带明确 `id` 且导出非空 Schema 的条目才会生成表单。

### 7.2 三种写入语义

| 方法 | 语义 |
| --- | --- |
| `update(ns, patch)` | **合并**提交字段（默认语义） |
| `replace(ns, section)` | 先将即时字段重置为继承配置，再应用提交字段（整体替换） |
| `mutate(ns, ops)` | **路径级**寻址编辑，保留客户端响应中未包含的秘密值 |

每次写入都会验证完整 Config，并在持久化前拒绝过期修订号（乐观并发控制）。

### 7.3 表单描述符与乐观版本控制

- `resolvedValues`：当前生效的最终配置值（已合并默认值与用户覆盖）；
- `inheritedValues`：由底层 Bundle 定义的基础默认配置；
- `profileOverrides`：在当前 Profile 补丁中显式声明的覆盖字段；
- `revision`：并发安全保护的递增版本号。前端提交时必须附带期望版本号，中途有其他进程更新文件则保存安全中止。

### 7.4 持久化写入语义

1. **唯一写入目标**：当前 Profile 的补丁文件 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。
2. **全量替换规约**：写入的配置字段完整替换该条目的 `config` 块，不做深合并，语义见本文第二节。表单提交必须提交完整的已解析配置对象。
3. **文件锁保护**：写入受文件锁保护，避免并发写入导致 YAML 语法损坏。
4. **HMR 自动触发**：写入完成后文件监听器检测到补丁变动，执行增量重载而无需重启应用。
5. **即时字段 (Volatile)**：`Volatile<T>` + `Schema.xxx().volatile()` 声明即时字段，运行时用 `.get()` 读取、跨字段校验用 `.check()`（Host 持久化前执行，不进表单 schema）；变更经 `loader/volatile-update` 事件推送给所属 fiber；`role('secret')` 阻止值进入表单响应，凭据域值用凭据引用。

---

## 八、多来源优先级与可诊断化 (Precedence & Diagnostics)

第二节描述的是**补丁层之间**的覆盖。但同一个插件的同一项配置，往往同时来自四个彼此独立的通道：

```text
环境变量  >  补丁/宿主显式配置  >  插件自有数据文件  >  内置兜底
```

### 8.1 最常见的症状：用户改了设置却「没反应」

优先级链是静默的。用户在设置面板把值改成 A，实际生效的是更高优先级的环境变量 B，于是表现为「保存成功、重启后还是老样子、没有任何日志」。这类缺陷的真因永远是「某一级更高优先级盖掉了界面写入的值」，而不是保存失败。

**硬性工程要求：优先级解析必须是一个零 I/O 的纯函数，产出与运行时判定逐行一致的诊断链。**

```ts
// 纯函数：只吃各来源的原始值，不碰磁盘、不读环境，便于单测穷举
export function resolvePriority(input: {
  envRaw?: string
  patchMode?: string
  fileMode?: string
}): { effective: string; chain: Source[] } { /* ... */ }
```

单条诊断项的字段（语义固定，UI 与日志共用）：

| 字段 | 含义 |
| --- | --- |
| `level` | 来源级别标识，UI 的 key 与渲染分支都靠它 |
| `label` | 人读来源名 |
| `location` | 该值的物理落点（环境变量名 / 补丁条目 / 数据文件路径） |
| `value` | 原始值，未设置为 `null` |
| `hit` | 当前是否生效 |
| `shadowed` | 写了但被更高优先级压制 |
| `problem` | 值非法或文件损坏时的说明 |

### 8.2 纯函数与运行时判定必须同源

**同一个「哪一级胜出」的判断出现两处就一定会漂移**（改了一处、另一处忘了）。做法只有两种，选一种并守住：

- 把解析抽成纯函数，运行时 `apply` 与诊断/UI 都调它；
- 或让 UI 只展示运行时的真实判定结果，不另写一套。

回归防线：给纯函数写穷举单测（每一级单独给值、两两冲突、三级冲突、非法值、空文件），并让**静态门禁把该模块列入产物清单**，误删时构建直接失败。

### 8.3 Schema 默认值会吃掉「未设置」

这一条与 [plugin-anatomy.md](./plugin-anatomy.md) 第 2 节同源，但在优先级场景下后果更隐蔽：`apply(ctx, config)` 拿到的 `config` 里，Schema 的 `.default()` 已被填成显式值，于是「用户没在补丁里写」与「用户写了默认值」变得**无法区分**。

后果：判定逻辑里 `config.x !== undefined` 永远为真，最高优先级那一级因为「有值」而恒定命中，你的自有配置文件永远轮不到，且日志里看不出异常。

修法（择一，按推荐排序）：

1. 该字段的 `.default()` 去掉，缺省语义在插件内部表达；
2. 保留 `.default()` 但判定时改用**原始未校验配置**（宿主保留 raw config，插件可从 `internal/config` 瀑布事件的入参拿到），而不是校验后的对象；
3. 兜底：判定时同时输出 raw 与 resolved 两个值，让分歧可见。

### 8.4 面向用户的呈现

诊断链的价值在于把「静默」变成「可见」。UI 侧的通用做法：

- 每一级渲染成一行：状态点 + 来源名 + 落点与值 + 状态标签；
- 状态标签固定四态：生效中 / 被覆盖 / 未设置 / 值非法（或文件损坏）；
- **当某一级压制了用户可写的层级时，直接把该层控件置灰并说明原因**，而不是让用户继续做无效操作；
- 诊断信息本身不可用时（老版本宿主没有该接口），渲染明确的降级提示，不要静默留白。

### 8.5 数据根的选择纪律

插件自有配置与标记文件一律落在宿主统一用户数据根（默认 `~/.dsh`，可用 `$DSH_HOME` 覆盖）之下的**具名子目录**，而不是 `%APPDATA%` / `~/.config` 这类平台约定位置。

理由：跟宿主同根才能天然跟随 `$DSH_HOME` 覆盖、天然随 profile 隔离、跨平台行为一致。反过来做会带来一整类难查问题——用户改了 `$DSH_HOME` 之后插件「忘了」自己的旧配置。

实现纪律：

- 路径拼接一律交给 `node:path`，代码里不出现任何平台分支或平台路径字面量；
- 解析宿主的根路径时**等价复刻**官方实现（几行纯函数），不要静态 import 官方包，理由见 [plugin-anatomy.md](./plugin-anatomy.md) 第 2 节；
- 若要为老位置做兼容：**只读兼容，不写兼容**。写永远只落新位置，旧目录不删不改，避免出现两处真值；
- 复刻的等价性要有可执行防线（静态门禁断言「不得出现平台判断字面量」），不要只靠注释。

### 8.6 自检清单

| 检查项 | 判定动作 |
| --- | --- |
| 优先级解析是纯函数 | 单元测试能在不启动宿主的情况下穷举所有组合 |
| 解析函数在静态门禁的产物清单里 | 删掉该文件，构建直接失败 |
| 运行时与 UI 用同一份判定 | 改动只在一个文件里；grep 优先级关键字应只有一处实现 |
| 未设置语义没被 Schema 吃掉 | 该字段无 `.default()`，或判定用 raw config |
| 自有数据根跟随宿主 | 改 `$DSH_HOME` 后插件读写随之改变 |
| 兼容读不产生双真值 | 全仓 grep 旧路径，只有只读分支命中 |