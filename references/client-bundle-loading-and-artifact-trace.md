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

## 四、启动遮罩「Failed to load plugins」的三分法

`Failed to load plugins` 遮罩 + `N entry did not activate` 只点名了插件，没点名原因。定位顺序：

1. **注册 id**：请求 combo URL 读开头 id，与包名比对；
2. **组合进图**：`window.__DSH_BOOT__.entries` 里找包名（不在 = Loader 没激活 `dsh.client` 行）；
3. **产物字节**：实例 node_modules 下的 client.js 与最新构建逐字节比对。

## 相关 DSH 源码

```text
packages/client/modules  <-  @deepseek-ai/dsh-client-modules@0.2.0-rc.2
  lib/index.js（load 注册语义、comboUrl/comboSearch、artifactRevision、locatePkgJson/nearestPackage）
```
