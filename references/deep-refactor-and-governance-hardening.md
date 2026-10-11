# DSH 插件深度重构、构建原子时序与工程治理严密化指南

> 本指南归纳自 DSH 双面插件及复杂运行时插件的架构重构与治理实战，提供跨插件通用的防坑工程法则。拒绝特定项目私有假设，聚焦高杠杆、可复现的工业级实践。

---

## 一、构建流水线的「先验后写」原子时序 (Pipeline Atomicity)

### 1.1 痛点成因：后置校验导致的脏产物落盘污染
在双面插件（Dual-Face）或编译型插件的自动化构建脚本中，经常需要执行两项职责：
1. 校验源码内联元数据（如清单镜像、配置 Schema）与物理资产目录是否一致；
2. 将构建产物或源文件同步/复制到分发目录（如 `lib/` 或 `dist/`）。

许多构建脚本的直觉写法往往是：
```javascript
// [错误] 脆弱的时序：先写磁盘，后做校验
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target); // 或 compileTo(target)

// 后置一致性校验
const drift = await checkMetadataDrift();
if (drift.length > 0) {
  console.error('元数据存在漂移！');
  process.exit(1); // 此时 target 已经被覆盖为损坏/漂移后的脏产物！
}
```

### 1.2 破坏表征与隐性灾难
- 一旦开发者修改了资产文件但忘记同步源码内联清单，运行构建时脚本虽然打印错误并以 exit 1 退出，但此时**目标分发产物已经被强行覆写为包含了漂移缺陷的脏文件**；
- 若后续的本地调试任务、离线脚本或未严格拦截 exit code 的构建步骤继续运行，系统将带着损坏的磁盘产物运行，引发不可预测的诡异运行时撕裂；
- 同时，部分脚本在后置校验中调用了二次全量比对，带来了冗余计算开销。

### 1.3 规避铁律：三段式原子构建时序
构建流水线必须严格遵循「纯内存前置校验 -> 零漂移安全写入 -> 最终产物落地核验」的原子时序：

```javascript
// [正确] 标准原子时序：先验后写，杜绝污染

// 1. 第一步：纯内存前置校验（源文件 vs 资产目录）
const drift = await checkSourceConsistency();
if (drift.length > 0) {
  for (const issue of drift) console.error('[build] ' + issue);
  console.error('[build] FAIL: 源码内联元数据与磁盘资产存在漂移，拒绝构建');
  process.exit(1); // 绝对不触碰磁盘，保持目标产物目录干净原样！
}

// 2. 第二步：确认零漂移后，安全写入目标磁盘
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

// 3. 第三步：最终产物落地一致性断言（核验产物是否完整落地且与源码 100% 同步）
const { issues } = await assertArtifactConsistency();
if (issues.length > 0) {
  for (const issue of issues) console.error('[build] ' + issue);
  console.error('[build] FAIL: 最终产物落盘校验失败');
  process.exit(1);
}

console.log('[build] OK: 构建成功');
```

---

## 二、编译器死代码零容忍与模块导入重导出分离 (Compiler Hygiene)

### 2.1 痛点成因：顶层导入与导出的职责混杂
在插件的主入口（如 `index.ts`）或公共门面模块中，常常既需要在本地消费某些内部函数，又需要向外部使用者具名重导出（Re-export）这些接口。

常见的偷懒写法：
```typescript
// [错误] 顶层无差别全部 import
import {
  usedByThisFile,
  onlyForExternalUsersA,
  onlyForExternalUsersB,
  type ExternalTypeDefinition
} from './internal-utils.js';

// 随后在下方统一对外导出
export {
  usedByThisFile,
  onlyForExternalUsersA,
  onlyForExternalUsersB,
  type ExternalTypeDefinition
} from './internal-utils.js';
```

### 2.2 妥协恶果：编译器检查被迫让步
- 在上述代码中，`onlyForExternalUsersA` 在当前文件内部从未被任何语句读取；
- 若团队开启了 TypeScript 严谨选项 `"noUnusedLocals": true`，编译器会严厉报错：
  `error TS6133: 'onlyForExternalUsersA' is declared but its value is never read.`
- 许多开发者为了快速消除该报错，往往选择在 `tsconfig.json` 中把 `noUnusedLocals` 与 `noUnusedParameters` 妥协关闭（设为 `false`）；
- **代价**：编译器的死代码防护网被彻底拆除，后续业务演进中真正被废弃的孤立变量、未使用的参数再也无法被编译器静态拦截，代码库逐步腐化。

### 2.3 规避铁律：消费导入与委托导出物理解耦
物理分离“本地消费使用的符号”与“对外公开重导出的符号”：
```typescript
// [正确] 1. 顶层只 import 本文件运行时直接消费的符号
import {
  usedByThisFile
} from './internal-utils.js';

// [正确] 2. 外部公开符号纯粹使用 export ... from 委托重导出，不在本地引入局部绑定
export {
  usedByThisFile,
  onlyForExternalUsersA,
  onlyForExternalUsersB,
  type ExternalTypeDefinition
} from './internal-utils.js';
```
- **收益**：`tsconfig.json` 可以 100% 放心且永久开启 `"noUnusedLocals": true` 与 `"noUnusedParameters": true`，杜绝任何死代码潜入。

---

## 三、发版 Tag 指针漂移陷阱与标准纠偏修正序列 (Tag Pointer Drift)

