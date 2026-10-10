# DSH 运行时配置与补丁系统参考指南

本文件整理配置补丁、动态表达式和运维验证要点。具体路径、迁移行为与 CLI 细节必须按目标版本源码和运行时复核。

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
- [九、配置稳定性保障、容灾提取与自动重生指南 (Config Resilience & Auto-Regeneration)](#九配置稳定性保障容灾提取与自动重生指南-config-resilience--auto-regeneration)

---

## 一、配置系统重大废弃警告

> **绝对严禁教导用户修改 `$DSH_HOME/settings.yaml`！**
> 该文件在 DSH 0.1.7+ 中已彻底废弃，不再被直接读取。改名导入不是启动路径做的：SettingsForms 服务（`@deepseek-ai/dsh-settings`）在 Loader 全部条目就绪后（`ctx.root.loader.await()` 之后）执行一次性 legacy 导入——先把文件改名为 `settings.yaml.imported`，再逐 section 按 `LEGACY_SECTION_ENTRIES` 映射 `update` 进当前 profile 的补丁（ui-developer-tools→ui-settings、ui-onboarding→ui-settings-general、shell→pwsh-sandbox/bash-sandbox）；先改名再写入，部分导入不会重复；写入失败的 section 留在改名文件里并记 `logger.warn`。
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
5. **Telemetry 硬开关（内存追加，无对应文件）**：
   `readProfilePatches` 组合完上述四层后，若 `DSH_TELEMETRY_DISABLED` 非空（`'0'`/`'false'` 同样算非空，隐私开关宁错关勿错开）且组合结果中含 `session-telemetry-otel` 条目，最后叠加 `{ id: session-telemetry-otel, disabled: true }`；组合中无该条目则不出补丁。

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

### 1.5 scoped 包名的 patch 行必须带引号

`name` 指向包名，裸写时若包名以 `@` 开头（scoped 包）会**整个 YAML 解析失败**：`name: @scope/pkg` 报 `Plain value cannot start with reserved character @`，`dsh plugin add` 阶段就报 `dsh: restored package.json, pnpm-lock.yaml, and node_modules` 并回滚，`pnpm add` 则报 patch 解析错误直接退出。

- **必须写成 `name: "@scope/pkg"`**（双引号包住整个 scoped 名）；官方 `@deepseek-ai/*` 包的 patch 全部如此。
- 常见误区：以为「@ 开头会被当成 YAML 指令或 comment」——实际是 reserved character 报错，比指令更硬，整个文件不可解析。
- 判定动作：改完用 `yaml` 库解析一次（`yaml.parse('name: @scope/pkg')` 必然抛错、带引号则通过）；或用 `pnpm pack` 出 tarball 后解包核对 patch 内容。

### 2. 修改已有插件配置：`- id:`
直接通过 `id` 索引已有条目并提供全量替换的 `config`：
```yaml
- id: better-sidebar
  name: dsh-better-sidebar
  config:
    titleBarCompat: true
```

### 3. 动态求值标签：`!!js` 表达式
DSH 允许在 YAML 中使用 `!!js` 标签执行非沙盒的任意 JavaScript 求值（`new Function("ctx", "expr", "with(ctx) { return eval(expr) }")`，表达式在条目的 ctx 上执行，可访问完整 loader 上下文；**只应写可信补丁**，disabled 表达式求值失败会进入 inactiveEntries 启动警告）：
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
- **根因**：`--dump-config`（YAML）仅组合补丁层并渲染文本树，**不加载插件物理代码、不 apply 插件、不 eval `!!js`**——但组合阶段仍会跑 bundle 层的 peer 兼容性检查（`loadProfileDirectory` 对每个 bundle 调 `evaluatePluginCompatibility`；不兼容且未豁免的 bundle 在 dump 时被跳过并向 **stderr** 打印 skipping 警告，不是静默）。`--dump-config-schema` 则不同：它会 import 插件模块并执行其顶层代码（懒加载的 schema 构建器同样执行），只是不 apply 插件、不 eval `!!js`。
- 如果插件版本不兼容、缺少依赖或导出的服务冲突，`--dump-config` 可能仍返回退出码 0（bundle 跳过只写 stderr 警告），但实际启动时整个系统会立刻崩溃（报 `startup failed: N required plugins did not activate`）。
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
  cd $DSH_HOME/profiles/<name>
  npm install --legacy-peer-deps --no-audit --no-fund   # 仅作 OOM 临时规避，官方链路是 pnpm
  ```
  使用 `--legacy-peer-deps` 压制非致命 ERESOLVE 警告，npm 默认扁平化 `node_modules`、解析极速且零 OOM——这仅是本机 OOM 时的临时规避手段（与 DSH 官方 pnpm 链路结果可能不同），用后必须以 `plugin list` 零报错验收。

### 3. 版本兼容性豁免机制 (allow-version)
DSH 会在启动与安装时严格检查各插件的 `peerDependencies`（组合阶段的 bundle 预检 + 装载前的条目预检，见第四节）。遇到第三方插件尚未适配最新 DSH 但功能完全兼容时，可通过官方豁免命令放行。相关命令共三个：`allow-version` / `revoke-version` / `version-exemptions`（均挂在 `dsh plugin` 下），usage 形如 `dsh plugin <command> <pkg>@<ver> --dsh-version <exact> [--accept-risk]`：
```bash
dsh plugin --profile <profile> allow-version <pkg>@<ver> --dsh-version <exact-dsh-version> --accept-risk
dsh plugin --profile <profile> revoke-version <pkg>@<ver> --dsh-version <exact-dsh-version>
dsh plugin --profile <profile> version-exemptions
```
豁免记录写入 profile 目录下的 `compatibility.json`（不是 package.json），键为 `pkg@精确版本`、值为精确 DSH 版本列表。豁免语义是「精确插件版本 + 精确 DSH 版本」的 **peer 兼容豁免**，不是发布年龄豁免；`--accept-risk` 仅在授权（allow-version）时要求，且授权的 DSH 版本必须等于当前运行时版本。

---

## 五、Profile 实际挂载哪些 Bundles

profile 实际挂载哪些 bundle 以 `profiles/<name>/package.json` 的 `dsh.profile.bundles` 为准（含官方 `dsh-base`/`dsh-web-app`/`dsh-experimental-*` 与用户自行安装的第三方包）。不要在文档里维护固定清单——第三方包会增删，清单必然失真。

> 官方可选组合包（如 `@deepseek-ai/dsh-experimental-voice-input-bundle`）由 `dsh-app-boot` 的 OPTIONAL_BUNDLES 随安装提供、默认不启用、经插件管理器开启；不依赖它们时无需在 `dsh.profile.bundles` 中列出。

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

`describe()` 为每个活跃条目返回一个描述符对象，真实字段如下（见 `@deepseek-ai/dsh-settings` 的 `describe()` 实现）：

- `autoGenerate`：该条目默认自动生成设置页的开关；
- `ns`：条目 id，表单的命名空间；
- `schema`：剔除 volatile 节点后的表单 Schema；
- `revision`：并发安全保护的递增版本号。前端提交时必须附带期望版本号，中途有其他进程更新文件则保存安全中止；
- `applies: "live"`：修改即时生效；
- `value`：当前生效的最终配置值（已合并默认值与用户覆盖）；
- `base`：由底层 Bundle 定义继承层解析出的基础默认配置；
- `user`：在当前 Profile 补丁中显式声明的覆盖字段；
- `secrets`（可选）：redact 模式下返回的 secrets 位置清单。

### 7.4 持久化写入语义

1. **唯一写入目标**：当前 Profile 的补丁文件 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。
2. **全量替换规约**：写入的配置字段完整替换该条目的 `config` 块，不做深合并，语义见本文第二节。表单提交必须提交完整的已解析配置对象。
3. **文件锁保护**：写入受文件锁保护，避免并发写入导致 YAML 语法损坏。
4. **HMR 自动触发**：写入完成后文件监听器检测到补丁变动，执行增量重载而无需重启应用。
5. **即时字段 (Volatile)**：`Volatile<T>` + `Schema.xxx().volatile()` 声明即时字段，运行时用 `.get()` 读取——不进表单 schema。跨字段校验由 `resolveConfig` 在 volatile 提交路径完成（`cordis-plugin-loader` 的 `_commitVolatile`：校验失败记 `logger.warn` 并保留运行中的旧值，raw 配置留待下次激活）；校验通过后变更经 `loader/volatile-update` 事件推送给所属 fiber；`role('secret')` 阻止值进入表单响应，凭据域值用凭据引用。

### 7.5 反向覆盖闸门：写入前会验证「组合结果 == 提交值」

落盘前有一道深比较，任何不等都会被拒绝并原样抛出，不写文件：

```js
const combined = flatten(composeEntries([patches])).find((row) => row.id === entry.options.id)?.config ?? {}
if (!isDeepStrictEqual(combined, next))
  throw new Error(`Configuration for "${entry.options.id}" is overridden by a home patch or command-line overlay`)
```

`combined` 是**组合所有层之后**该条目的最终 `config`，`next` 是客户端提交的完整新值。由此推出两条硬约束：

- **组合包里 `insert` 的那条目必须写全所有用户可改字段**，且逐字段等于 schema 默认值。只写部分字段时，组合结果缺少其余字段，客户端提交补齐后的值必然与之不等——**用户第一次改动就失败**，且失败是异步 reject，表面上看不出原因。
- 提交的值与「组合结果」必须逐字段相等，所以默认值不能只在 schema 里声明，补丁里也要写同一份。schema 与 patch 两处默认值漂移，等价于给整个插件配置功能埋一颗哑弹。

判别方法：报错消息里出现 `is overridden by ...` 就属于这一类，不是并发冲突。修法是补齐 bundle patch 的 `config`，而不是让用户重试。

### 7.6 删除配置字段 = patch 与 schema 双向同步

反向同样成立：从 schema 里**删除**一个字段时，必须同步从 bundle patch 的 `config` 里删掉同一键。patch 里残留一个 schema 已不认识的键，组合结果与用户提交值永远不等，**该命名空间所有设置写入被拒**（`settings/rejected`），用户会以为整个配置功能坏了。

- 删除字段的完整清单：`src` schema 定义、`cordis.patch.yml` 的 config 行、已装 profile 的 patch 行、README 配置表、locale 文案、纯函数模型（默认值/字段列表/规范化/迁移计划）与对应测试。
- 这是「能力删除承诺面」（cross-cutting 专题）在配置域的具体实例：入口、文档、配置、导出一处不同步，就是一颗随时爆炸的哑弹。

### 7.7 Volatile 字段底层判定机制（isVolatilePath 与 volatileForm）

DSH 官方 `@deepseek-ai/dsh-settings` 在执行 `mutate(ns, ops, expectedRevision)` 写入时，会严格执行两重静态与动态结构检验：

1. **表单模式提取（volatileForm）**：
   ```javascript
   function volatileForm(schema) {
       if (schema.meta.volatile) return plainSchema(schema);
       if (schema.type === "object") {
           const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
               const field = volatileForm(child);
               return field === void 0 ? [] : [[key, field]];
           }));
           return Object.keys(dict).length === 0 ? void 0 : z.object(dict);
       }
   }
   ```
   如果整个插件 entry 的 Schema 内部没有任何一个字段带有 `.volatile()` 声明，`volatileForm` 返回 `undefined`，写入直接抛出 `Plugin entry "${ns}" has no volatile fields`。

2. **写入路径递归校验（isVolatilePath）**：
   ```javascript
   function isVolatilePath(schema, path) {
       if (schema.meta.volatile) return true;
       const [key, ...rest] = path;
       const child = key === void 0 ? void 0 : schema.dict?.[key];
       return child !== void 0 && isVolatilePath(child, rest);
   }
   ```
   待写入的 `ops` 中每一个 `path`，都必须使其自身节点或其最近的祖先字典节点包含 `.volatile()`。一旦任何非 volatile 路径被传入，底层立即抛出 `Config field "${path.join(".")}" is not volatile` 并拒绝写入。

### 7.8 复合/联合字段的 volatile 设计与运行时解包陷阱

1. **联合类型复合声明规范**：
   对于具有多种枚举值或可选三态的字段（如需要表达“未设置/跟随宿主”与“显式覆盖”）：
   ```typescript
   // 正确声明：联合常量 + 可选 + 标记为 volatile
   myOption: Schema.union(['alpha', 'beta']).required(false).volatile(),
   ```
   底层 Schemastery 会将其正确打包为含有 `uid` 和分支引用的复合结构，`isVolatilePath` 能够正确递归识别该属性为 volatile。

2. **非负整数用 `z.natural()`，不要找 `z.number().integer()`**：
   schemastery 的 `z.number()` 返回的类型没有 `integer()` 方法（`Property 'integer' does not exist`
   是编译期报错，不是运行期）。声明「非负整数 + 上下限」字段的正确写法：

   ```typescript
   // 正确：natural()（非负整数）+ min/max + 默认值
   maxItems: z.natural().min(10).max(1000).default(100),

   // 错：Property 'integer' does not exist on type ...
   // maxItems: z.number().integer().min(10).max(1000).default(100),
   ```

   读取侧仍按「用户可持久化字段」的常规纪律处理：UI 选项（如档位单选）的值来自合法选项集合，
   输入域边界值在进入状态前归一化夹取（见 runtime-truth-and-external-contracts 受控控件一节）。

3. **宿主端 volatile 引用对象的解包陷阱（unwrapValue）**：
   - 核心事实：在宿主侧，插件的配置经过 Loader 与 Schemastery 校验后，**所有标记了 `.volatile()` 的字段会被包装为内部 volatile 引用对象**（即附带 `.get()` 方法的实体）；
   - 常见盲区：在宿主端代码（如 Provider 或服务实现）中，直接访问 `config.myOption` 拿到的不是原始字符串或数字，而是一个包含 `get` 方法的引用包装！
   - 防御规范：宿主代码必须提供通用解包函数：
     ```typescript
     function unwrapValue<T>(value: T | { get: () => T } | undefined): T | undefined {
       if (value !== null && typeof value === 'object' && 'get' in value && typeof value.get === 'function') {
         return (value as { get: () => T }).get();
       }
       return value as T | undefined;
     }
     ```
     读取 volatile 配置时一律经过解包获取真实值，杜绝因持有引用包装导致类型判断失败；
   - 客户端行为差异：客户端通过 `SettingsForms.describe` 接收到的快照，已经由后端的 `plainConfig` 自动剥离了运行时引用包装，客户端接收到的是标准 JSON 纯标量。

3. **嵌套 volatile 的位置限制只在解析期生效**：
   `volatile` 只能落在**固定对象路径**上（某个对象字段自身）。放进数组元素、dict 的值、union 分支内部都会被拒绝——但**构造 schema 时不报错，只在 `resolve` / 校验那一刻抛**：

   ```javascript
   // 底层校验与报错原文（schemastery validateVolatileSchema）
   if (schema.meta?.volatile && blocked) throw new ValidationError(
     'volatile fields require a fixed object path without an enclosing volatile field', { path });
   ```

   `blocked` 由遍历时传递：进入 `inner`（数组/可调用内层）、`sKey`（dict 的键）、`list`（union 分支）时置 `true`；进入某个 `volatile` 节点后其子树也全部置 `true`。**因此一个 volatile 字段内部不得再含 volatile 子字段**。

   ```javascript
   Schema.object({ mode: Schema.union(['lite', 'full']).volatile() });                     // 允许
   Schema.object({ list: Schema.array(Schema.string().volatile()) });                      // 拒绝 $.list.*
   Schema.object({ map:  Schema.dict(Schema.string().volatile()) });                       // 拒绝 $.map.*
   Schema.object({ pick: Schema.union([Schema.object({ y: Schema.string().volatile() })])}); // 拒绝 $.pick.0.y
   ```

   **为什么值得单独记**：构造期不抛意味着你的 schema 模块能正常加载、能过类型检查、`Schema({})` 形式的测试也全绿，只有真实宿主解析配置那一刻才炸。用户在界面上看到「插件加载即报错」，而你本地怎么测都复现不出来。**所以：含 volatile 的 schema 必须有一条真正走 `resolve` 的测试**，只测 `Schema({})` 不够。

4. **解析非法值是抛异常，不是返回错误数组**：
   `Schema.resolve(data, schema)` 遇到类型不符的值会**抛 `ValidationError`**，不会返回 `[value, errors]`。写门禁或迁移脚本时：

   ```javascript
   // 错：errors 永远 undefined，分支永不进入，断言是恒假的空门禁
   const [, errors] = Schema.resolve({ mode: '非法值' }, ConfigSchema);
   if (errors?.length) fail();

   // 对：try/catch 才拿得到
   let rejected = false;
   try { Schema.resolve({ mode: '非法值' }, ConfigSchema); } catch { rejected = true; }
   if (!rejected) fail();
   ```

   **连带的一条**：`toJSON()` 的返回值不是展开的树，而是**引用表**——顶层只有 `{ uid, refs }`，字段节点在 `refs` 里，`dict` 是字段名到 uid 的映射，数组元素与 union 分支都是下标引用：

   ```javascript
   const json = Config.toJSON();
   json.dict?.defaultMode;                 // undefined —— dict 在根节点的 refs 条目里
   json.refs[json.uid].dict.defaultMode;   // 字段名 → 节点 uid
   json.refs[thatUid].meta.volatile;       // 才是字段元信息
   ```

   这一点对写 schema 形态门禁是决定性的：直读 `json.dict` 得到 `undefined`，断言**看起来写了、实际永远为假**，永远不会红。**每加一条形态门禁都要做破坏实测**（见 [silent-failure-and-gate-design.md](./silent-failure-and-gate-design.md)）——否则你不知道自己测的是契约还是空气。

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
// 教学示意命名（本插件私有接口，非宿主 API）：纯函数，只吃各来源的原始值，不碰磁盘、不读环境，便于单测穷举
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

### 8.3b 三态配置字段：未配置 ≠ 默认值，可做「跟随其他命名空间」

场景：插件有个「语言/主题/区域」类字段，希望**未配置时跟随宿主同名设置**（用户显式选了才锁定）。
三个要点，全部来自实战踩坑：

1. **去掉 Schema 默认值**（同 8.3）：默认值会让「用户没配」与「用户显式选了默认值」不可区分，跟随逻辑
   永远不触发。未配置的可观察形态是 volatile 引用包着 undefined（`readVolatile()` 返回 undefined）。
2. **显式值锁定，未配置现读跟随源**：每次求值时先看自己的字段，有值就锁定；没有才去读跟随源
   （如宿主 `locale` 命名空间的 `preference` 字段）。跟随源经 `settings.describe()` 读——
   它的返回形状随版本不同（数组 descriptors 或 `{ namespaces: [...] }`），两侧都兼容。
3. **跟随源的变更收敛点**：另一个命名空间（`locale` 等）的 `loader/volatile-update` **只在那条插件
   自己的 fiber 上广播**，你的插件收不到。宿主每次应用补丁后广播的 `app-boot/config-reload` 才是
   可订阅的变更通知（官方 dsh-settings 自己也监听它重算快照）。在你的插件里收到该事件就刷新
   （如让技能目录失效、重拉快照）。

判据（验收）：跟随源为 A → 插件读 A；显式设为 B → 读 B（跟随源切回 A 不推翻）；unset 回未配置 → 恢复跟随。
三条都要用「运行时真值回读」验证，不要只信 UI 显示。

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

---

## 九、配置稳定性保障、容灾提取与自动重生指南 (Config Resilience & Auto-Regeneration)

在真实工程环境中，外部持久化配置文件（如 `cordis.patch.yml`）极易遭遇不可控的破坏：用户手动编辑手滑、不同客户端写入格式差异、升级迁移半状态、甚至意外注入了非标准数据类型。
一个工业级健壮的 DSH 插件必须具备**「配置即使损坏也能安全提取意图，并在适当时机自动重新生成标准配置」**的自愈能力。

### 9.1 宿主 Loader 引导强校验陷阱与 `Schema.transform` 引导防崩

#### 1. 致命痛点：严苛 Schema 导致插件无法加载
DSH 插件的 `Config` 通常声明为 `Schema.dict(Schema.boolean())` 或严格字面量的 `Schema.union(['a', 'b'])`。
实战中，若用户在 `cordis.patch.yml` 中：
- 把字典字段误写成了字符串（如 `disabled: "bad"`）或数组；
- 把布尔值写成了字符串（如 `"true"`）或数字（`1`）；
- 把枚举字段写成了常见区域别名（如将语言代码写成 `"zh-CN"` 或 `"en-US"`）；

**Cordis Loader 在插件加载引导阶段就会直接抛出致命异常：**
```text
invalid config:
  - $.disabled expected object but got string
  - $.language expected "zh" | "en" but got "zh-CN"
