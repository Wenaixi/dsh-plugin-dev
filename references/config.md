# DSH 运行时配置与补丁系统权威指南 (DSH 0.2.0-rc.2)

本文件是 DeepSeek Harness (DSH 0.2.0-rc.2) 配置补丁系统、生效落点、动态表达式求值与运维避坑的官方权威规范。

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
