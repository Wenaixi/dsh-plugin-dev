# 客户端加载与产物取证：注册 id、组合 URL 与「改了不生效」的根因定位

> 适用范围：双面 UI 插件在浏览器里「Failed to load plugins」、组合脚本报 `loaded without registering`、或改了代码但界面/行为仍是旧的。
> 核心命题：**客户端加载是一条可逐字节取证的链**——注册 id 必须与包名一致、rev 只认产物元数据、实例必须加载到你的产物。三层都查过，才能定位「到底加载了谁」。

---

## 零、整条链的真相速览

| 层 | 事实 | 出处 |
| --- | --- | --- |
| 注册 id | `window.__ModuleLoader__.load({ id, factory })` 的 id 必须**等于包名**。client-modules 按 Loader 行的模块说明符解析条目 id，不一致时报 `loaded without registering "<id>"` 或 `already executed without registering`，整条 bundle 不激活 | dsh-client-modules lib/index.js（compose / orderByModuleGraph） |
| 组合 URL | 形如 `/plugins/??<pkg>/client.js,<pkg>/client.js&rev=<framedHash>`；`??` 是组合前缀，逗号分隔多包，rev 是帧哈希 | dsh-client-modules comboUrl / comboSearch |
| rev 语义 | `rev` 由产物文件 mtime/ctime/size 派生（artifactRevision），**不是内容哈希** | dsh-client-modules artifactRevision |
| 实例加载 | profile 的 `node_modules/<pkg>` 指向哪，加载器就读哪（含 junction 目标） | dsh-client-modules locatePkgJson / nearestPackage |

**结论**：客户端「没生效」永远是三选一——注册 id 不对、组合没进图、或者加载器读到的是旧产物。三者都能用字节取证，不需要猜。

---

## 一、错误形态与报错长什么样

### 1. 注册 id 与包名不一致（改名后最常见的坑）

把包从 `my-plugin` 改成 `@scope/my-plugin`（scoped 化）时，构建脚本里写死的 `id` 没同步改。浏览器控制台/启动遮罩报：

```text
web boot: 1 entry did not activate
could not load "<包名>": ...&rev=...: already executed without registering "<包名>";
plugins/??<包名>/client.js&rev=...: loaded without registering "<包名>" via __ModuleLoader__.load
```

**两条线索缺一不可**：`already executed without registering`（组合批次跑完了但没注册）与 `loaded without registering ... via __ModuleLoader__.load`（单体 URL 也白加载）。任何一条出现都说明**注册 id ≠ 加载器期望的 id**。

根因在构建配置：bundle 产物开头的 `id: "<旧名>"`。修法是让构建 id 取包名（或写成同一个常量），不是改加载器。

### 2. 组合 URL 与 rev 的取数

浏览器 Network 面板里找 `/plugins/??...` 请求：

- 404 → `exports["./client"]` 指向的文件不存在（缺构建产物或路径错）；
- 200 但注册 id 不对 → 见上；
- 200 且 id 对但行为旧 → 见 §三（rev/实例问题）。

**组合 URL 本身可直接请求取证**：`GET /plugins/??<pkg>/client.js&rev=<rev>` 返回的就是拼接好的注册脚本，读它的开头 `id: "...` 立刻知道注册了谁。

---

## 二、rev 只认产物元数据：为什么「改了不生效」

`artifactRevision` = 产物文件 mtime/ctime/size 的 framedHash。含义：

- **内容变了但 mtime/size 没变（极端）→ rev 不变**；正常构建 mtime 会变。
- 响应头 `public, max-age=31536000, immutable`——rev 不变浏览器永远用缓存。
- 所以「版本号已变、界面还是旧的」= 产物没重构建 或 实例没读新产物。浏览器刷新/重开面板**都不够**，桌面端必须完全退出应用重启。

**判定动作**：直接请求产物 URL，读 rev 与内容；与本地 `lib/client.js` 逐字节比对。

---

## 三、「改了代码但行为不变」的实例取证

本地开发最常见的坑：**profile 的 `node_modules/<pkg>` 指向 pnpm 实体，而不是你的仓库根**。pnpm 实体里是安装那一刻的快照——之后你在仓库里改的代码、重构建的产物，实例全部读不到。junction 指向 pnpm 实体时同样如此（junction 的目标是实体目录）。

