# 实战经验深度提炼：写接口防御、编码链路、CLI 解析与全局包健康 (Field Experience Extraction)

> 适用范围：DSH 插件从"单测全绿"推进到"真机验收"阶段的所有插件，尤其是含**写盘副作用**、**跨端带参 RPC**、**多实例/多 CLI 环境**的交付。
> 核心命题：**静态与单测之外，真机验收会暴露四类教科书测不到的问题——写接口的静默破坏、非 ASCII 请求体的编码漂移、同机多份 CLI 的解析歧义、全局 npm 包的残骸状态。每一类都有通用的防御与取证方法。**

本篇只提炼可迁移的机制与判据，不承载任何单一仓库的包名、路径或版本号；与具体仓库相关的叙述见各项目记忆库。

---

## 一、写类 Remote 方法的输入防御（Write-API Input Defense）

### 1.1 事故机理：缺省字段被静默当成"合法空值"

写类 Remote 方法（保存内容、切换文件、写配置）若在函数体里写：

```ts
const content = typeof payload?.content === 'string' ? payload.content : '';
```

当调用方（自动化探针、误按的客户端、未来重构后的旧调用方）发送**空载荷**（`payload` 缺 `content`），缺省分支把空串当成合法内容，随后 `temp+renameSync` 原子替换直接把目标文件**覆写为 0 字节**。原子写保证"写成功"，恰恰让这种事故**零报错、不可逆**——文件系统没有中间态可回滚。

### 1.2 通用防御（写方法第一行，不是最后）

```ts
if (typeof payload?.content !== 'string') {
  throw new Error('saveContent requires a string "content" field; refusing to write');
}
```

- **缺省即拒绝**：写类方法不允许任何"无输入默认值"路径；缺字段直接 throw（错误会经 RPC 信封 `{ok:false, error:{code:'gateway/internal', message}}` 返回，调用方可见，且**目标文件字节不变**）。
- **校验放第一行**：校验必须先于一切副作用（读目录、拼路径、开临时文件）。
- **枚举字段白名单**：文件名/目标名这类枚举参数同样拒绝未知值（`target !== 'a' && target !== 'b'` 即 throw）。
- **这条防御写进验收**：真机验收必须有一条用例**故意发空载荷**，断言返回 `{ok:false}` 且目标文件 md5 不变——证明防御真的在场。

### 1.3 自动化探针纪律（对验收脚本自己的要求）

- 探测写类 RPC 前，**先列全该方法的必填字段**（读宿主方法签名或描述符），再构造完整 payload；禁止先发空 payload"试试接口存不存在"。
- 对"试接口"需求，用只读方法（describe / 读取类 getter）或新建临时目标，绝不指向真实用户数据文件。

---

## 二、含非 ASCII 文本的请求体编码链路（Non-ASCII Payload Encoding）

### 2.1 事故机理：shell 内联 JSON 被终端编码转码

在 Windows shell（PowerShell / git-bash）里用**内联字符串**构造含中文的 JSON 请求体时，shell 按当前代码页（常见 GBK/cp936）把字符编码后送进管道；宿主按 UTF-8 解析，中文字符全部变成乱码字节写入目标文件，文件大小与 md5 与预期不符，且内容不可读。

### 2.2 通用规则

- **含非 ASCII 的 JSON 一律先写文件**：用 UTF-8 无 BOM 写 `body.json`，再 `curl --data-binary @body.json`。
- **禁止 shell 内联**：`curl -d '{"content":"中文"}'` 这类形态在 Windows 一律不用。
- **写文件时用工具写 UTF-8**，不要用重定向把 shell 输出送进文件（输出本身已被转码）。
- **判据链**：先 `wc -c` 校验请求体文件字节数符合预期（中文字符 UTF-8 每字 3 字节），再发请求，再 `cmp`/md5 对比目标文件——三层都过才算通路正确。
- 这也适用于任何经 shell 传递含 CJK 文本的自动化脚本（含测试夹具路径里的中文目录名）。

---

## 三、编辑器写盘链路的真值判据是磁盘字节（Disk-Bytes Truth for Editor Writes）

### 3.1 为什么前端 toast 不是判据

编辑器（textarea + 保存按钮）链路：前端草稿 → 带参 RPC → 宿主写盘。前端 toast「已保存」只证明 RPC 信封返回 ok，不证明**磁盘字节**正确（编码漂移、字段被截断、写到别的路径都能让 toast 照常显示）。

### 3.2 通用验收链（三段一致才算过）

