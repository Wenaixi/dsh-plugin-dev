# 客户端 i18n 实战：双语字典与构建产物的九条铁律

> 适用于：双面 UI 插件、`ctx.locale` 接入、构建脚本内嵌字典。官方参考实现：`@deepseek-ai/dsh-client-ui-plugin-manager`。

## 一、接入三件套（官方姿势）

```js
// package.json
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-locale", ...] } }

// client factory
var NS = "my-plugin";
var ZH = {...};  // 唯一字典真源
var EN = {...};

function apply(ctx) {
  ctx.effect(function () {
    return ctx.locale.register(NS, { zh: ZH, en: EN });
  }, "my-plugin: dictionaries");
  t = ctx.locale.bind(NS);
  ...
}
exports.inject = ["slots", "locale"];   // 显式声明，时序更稳
```

- `ctx.locale.register(ns, {zh, en})` 运行时只校验 locale 键为 BCP 47、重复 (ns,locale) 抛错，**不校验键集也不校验值**；zh/en 键成对是 `LocaleNamespaceMap` 的**编译期类型**强制（client-runner:1214）——运行时漏键不报错，切语言缺键时回退为 key。键成对仍建议发布侧脚本自检（见铁律 1）。
- `t(key, {name})` 支持 `{name}` 占位符模板替换。
- `exports.inject` 显式加 `"locale"`（成本零，注册时序更稳）。

## 二、铁律 1：双语键必须完全成对，值可以相同

`register` 的「bilingual balance」指**键成对**，与值无关。

- 某些条目故意保持单语（技能/插件描述不翻译、保持中文）→ 键**仍然要成对**，值写相同即可。
- 写完后用脚本校验：`flatKeys(zh).sort()` 与 `flatKeys(en).sort()` 必须逐元素相等；只差一个键，`register` 不会立刻报错，但切到另一语言会退回 key 本身（静默劣化）。

## 三、铁律 2：字典里不能嵌 `t()` 调用

构建脚本通常把字典序列化进模板。如果字典 JSON 的值里被写成了 `t("chain.hit")`（比如全文替换时误伤），注册后字典的值就是一段函数调用文本，显示即坏。

- 字典是**纯数据**（JSON 值），只含字符串，不含表达式；
- 组件 JSX 文案才用 `t("key")`；
- 全文替换时先修字典（用干净 JSON 覆盖），再在「模板区间」内替换文案——避免把字典值二次污染。

## 四、铁律 3：构建期 Node 计算，产物只内嵌字面量

```js
// ❌ 错误：把 Node API 写进模板字符串（浏览器端执行会 ReferenceError）
const content = `const SKILL_META = (function () {
  const dirs = readdirSync(...);   // 浏览器没有 readdirSync
})()`;

// ✅ 正确：脚本顶层（Node 端）算好，模板里 ${JSON.stringify(result)} 内嵌字面量
const SKILL_META_BUILD = extractSkillMeta();   // readdirSync/readFileSync 只在这个作用域
const content = `const SKILL_META = ${JSON.stringify(SKILL_META_BUILD)};`;
```

- 模板字符串内的代码只在浏览器跑，`require(node:fs)` / `process.exit` / `pathToFileURL` 全部不可用；
- 构建期提取 frontmatter/JSON 时**在 Node 端算完再内嵌**；
- 产物抽查两个方向：不含 Node API 残留（`readdirSync|process.exit|parseYaml`），且含预期的 frontmatter 文案。

## 五、铁律 4：宿侧下发的展示文案在客户端按 key 覆盖

诊断链/状态中文（如「生效中」「被覆盖」「值无效」）若来自宿侧 HTTP 响应字段（`label`/`problem`），**不要改宿侧契约**——

- 响应里带上稳定的 `level`/`id` 枚举，客户端展示时按枚举查字典覆盖：`t("level." + source.level)`、`t("problem." + source.level)`；
- 宿侧契约零改动，语言切换即时生效；
- 面板回写只发 id/枚举/布尔，不发文案往返。

## 六、铁律 5：语言切换即时刷新

字典注册只 bump revision（不 emit `locale/change` 事件）；监听刷新用 `ctx.locale.subscribe(() => reload())`（LocaleFace 语义），而不是 `on('locale/change')`。

## 七、铁律 6：字典真源与 meta 键共存

面板字典并入 `locale/*.json` 顶层键组（`panel`/`mode`/`toast`/…）时，宿主 `readPluginMeta` 只读 `meta` 键——加顶层键组不影响卡片元信息。构建脚本 import 同一份 JSON 作为唯一真源，不另起第二份。前提：浏览器侧 import `locale/*.json` 依赖该包 exports map 放行 `./locale/*.json`（官方如 dsh-schedule 已放行；未放行的包只能从 Node 端读）。

## 八、铁律 7：三态/多态配置字段在客户端的「缺项折叠陷阱」

当一个 volatile 配置字段具有三态语义（例如 `undefined` = 动态跟随宿主当前设置、`'zh'` / `'en'` = 用户显式锁定）时，客户端读取函数存在极易踩中的**缺项折叠反模式**：