判定三步（全用字节取证）：

```sh
# 1) 解析真实路径：它指向哪
node -e "console.log(require.resolve('<pkg>/package.json'))"

# 2) 看真实路径下的 client.js 是不是你最新构建的
#    与仓库 lib/client.js 逐字节对比（哈希或 Select-String 关键符号）

# 3) junction 也要查目标
Get-Item '<profile>/node_modules/<pkg>' | Select LinkType, Target
```

修法：把顶层 junction 指向仓库根（Windows：`New-Item -ItemType Junction -Path ... -Target <仓库根>`），并删掉 profile 里所有旧的 pnpm 实体（`@scope+pkg_<hash>`）避免解析回退。**重新构建后必须重启宿主进程**——客户端长缓存不认内容。

配套铁律：

- 本地联调一律让实例指向仓库根，改完 `pnpm build` → 完全重启宿主 → 浏览器强刷；
- 发布前用 `npm pack --dry-run --json` 核对清单，`lib/client.js` 必须在；
- 每次「没生效」都先回答「加载器读到的是哪个文件、它的注册 id 是什么」，再谈其他。

---

## 三之二、产物目录里的遗留物：删了源码不会自动删声明

构建产物目录里有两类文件：一类由打包器从源码重建（会覆盖），
一类由声明编译器累积生成（只新增与覆盖，不回收）。
后者的典型是类型声明与其映射文件、代码映射、缓存清单。

**后果**：删掉源文件后，对应的声明仍留在产物目录里，并会出现在打包清单中，
成为已发布内容的一部分；产物目录与源码树的文件集合也不再一致。

**判定动作**：打包前把产物目录与源码目录的文件名集合做差集，出现差集即阻断。
**处置**：删除源文件时同步删除对应产物，并把这条写进删除流程。

**通用形态**：任何「生成物目录加不做清理」的组合都有这个问题。

## 三之三、口径漂移：文档里的数字会静默过期

文档里从某次实测抄来的数字（产物体积、条数上限、默认项数），
在下一次改动后就变成错的。错的数字会被当作规格使用，比没有数字更有害。

两条处置：

1. 改动产物或默认值的提交同步更新数字；
2. 更好的写法是改成不写具体数值（「受上限设置约束」），把真源指回设置本身。

**可失败检验**：这类断言应动态计算真实值再比对，而不是写死期望字符串——
写死等于把每次变更都变成一次门禁修改，漏改就静默失效。

## 四、启动遮罩「Failed to load plugins」的四分法

`Failed to load plugins` 遮罩 + `N entry did not activate` 只点名了插件，没点名原因。定位顺序：

1. **注册 id**：请求 combo URL 读开头 id，与包名比对（不一致报 `loaded without registering`）；
2. **组合进图**：`window.__DSH_BOOT__.entries` 里找包名（不在 = Loader 没激活 `dsh.client` 行）；
3. **产物字节**：实例 node_modules 下的 client.js 与最新构建逐字节比对（排查 pnpm 静态快照副本未更新）；
4. **服务注入时序**：检查客户端导出是否缺少 `inject: ['slots', 'locale', ...]` 显式声明（在冷启动纯净实例中抛未捕获 TypeError 导致 `fiber === undefined`）。

---

## 五、冷启动依赖注入时序与「1 entry did not activate」根因诊断 (The Cold-Boot Client Dependency Injection Trap)

### 5.1 现象与假阳性陷阱

在日常 profile（装有数十个官方和社区插件）中，插件的客户端面板运行完全正常、无任何报错；但在新建的**干净/隔离实例**冷启动时，页面卡死在启动遮罩，提示：

```text
HARNESS
Failed to load plugins
<包名>
web boot: 1 entry did not activate
<包名>: failed
```

服务端控制台没有任何报错，Network 中请求 combo URL 也是 200 OK，且静态代码已完整传输。

### 5.2 核心机理：宿主 Bootloader 的 fiber 判定

查阅 DSH Web 主框架（`dsh-web-app`）中的启动加载器源码：