1. **注入可识别标记**：向 textarea 追加 `\n\n<!-- acceptance-marker -->`。React 受控组件要用原生 value setter（`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text)`）+ 手动 `dispatchEvent(new Event('input', {bubbles:true}))`，直接改 `.value` 不会触发 React 状态。
2. **点击保存按钮**（按完整文案匹配按钮文本；等待异步写入完成，宿主队列 + 镜像折叠需要一小段稳定时间）。
3. **磁盘取证**：`wc -c` 目标文件 = 原字节数 + 标记字节数；`tail -c <n>` 末尾正是标记原文；随后把原文件备份拷回（`cp` + `cmp` 校验），验收环境不留脏数据。

### 3.3 还原纪律

任何写盘验收完成后必须**把真实用户数据文件还原到验收前状态**（备份 → 拷回 → md5/cmp 校验一致），验收脚本绝不能把用户的正式文件留在被注入标记的状态。

---

## 四、同机多份 dsh CLI 的解析歧义（Multi-CLI Resolution Ambiguity）

### 4.1 现象分类

同一台机器上可能同时存在多份 dsh 命令：

| 来源 | 版本特征 | 归属 |
| --- | --- | --- |
| npm 全局安装（`%APPDATA%/npm/dsh.cmd` 等） | 随你装的版本 | CLI 形态 |
| 桌面版应用自带（`<App>/resources/runtime/cli/bin/dsh.cmd`） | 随桌面版发行版本 | 桌面形态 |

裸 `dsh` 解析到哪份由 **PATH 顺序**决定，与"你脑子里想的是哪份"无关。用**错误版本**的 CLI 装配 profile 时，宿主启动整屏红字警告：官方插件逐个报 `Plugin ... is incompatible with dsh ...: requirements {...}` 并被禁用——这不是实例坏了，是**装配引擎版本 ≠ profile 插件期望版本**。

### 4.2 通用处置

- **先验身份再动手**：`where dsh`（或 `Get-Command dsh`）看解析到哪份；`dsh --version` 确认版本。两份都出现时用**绝对路径**调目标那份，不依赖 PATH。
- **profile 自带 CLI 优先**：pnpm 安装的 profile 有 `node_modules/.bin/dsh.cmd`（与 profile 插件同版本），`cd <profile>` 后用 `.\node_modules\.bin\dsh.cmd` 启动，天然版本对齐。
- **版本对齐是第一因**：红字"incompatible with dsh"警告先查 CLI 版本，不要先去怀疑插件或配置。
- 桌面版 CLI 的 launcher 形态：它设 `ELECTRON_RUN_AS_NODE=1` 调应用内 asar 里的 host——只依赖应用自带运行时，**与全局 npm 包完全无关**（见 §五）。

---

## 五、全局 npm 包残骸与自愈重装（Global npm Package Debris）

### 5.1 残骸特征

中断的 `npm install -g` 会留下**只有 `node_modules/` 子目录、无 `package.json`/`lib/`** 的包目录。此时 `npm ls -g --depth=0` 显示该包**版本为空**；npm 根目录还可能有 `.dsh-xxx` 临时残留文件。

### 5.2 处置

- 判定：`npm ls -g` 版本为空 + 目录无 package.json = 残骸，不需要手工清理，**直接重装同版本即可自愈**（`npm install -g <pkg>@<version>`，added/changed 大量包后目录结构恢复）。
- **共享依赖池联动**：`$DSH_HOME/profiles/node_modules/` 常是共享池，其条目可能是指向全局 npm 目录的 junction/symlink——重装全局包后共享池自动指向完整包。升级 profile 前检查共享池条目指向是否有效。
- **profile 升级失败先查两处**：① `pnpm-workspace.yaml` 的 `autoInstallPeers`（false 时缺 peer 导致 failed to import）；② 共享池 @deepseek-ai 条目指向损坏全局包（安装日志无报错但启动 failed to import）。

---

## 六、官方机制不读全局 CLAUDE.md——上游契约判据（Official Global-File Contract）

- 官方指令插件源码里全局文件名是**硬编码常量**（`const USER_GLOBAL_FILE = "AGENTS.md"`），全局候选目录列表只贡献这个固定文件名；`CLAUDE.md` 只出现在**项目目录**候选数组里。
- 因此"全局也想读 CLAUDE.md"这个需求**官方机制下做不到**——这不是配置问题，是上游契约。要做只能由插件**接管注入**（在事件钩子里替换/补充官方注入的消息）。
- 通用判据：遇到"官方 UI 看起来该有的能力"，先读官方源码确认是**机制缺口**还是**配置项**；机制缺口才是插件的机会面，也决定了插件必须接管哪条事件链路。

---

## 七、逐层独立策略的夹具验证法（Per-Layer Independent Verification Fixture）

当插件有多个"层"（全局/项目/子目录）且每层有独立策略时，验证"层与层互不影响"的正确姿势是**一个夹具一次跑完**：