```javascript
// ❌ 灾难：直接把未声明/缺项折叠成了兜底值 'zh'
function readLanguage(value) {
  return value && value.language === 'en' ? 'en' : 'zh';
}
```

**危害链路**：
1. 客户端状态快照把 `undefined` 强行吞成 `'zh'`；
2. 组件内部本意用于跟随的派生逻辑：`var effective = language === undefined ? hostActive : language;`，因为 `language` 永远非 `undefined`，**前半句永远死代码**；
3. 前端界面无法感知「跟随宿主」状态，面板永远显示为显式锁定的 `'zh'`；
4. 形成「Host 侧真实 Provider 动态跟随宿主，Browser 侧面板却固定显示中文」的**隐蔽跨端语义撕裂**。

**正确姿势**：读取函数必须显式保留 `undefined`，只有这样三态派生与未配置提示才可能生效：
```javascript
// ✓ 正确：三态干净透传，缺项严格返回 undefined
function readLanguage(value) {
  var raw = value && value.language;
  return raw === 'zh' || raw === 'en' ? raw : undefined;
}
```

---

## 九、铁律 8：分段选择器（SegmentedControl）的「合法配置态常驻」vs「未设置占位段」

官方 `SegmentedControl`（`@deepseek-ai/dsh-client-ui-primitives`）内部使用 `options.findIndex(o => o.value === value)` 确定高亮指示器的下标。若传入的 `value` 不在 `options` 列表中，下标为 `-1` 会导致**指示器滑出轨道外，且全段元素失去键盘可达性（`tabIndex=-1`）**。

在设计选项集合时，必须严格区分两类性质相反的段：

| 选项类型 | 典型代表 | 用户操作语义 | options 展示策略 |
|---|---|---|---|
| **合法配置态** | 「跟随宿主（自动）」 | 用户配过显式值后**仍必须能随时选回**的长期合法状态 | **options 中恒久常驻**（通常排在末尾），点击时提交 `{ op: 'unset', path: [...] }` 清空配置，**严禁条件追加/收走** |
| **未设置占位段** | 「未设置」 | 仅代表当前补丁未声明该字段、由内置默认兜底生效的临时提示 | **仅在未配置时追加**，用户一旦选择具体档位，该占位段随之消失 |

**铁律**：如果一个状态是用户在任何时候都可以切回的（如自动跟随宿主），切忌照抄占位段的条件追加写法——否则用户一旦点过具体选项，自动选项将永久消失，再也无法切回！

---

## 十、铁律 9：控件的作用域可见性与明确指引（Control Scope Labeling）

官方 `P.SegmentedControl` 的 `label` 属性仅作为 `aria-label` 输出到无障碍树，**不会在屏幕视觉上渲染可见文本**。

**踩坑现象**：
在插件配置面板中放置语言切换或模式选择时，若仅孤立放置一个 `[ 中文 | English | 跟随宿主（自动） ]` 控件，用户完全无法理解：
- 这个切换改变的究竟是整个 DSH 主界面的语言？
- 还是当前插件设置页面的 UI 界面？
- 还是插件注入给大模型的 Prompt / 技能描述？
- 或者是下方的技能执行正文代码？

**规范要求**：
1. **显式可见标题**：必须在选择器正上方渲染独立的加粗区域标题（例如使用 DSH 标准字阶 `font: var(--dsw-font-xs-strong-13)` 渲染 `技能介绍语言（用户「/」唤出菜单及模型可见）`）；
2. **状态感知详细提示**：
   - 未配置态：提示当前正在动态跟随的宿主界面语言（如「当前跟随宿主界面语言（中文），可在上方显式切换」）；
   - 任何状态下：清晰告知作用域边界——**受控范围**为用户输入「/」唤出技能菜单展示的介绍与模型可见描述；**不受控范围**为插件正文（保持原版）与面板其余 UI（恒跟随宿主界面语言），消除一切用户困惑。

---

## 十一、反向断言门禁

- `build script` 不得含硬编码中文文案（`t(` 之外无中文字符串字面量，字典 JSON 除外）；
- 必须含 `ctx.locale.register(NS` 与 `exports.inject` 含 `locale`；
- 覆盖展示的 `t("level." + source.level)` 必须存在。
- 每条断言做过破坏实测（删掉后确认会红，再还原）。

---

## 相关 DSH 源码

上游仓库 `deepseek-ai/deepseek-harness` 内的相对路径。版本号取自各包 `package.json` 的 `version` 字段，仓库位置取自 `repository.directory` 字段，均不靠推测。
本机核对位置与跨平台定位方式见 [source-verification-and-caches.md](./source-verification-and-caches.md)；版本升级后必须重新读源码核对本清单。

```text
packages/client/locale  <-  @deepseek-ai/dsh-client-locale@0.2.0-rc.2
packages/client/ui-plugin-manager  <-  @deepseek-ai/dsh-client-ui-plugin-manager@0.2.0-rc.2
packages/schedule/schedule  <-  @deepseek-ai/dsh-schedule@0.2.0-rc.2
```
