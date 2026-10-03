# 客户端 i18n 实战：双语字典与构建产物的六条铁律

> 适用于：双面 UI 插件、`ctx.locale` 接入、构建脚本内嵌字典。官方参考实现：`@deepseek-ai/dsh-client-ui-plugin-manager`、`@deepseek-ai/dsh-client-locale@0.2.0-rc.2`。

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

- `ctx.locale.register(ns, {zh, en})` 只校验「键值字典**成对**、同 ns 同 locale 重复注册抛错」，**不校验值**。
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

面板字典并入 `locale/*.json` 顶层键组（`panel`/`mode`/`toast`/…）时，宿主 `readPluginMeta` 只读 `meta` 键——加顶层键组不影响卡片元信息。构建脚本 import 同一份 JSON 作为唯一真源，不另起第二份。

## 八、反向断言门禁

- `build script` 不得含硬编码中文文案（`t(` 之外无中文字符串字面量，字典 JSON 除外）；
- 必须含 `ctx.locale.register(NS` 与 `exports.inject` 含 `locale`；
- 覆盖展示的 `t("level." + source.level)` 必须存在。
- 每条断言做过破坏实测（删掉后确认会红，再还原）。