- 建临时工程目录（`package.json` + 各层指令文件各一份，内容带**互不相同的可识别标记**）。
- 把各层策略同时设成**四种不同值**（如 disabled / 极小截断 / 中等截断 / 不截断），跑一次渲染。
- 断言每个标记的**最终状态与各自层策略一一对应**（截断层标记消失且字节数精确、disabled 层整层不出现、unlimited 层全文保留）——四层一次验证，证明策略互不渗透，而不是四个单测各自证明自己。

---

## 八、带参 RPC 的客户端描述符必须写全参数（Parameterized Remote Descriptors）

- 零参方法（如 `snapshot()`）客户端描述符可以省略 `parameters`；**带参方法不能照抄省略**——客户端网关对每个 descriptor 的每个参数做 strict codec 校验，省略参数会抛 `generated Remote <ns>/<method> field "<wire>" has no strict codec`。
- 带参方法描述符形态：`parameters: [{name, wire, source:'json', codec:{mode:'strict', typeSymbol, create: 恒等}}]`，`result: {mode:'strict', typeSymbol, create: 恒等}`——strict 只校验模式字段本身，create 恒等即充分（解码缺省原样透传）。
- 宿主侧方法签名：单参数对象 `payload` +（可选）末位 `signal`；业务实参在 wire 上表现为 `payload.args.payload = {字段}` 的嵌套（因为宿主签名只有一个参数）。
- 客户端调用返回 `{ok:true, value} | {ok:false, error}` 信封，必须拆包。

---

---

## 九、切换/选择语义的只读性与惰性创建防御 (Read-Only Switching & Lazy-Creation Defense)

### 9.1 事故机理：切换操作自动创建占位导致脏数据

在具备多文件编辑、多模板选择、或全局备选文件的插件 UI 中，若在用户点击切换（Switch）时检测到目标文件不存在，就试图"顺手克隆一个模板"或"新建一个 0 字节占位文件"，会引发严重副作用：
- 用户仅仅为了在前端查看、对比或好奇点了一下某个标签，磁盘上就立即生成了未受用户确认的垃圾文件；
- 破坏了"目标文件原本不存在"的原生环境特征，导致依赖"目标存在性判断"的外部宿主行为发生偏离；
- 违背了"只读操作绝不产生磁盘副作用"的基本工程底线。

### 9.2 通用架构契约：选择纯只读，创建全惰性

1. **选择接口严格只读（Switch is Pure Read-Only）**：
   - 切换文件/项的 RPC（如 `switchTarget({ target })`）严禁包含任何创建、拷贝或覆写磁盘的逻辑；
   - 目标文件存在时：读取实际内容与大小，返回 `{ ok: true, exists: true, content: '...', bytes: N, target }`；
   - 目标文件不存在时：绝不抛出 404 挂起前端，而是优雅返回 `{ ok: true, exists: false, content: '', bytes: 0, target }`。
2. **前端受控渲染空白（Draft on Empty）**：
   - 客户端 Store 接收到 `exists: false` 响应后，将编辑器草稿内容受控置为空字符串 `""`，并将当前活跃标签钉在用户选中的 `target` 上；
   - 此时磁盘无任何写入，若用户关闭页面或切走，磁盘依然保持原始纯净状态。
3. **保存接口惰性新建（Lazy Creation on Save）**：
   - 只有当用户输入了内容并明确点击"保存"（Save）按钮时，才由保存接口（`saveContent({ target, content })`）执行真正的落盘；
   - 保存接口底层采用**临时文件 + `renameSync` 原子写**（若目标文件原本不存在，`rename` 同样天然完成新文件的创建，无需额外的 `touch` 或预处理步骤）。
4. **保存后原位刷新（In-Place Refresh）**：
   - 保存成功后，前端立即重新调用当前目标标识的查询（`switchTarget({ target: currentTarget })`），把状态无缝更新为 `exists: true` 与实际字节数，标签维持在当前项，避免交互视图发生跳动。

---

## 十、DSH 运行环境与运行时路径层级陷阱 (DSH Runtime Path Hierarchy Traps)

### 10.1 事故机理：粗暴覆盖环境变量导致 Profile 寻找链断裂

在开发需要访问宿主根目录或全局配置的插件时，自动化脚本或测试常试图通过临时设定 `DSH_HOME=/path/to/temp` 来模拟隔离沙箱。但在真实 DSH 宿主架构中：
- 环境变量解析时机受宿主引导器（如 `app-boot`、`home-paths`）的初始化时序约束；
- 部分核心子系统在加载 profile 时依赖约定的固定目录结构（如 `~/.dsh/profiles/<profile-name>`）；
- 若仅仅在外部强行修改全局环境变量，往往导致宿主找不到当前启动所需的 profile 目录，整机报 "Profile not found" 退出。