```
**后果**：插件激活直接失败（`plugin failed to load`），插件生命周期的 `apply` 根本无法执行，整个插件连同错误处理与 UI 完全瘫痪！

#### 2. 通用解法：利用 `Schema.transform` 构造自愈容灾节点
不要在 Schema 入口层写死脆弱的强类型校验，利用 `@deepseek-ai/schemastery` 的静态 `Schema.transform` 方法，将易受外部编辑破坏的字段包装为自愈节点：

```ts
export const Config = Schema.object({
  // 容灾字典：接收 any 输入，通过纯函数提取合法项，非法输入安全回退为干净字典，绝不抛错
  switches: Schema.transform(Schema.any(), (val) => extractCleanDictionary(val))
    .default({})
    .volatile(),

  // 容灾枚举：接收非标别名（如 zh-CN），自动清洗归一化为合法字面量
  preference: Schema.transform(Schema.any(), (val) => normalizePreference(val))
    .default(undefined)
    .volatile(),
})
```

- **第一道防线**：任何非对象、数字布尔值、脏字符串在进入 Loader 时已被安全归一化为合法结构，宿主引导 100% 成功；
- **守住写入闸门**：必须在末尾保留 `.volatile()` 标注！宿主 `SettingsService` 校验写入时逐条验证 `op.path` 是否落在 volatile 节点下，少一个 `.volatile()`，后续所有的自愈修复写入（`form.mutate`）都会被宿主闸门直接拒绝。

---

### 9.2 纯字典原型防御陷阱：`Object.create(null)` 与原型链假阳性

#### 1. 致命陷阱：普通对象的原型继承
在 JavaScript 中，若用对象字面量 `const clean = {}` 存放清洗后的字典：
当外部输入包含 `constructor`、`toString`、`valueOf` 等属性，或者调用方代码使用 `clean['constructor']` 探测某个键是否被配置时：
```js
const clean = {};
console.log(clean['constructor']); // 输出 [Function: Object]，而不是 undefined！
```
由于普通对象继承自 `Object.prototype`，任何对原型属性名的访问都会返回真值（truthy），造成致命的**假阳性判定**与**原型污染隐患**！

#### 2. 通用解法：使用 `Object.create(null)` 创建无原型纯字典
所有从外部可能损坏的配置中提取键值字典时，字典容器必须使用 `Object.create(null)` 初始化：

```ts
export function extractCleanDictionary(value: unknown): Record<string, boolean> {
  const unwrapped = unwrapValue(value)
  if (typeof unwrapped !== 'object' || unwrapped === null || Array.isArray(unwrapped)) {
    return Object.create(null)
  }
  const clean: Record<string, boolean> = Object.create(null)
  for (const [key, val] of Object.entries(unwrapped)) {
    // 拦截原型污染键与未知非法键
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (!VALID_KEYS_SET.has(key)) continue
    
    // 宽容识别非标真值
    if (val === true || val === 'true' || val === 1 || val === '1' || val === 'yes' || val === 'on') {
      clean[key] = true
    }
  }
  return clean
}
```
**收益**：`clean['constructor']` 严格等于 `undefined`，既彻底消灭原型属性的假阳性误判，又对原型污染攻击天然免疫。

---

### 9.3 容灾清洗提取与自动重生闭环 (Self-Healing Pipeline)

仅在内存中容忍损坏是不够的，底层的脏数据会一直滞留在持久化文件（`cordis.patch.yml`）中。必须构建「损坏感知 → 提取意图 → 原子重生」的闭环。

#### 1. 损坏感知纯函数 (`isConfigCorrupted`)
提供零副作用的纯函数，明确定义何为配置损坏：
- 字段类型非法（本该是字典却为字符串/数组/数字）；
- 字典内部包含了非已知白名单键或原型污染键；
- 字典内部包含了非标值（如保留了 `false` 残留、字符串布尔值）；
- 枚举字段包含非标格式或无法识别的值。

#### 2. 自动重生 Operations 派发 (`buildRepairOps`)
当检测到配置损坏时，控制器自动派发单次原子批处理操作（Flattening Pattern）：
1. 对提取出的合法有效项派发规范的 `{ op: 'set', path: ['field', key], value: true }`；
2. 对底层文件中残留的未知脏键、非法项派发 `{ op: 'unset', path: ['field', key] }`；
3. 对已废弃的历史遗留字段派发 `{ op: 'unset', path: ['legacyField'] }`；
4. 对枚举项派发规范化后的值（或在缺省时派发 `unset`）。

---

### 9.4 挂载零副作用准则 (No Side-effect on Mount)

#### 致命陷阱：组件挂载自发 mutate 导致乐观锁竞争与状态撕裂
切忌在前端组件挂载（`useEffect`）或控制器构造函数（`constructor`）中**自发调用后台写入（`scope.mutate`）**进行配置自愈！

- **根因**：DSH 宿主 `SettingsService` 维护单调递增的 `revision` 版本号。在 React 18+ 严格模式（Strict Mode）或开发期页面热重载下，组件可能在同一微秒内被初始化多次；自发发起的后台 mutate 会意外抢占和消耗版本号，导致用户并发操作遭遇乐观锁冲突（`State Tearing`），并产生意料之外的保存失败报错。
- **正解**：
  - **挂载保持纯观察者**：初始化时只读出清洗后的内存安全快照，界面零报错、零白屏；
  - **操作即自愈（Lazy Healing on Mutation）**：用户在界面进行任何一次正常操作（如开关切换、下拉选择）时，控制器在 `_buildOps` 中顺手融合修复操作，一次 RPC 完成用户动作与配置规范化重写；
  - **提供显式自愈动作**：若必须独立自愈，由外部动作或专用的 `repairConfig()` 显式触发，绝不静默在挂载时偷跑。

---

### 9.5 历史兼容字段 vs 破坏性脏数据的边界隔离

在实现自愈逻辑时，最容易犯的错误是**将「历史遗留废弃字段（Legacy fields）」误判为「配置损坏（Corrupted config）」**：

- **历史遗留字段**：是插件版本演进中合法的向后兼容机制（用户刚从上一版本升级上来）。应遵循「新表为空时并入旧表，用户操作时原子继承新表并清除旧表」的兼容契约；**绝不能在无操作时强行清除旧表**，否则单次读操作就会把历史用户的配置直接抹除！
- **破坏性脏数据**：是指非对象结构、非法字符串布尔、原型污染键、未知非法键等真正的错误格式。
- **判定规则**：旧表存在且新表为空属于合法的未迁移兼容态，不属于配置损坏；只有当数据类型错乱或存在脏键时，才标记为损坏。

---

---

## 十、Schemastery 跨端 Schema 序列化禁忌：Schema.transform 函数闭包丢失与通道假死陷阱

### 10.1 故障现象与外在表征

在 DSH 双面插件开发中，当开发者在插件配置中加入了容灾自愈逻辑后，常会遇到一个极其迷惑的「通道假死」故障：
- 插件在底层配置文件（如 `cordis.patch.yml`）中已正确挂载且条目配置完整；
- 宿主命令行（如 `dsh --dump-config`）打印出的配置树完全正常，插件服务正常启动；
- 浏览器端插件管理页也能正常列出该插件，点击展开详情卡片也未发生白屏崩溃；
- **但配置面板固定显示提示文案：“当前宿主未提供本插件的配置通道，开关暂不可用”**；
- 打开浏览器控制台，发现表单控制器的 `state.status` 永远停留在 `'unavailable'` 或 `'loading'`，配置面板的所有控件被直接禁用或降级隐藏。

---

### 10.2 跨端 JSON-RPC 调用链底层根因深度解密

问题的根源出在**宿主向浏览器广播配置表单 Schema 时的跨端序列化机制**。

```
[Host 侧]
插件声明 Config (含有 Schema.transform 闭包函数)
   │
   ▼
