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

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/typert/protocol  <-  @deepseek-ai/dsh-typert-protocol
packages/api/gateway  <-  @deepseek-ai/dsh-api-gateway
packages/bundle/base  <-  @deepseek-ai/dsh-base  （agent-instructions 全局文件常量）
packages/boot/app-boot  <-  @deepseek-ai/dsh-app-boot  （evaluatePluginCompatibility）
vendor/cordis  <-  @deepseek-ai/cordis
```