### 10.2 通用解耦原则：Service 构造注入 > 依赖全局环境

1. **构造器显式保留路径覆盖参数**：
   ```ts
   export class CustomStorageService extends TypertRemoteService {
     private customHomeDir?: string;
     constructor(ctx: Context, customHomeDir?: string) {
       super(ctx, 'custom-storage');
       this.customHomeDir = customHomeDir;
     }

     protected resolveWorkingDir(): string {
       return this.customHomeDir?.trim() || getSystemDshHome();
     }
   }
   ```
   - 生产环境通过 `ctx.plugin(CustomStorageService)` 挂载，默认走标准环境解析；
   - 自动化单测与沙箱验收时，直接 `new CustomStorageService(new Context(), tempSandboxDir)` 传入隔离沙箱路径；
   - 完全不污染当前进程或全局操作系统的环境变量，从根源规避时序竞态与路径断裂。
2. **全流程端到端验证依附真实 Profile 目录**：
   - Profile 级别的全真验收必须在真实的 Profile 仓库（如 `$DSH_HOME/profiles/<test-profile>`）中进行；
   - 用 `dependencies` 与软链接（Junction / Symlink）把被测插件链接到该 Profile 的 `node_modules`，验证宿主在默认环境下的完整装配流。

---

## 十一、客户端 ModuleLoader 异步 Store 状态闭环 (Client Store Closed-Loop)

### 11.1 事故机理：全局拉取打乱局部交互意图

在包含多标签选择或分层配置的前端面板中，保存某个分项配置后，若直接调用全局的 `load()` 重新获取初始数据：
- 全局查询接口往往按宿主默认的优先级返回首项（例如永远返回默认选项 A）；
- 用户明明正在编辑并保存了子项 B，保存成功后界面却由于全局拉取突然弹回选项 A，草稿被冲掉，造成严重的交互撕裂。

### 11.2 状态闭环范式

在客户端构建（如 `scripts/build-client.mjs`）生成的模块工厂中，异步状态 Store 必须显式维护当前交互目标：
```js
var save = function (filename, text) {
  var ns = endpoint("saveContent");
  if (ns === null) return Promise.resolve(false);
  return Promise.resolve(ns.saveContent({ filename: filename, content: text }))
    .then(function (response) {
      var value = unwrap(response);
      if (value === undefined || value.ok !== true) return false;
      // 关键：保存成功后显式刷新当前保存项，绝不直接退回无参全局 load()
      return switchTo(filename);
    })
    .catch(function () { return false; });
};
```
- **状态钉住（Target Pinning）**：操作哪项，回调就刷新哪项；
- **单向数据流与解包**：通过 `unwrap(response)` 严格判定信封 `{ok: true, value}`，遇错进入安全错误态，绝不对未定义载荷盲目解构。

---

## 十二、装配树真实性断言与命名空间回读法则 (Assembly Tree Truth & Namespace Read-Back)

### 12.1 为什么"写进了 package.json"不等于"插件已激活"

在 DSH 插件开发中，仅在 profile 的 `package.json` 的 `dependencies` 和 `bundles` 中填入了插件包名，**绝对不代表插件已被宿主容器加载生效**：
- 入口未按规范导出 `Config` Schema（会导致宿主丢弃整个插件 settings 注册）；
- 宿主与插件 peerDependencies 版本不兼容；
- 异步依赖服务缺失导致插件挂起未完成装配。

### 12.2 不可伪造的双重真值判据

1. **冷装配置装配树断言（CLI 物理级）**：
   - 运行 `dsh.cmd --profile <profile> --dump-config`；
   - 必须能在输出文本中检索到明确的插件段落：
     ```yaml
     # == <plugin-name>
     - id: <plugin-name>
       name: <plugin-name>
     ```
   - 若输出中未出现该注释头与条目，证明插件在引导阶段已被宿主静默剔除。
2. **命名空间计数回读（API 协议级）**：
   - 访问宿主配置端点（如 `settings/describe`）；
   - 装配插件前总命名空间数为 `N`，装配并激活后必须精确增加为 `N + 1`（且返回的清单中包含该插件的 namespace）；
   - 从 bundles 移除后热重载或冷启动回读，命名空间数必须精确回退至 `N`。
   - 这种物理数目的对比是验证插件真正激活与完全卸载的最高置信度凭据。

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/typert/protocol  <-  @deepseek-ai/dsh-typert-protocol@<version>
packages/api/gateway      <-  @deepseek-ai/dsh-api-gateway@<version>
packages/bundle/base      <-  @deepseek-ai/dsh-base@<version>
packages/boot/app-boot    <-  @deepseek-ai/dsh-app-boot@<version>
vendor/cordis             <-  @deepseek-ai/cordis@<version>
```