dsh-settings.describe() 收集表单描述 (volatileForm)
   │
   ▼
form.toJSON() 序列化为 JSON 字符串 (JavaScript 函数对象被静默丢弃！)
   │
   ▼  [跨端 JSON-RPC 传输通道]
   │
[Client 侧]
settingsSchema.rehydrate(serialized) 执行 new Schema(serialized) 反序列化
   │
   ▼
ConfigFormController.prototype.decode(view) 执行 this.schema.validate(rehydratedSchema, view.value)
   │
   ▼  【致命案发现场】
Schemastery transform 节点试图执行 callback(val) -> 抛出 TypeError: callback is not a function！
   │
   ▼
validate 捕获异常并返回错误文本 -> decode(view) 判定校验失败直接返回 undefined
   │
   ▼
derive() 中 draft.status = 'ready' 被跳过 -> 状态永久卡在 unavailable / loading！
```

#### 1. 致命断裂点：Schemastery 序列化无法保留函数闭包
开发者常试图在 Host 侧声明 Config 时使用 `Schema.transform` 拦截脏数据：
```typescript
// 典型反模式：在 volatile 字段上使用 Schema.transform
export const Config = Schema.object({
  disabled: Schema.transform(Schema.any(), (val) => cleanData(val)).default({}).volatile(),
})
```
宿主端的 `dsh-api-settings-controller` 在响应前端 `settings.describe()` 时，调用 `dsh-settings.describe()`，其内部通过 `volatileForm(schema).toJSON()` 把表单 Schema 转换成 JSON 树传输。
**JavaScript 函数闭包无法被 JSON 序列化**，序列化产物中的 transform 节点仅剩下 `{ type: "transform", inner: ... }`，`callback` 属性变为 `undefined`！

#### 2. 客户端反序列化抛错与状态阻断
浏览器端的 `ConfigFormController.prototype.decode` 源码如下：
```javascript
decode(view) {
  if (this.spec.decode !== void 0) return this.spec.decode(view.value);
  if (typeof view.value !== "object" || view.value === null || Array.isArray(view.value)) return void 0;
  let failure;
  try {
    failure = this.schema.validate(this.schema.rehydrate(view.schema), view.value);
  } catch (_malformedSchemaEnvelope) {
    return;
  }
  return failure === void 0 ? view.value : void 0;
}
```
当 `this.schema.validate` 运行时，Schemastery 递归到 transform 节点直接执行 `callback(val)`，瞬间抛出：
```text
TypeError: callback is not a function
    at Schema.resolve (schemastery/lib/index.cjs:554:15)