```js
async function JS(e) {
  const { ctx: n, manifest: o, onEntryState: s } = e;
  // ...
  await e.modules.entries.start(a, o);
  for (const f of a.entries()) {
    f.fiber === void 0 && s?.(f.options.name, "failed");
  }
  await a.await();
  eM(n, e.modules);
}

function eM(e, n) {
  const o = [];
  for (const s of e.loader.entries()) {
    const a = s.options.name;
    if (s.fiber === void 0) {
      const f = n.importError(a);
      o.push(f === void 0 ? `${a}: failed` : `${a}: import failed: ${f.message}`);
      continue;
    }
    const u = A7[s.fiber.state];
    if (u !== "active") {
      if (u === "pending") {
        const f = Object.keys(s.fiber.inject).filter(h => e.get(h) === void 0);
        o.push(`${a}: pending (waiting for service${f.length === 1 ? "" : "s"}: ${f.join(", ") || "unknown"})`);
      } else {
        o.push(`${a}: ${u}`);
      }
    }
  }
  if (o.length > 0) throw new Error(`web boot: ${String(o.length)} entr${o.length === 1 ? "y" : "ies"} did not activate\n${o.join("\n")}`);
}
```

**状态判定铁律**：
- 启动器遍历加载器条目，一旦某个插件的 `f.fiber === undefined`，直接在 UI 将其置为 `"failed"`！
- `fiber === undefined` 意味着该插件的客户端模块在被加载器调用初始化（实例化 Fiber）时，执行内部的 factory 或调用 `apply(ctx)` 抛出了**同步未捕获异常**！

### 5.3 为什么会抛异常：Cordis 客户端依赖注入时序

客户端模块的执行是基于 Cordis 微内核的：
1. 若客户端插件入口（`src/client.entry.ts`）仅仅导出了 `export function apply(ctx)`，而**未显式导出 `inject` 数组**：
   - Cordis 认为该插件不依赖任何外部服务；
   - 在客户端启动的极早期（bootstrap 阶段刚结束），Cordis 立即无等待调用插件的 `apply(ctx)`；
   - 此时宿主前端的 `ctx.slots` 或 `ctx.locale` 尚未被提供者挂载（为 `undefined`）；
   - 插件内执行 `ctx.slots.inject(...)` 或 `ctx.locale.register(...)` 立即抛出 `TypeError: Cannot read properties of undefined (reading 'inject')`；
   - 该异常导致 entry 的 fiber 初始化崩溃，插件瞬间被标记为 `failed`。
2. **为什么日常 profile 不报错**：
   - 日常 profile 中装有其他几十个插件（例如各类官方 UI 插件），其他插件显式声明了 `inject: ['slots', 'locale']`，在更早的时序唤醒并装载了相关服务；
   - 当有缺陷的插件被调用时，相关服务碰巧已经存在，掩盖了缺少声明的致命漏洞！
   - 这属于典型的**“隐式依赖被邻居满足”假阳性**，只有在仅装基础插件的隔离新实例冷启动时才会被暴击。

### 5.4 修复与规范标准

客户端源码（`src/client.entry.ts`）的末尾必须严格声明并同时导出命名与默认注入数组：

```ts
export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin: dictionaries')
  ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ...), 'plugin: config slot')
}

// 必须显式声明客户端必需的前端服务依赖
export const inject = ['slots', 'locale']
export default { apply, PanelController, inject }
```

> **注意**：`package.json` 的 `dsh.client.inject` 仅作为分发层元数据索引，宿主前端 Cordis 运行期真正依据的是模块导出对象上的 `inject` 属性。二者必须严格同步。

### 5.5 排查与诊断三步法

1. **HTTP 探测 Combo URL**：
   ```bash
   # 确认静态分发是否 200，内容长度是否正常
   curl -i "http://127.0.0.1:<port>/plugins/??<pkg>/client.js&rev=<rev>"
   ```
2. **审查 Boot 状态信封**：
   在浏览器控制台读取 `window.__DSH_BOOT__.entries.find(e => e.id === '<pkg>')`，检查其声明的 `inject` 列表以及在哪个 `batches` 批次中分发；
3. **隔离实例冷启动回归**：
   任何客户端代码修改，必须在纯净隔离新实例（仅包含 base + web-app + 本插件）上冷启动验证，绝不在日常 profile 绿了就声称交付。

## 相关 DSH 源码

```text
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@0.2.0-rc.2
  lib/index.js（load 注册语义、comboUrl/comboSearch、artifactRevision、locatePkgJson/nearestPackage）
```