### 3.1 痛点成因：发版时序混乱与指针脱节
在 Git 与 CI/CD 自动化发版流程中，存在一个极其常见的高危陷阱：
1. 开发者在本地先执行了 `git tag -a v1.2.3 -m "release"`；
2. 随后突然想起文档（如 `CHANGELOG.md` 或 `package.json#version`）未修改，或代码有微调；
3. 修改后执行了 `git add . && git commit -m "chore: release"`；
4. 随后直接执行 `git push && git push --tags`。

### 3.2 灾难表征：CI 发布未经修复的历史旧产物
- 此时本地标签 `v1.2.3` 依然固执地指向了**前一个 Commit**；
- 远程仓库接收到 `v1.2.3` 推送后，触发 GitHub Actions 或 GitLab CI 的 Release 流水线；
- CI 针对 Tag 进行 Checkout 时，拉取到的其实是**没有包含最后一次 Commit 的旧代码**！
- 导致构建发布的 npm 包内部版本号不符、Changelog 丢失、甚至刚刚修复的关键 Bug 根本没有包含在发布产物中。

### 3.3 规避铁律：双向指针核验与四步标准纠偏序列

#### 铁律一：打 Tag 前后必须执行指针核验
```bash
# 核验当前 HEAD 与 Tag 指向的 Commit 是否 100% 绝对一致
git rev-parse HEAD
git rev-parse "v1.2.3^{commit}"  # 注意使用 ^{commit} 解包 annotated tag 对象
```
断言两个 40 位 SHA-1 字符串必须逐字完全相同！

#### 铁律二：Tag 指针漂移的标准纠偏四步序列
一旦发现 Tag 意外落入旧提交，**绝不能心存侥幸**，必须严格按照以下顺序执行纠偏：
```bash
# 1. 立即删除本地错误的旧 Tag
git tag -d v1.2.3

# 2. 在当前最新的 HEAD 上重新打上带附注的 Tag
git tag -a v1.2.3 -m "v1.2.3: release summary"

# 3. 先推送最新的分支提交
git push origin main

# 4. 推送重新打好的 Tag（若远程尚未存在该 tag 直接 push；若远程已有旧 tag 需 force push 纠偏）
git push origin v1.2.3 --force
```

---

## 四、插件内部私有复杂度的 YAGNI 裁决与浅模块过度抽象警惕 (Avoiding Shallow Abstractions)

### 4.1 痛点成因：重构冲动与过度设计
在对插件进行代码审查或架构重构时，开发者面对一段十几行或几十行的私有实现（例如：一段 18 行的宿主多命名空间 settings 解析解构，或几十行内部原子 operations 数组组装），常常容易产生抽象冲动：
- “这段解析逻辑好长，抽成一个独立的 `HostSettingsLocaleExtractor` 单例类吧！”
- “这段操作组装逻辑应该提纯为一个独立的 `ConfigOpsBuilder` 策略生成器！”

### 4.2 架构危害：浅模块泛滥 (Shallow Module Spill) 与隐性退化
根据软件设计核心原则（深模块 Deep Module 与 Ponytail 阶梯）：
1. **接口复杂度反噬**：抽离出的独立类往往是典型的“浅模块”（Shallow Module）——接口面积很大，但内部实现只有区区几行。调用方为了使用它，必须准备并传递大量的宿主上下文与状态入参（函数签名膨胀到 4~5 个入参）；
2. **破坏测试表面唯一性**：原本可以通过外部领域控制器（Controller / Model）的公开接口一次性完整覆盖的端到端交互，因为拆成了多个零碎的辅助类，迫使单元测试去对一堆琐碎的内部工具函数做白盒测试，破坏了“接口即测试表面”（The interface is the test surface）的整洁性；
3. **隐性性能倒退（破坏短路求值）**：
   例如将原本内聚在 Provider 中的短路逻辑 `language: configuredLanguage ?? this.hostLanguage()` 抽象为外置纯函数 `resolve(configured, describedSettings)`，会导致调用方在传参时**即便用户已经显式配置了语言，也必须无条件提前执行一次昂贵的全局设置反射扫描**，造成显式配置态下的高频性能浪费。

### 4.3 裁决标准：YAGNI 与深度模块三问
在决定是否将一段插件内部代码抽离为独立公共类/函数之前，必须通过以下三问：
1. **是否存在第二消费方？**（全仓仅有一处私有消费点 -> 坚决不抽离，就地内聚私有方法）；
2. **抽离后能否隐藏更多信息？**（若抽离后调用方仍然需要持有并管理底层的缓存状态、disposer 与引用，说明并未有效隐藏复杂度 -> 坚决不抽离）；
3. **是否破坏了短路求值或增加了传参负担？**（若带来额外的对象构造、入参膨胀或性能开销 -> 坚决不抽离）。

> **黄金法则**：优秀的模块应当“接口小，实现深”。当一段逻辑高度私有且行数适中时，就地封装在所属模块的私有方法中，是远胜于浅层碎片的最佳工程选择。

## 相关 DSH 源码

```
packages/core/src/plugin.ts             <- @deepseek-ai/dsh-core@0.4.3
packages/core/src/registry.ts           <- @deepseek-ai/dsh-core@0.4.3
packages/core/src/settings.ts           <- @deepseek-ai/dsh-core@0.4.3
```