```
该错误导致 `failure` 变成错误信息字符串，`decode(view)` 判定格式不合法返回 `undefined`！
随后的 `derive()` 状态机更新逻辑中：
```javascript
const decoded = this.decode(view);
this.store.update((draft) => {
  draft.revision = view.revision;
  draft.base = view.base;
  draft.user = view.user;
  draft.writable = writable;
  if (decoded === void 0) return; // 致命断路：校验失败直接 return！
  draft.status = "ready";
  draft.value = decoded;
});
```
`draft.status = "ready"` 永远无法被执行，表单状态永远保持在初始的 `'unavailable'` 或 `'loading'`，在界面上呈现为配置通道不可用。

---

### 10.3 架构避坑铁律与标准跨端范式

要彻底根除跨端表单假死，必须遵循**声明与清洗关注点分离**原则：

#### 铁律一：严禁在向前端暴露的 volatile 节点上使用 Schema.transform
所有需要跨端推送到浏览器并由官方设置表单管理的字段，其 Schema 必须保持为**纯数据结构描述**，严禁绑定任何包含可执行代码的 `transform` 节点。

#### 铁律二：使用无闭包的纯类型 Schema 声明
对于易变字典、自由选项或容灾字段，统一声明为 `Schema.any().default(...).volatile()` 或基元联合类型：
```typescript
// 正确跨端声明：纯类型节点，100% 免疫 JSON 序列化闭包丢失
export const Config = Schema.object({
  // 字典型易变配置：使用 any 兜底，免去 Loader 校验崩溃，且 JSON 序列化无损
  disabled: Schema.any().default({}).volatile(),
  // 枚举型易变配置：使用基元联合类型或 any 兜底
  language: Schema.any().default(undefined).volatile(),
  // 历史废弃兼容字段：声明必须保留且带 volatile
  legacyItems: Schema.any().default({}).volatile(),
})
```

#### 铁律三：双侧纯函数运行时归一化分工
数据清洗与容灾自愈不应侵入 Schema 声明，而应下沉为两端各自独立的无副作用纯函数：
- **Host 侧**：在插件 Provider 或服务读取配置时，通过 `readConfig(ctx.config)` 纯函数调用清洗逻辑（如 `extractCleanData`），清洗非标值、剔除原型污染；
- **Browser 侧**：在前端控制器（`PanelModel`）读取快照时，通过 `extractCleanData(rawSnap.value)` 纯函数调用清洗逻辑，向 React 视图输出安全干净的纯字典（使用 `Object.create(null)` 防御）。

---

### 10.4 方案对比矩阵

| 评估维度 | Schema.transform 方案 (反模式) | 纯类型 Schema + 双侧纯函数方案 (标准架构) |
| :--- | :--- | :--- |
| **跨端 JSON-RPC 序列化** | **致命缺陷**：`callback` 闭包丢失，客户端报 `TypeError: callback is not a function` | **100% 兼容**：纯数据结构无损跨端反序列化 |
| **表单就绪状态 (status)** | **永久卡死**：`decode` 返回 undefined，状态永远停留在 `unavailable` | **毫秒级就绪**：校验顺利通过，瞬间转入 `ready` |
| **Loader 脏数据防崩** | 强绑定 Schemastery 运行时处理 | `Schema.any()` 天然接受任意脏类型，Loader 零崩溃 |
| **原型链攻击防御** | 需在 transform 回调里小心处理 | 统一经 `Object.create(null)` 纯函数集中防御，零污染 |
| **代码可测试性** | 强依赖 Cordis/Schemastery 容器环境 | 纯函数零依赖，纯 Node 环境毫秒级脱机单测 |

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
vendor/cordis  <-  @deepseek-ai/cordis@4.0.4
vendor/loader  <-  @deepseek-ai/cordis-plugin-loader@1.0.5
apps/cli  <-  @deepseek-ai/dsh@0.2.0-rc.2
packages/boot/app-boot  <-  @deepseek-ai/dsh-app-boot@0.2.0-rc.2
packages/bundle/base  <-  @deepseek-ai/dsh-base@0.2.0-rc.2
packages/boot/config-editor  <-  @deepseek-ai/dsh-config-editor@0.2.0-rc.2
packages/experimental/voice-input-bundle  <-  @deepseek-ai/dsh-experimental-voice-input-bundle@0.2.0-rc.2
packages/mcp/mcp-client  <-  @deepseek-ai/dsh-mcp-client@0.2.0-rc.2
packages/settings/settings  <-  @deepseek-ai/dsh-settings@0.2.0-rc.2
packages/bundle/web-app  <-  @deepseek-ai/dsh-web-app@0.2.0-rc.2
schema 库             <-  schemastery（lib/index.mjs 的 validateVolatileSchema / toJSON / resolve）
```