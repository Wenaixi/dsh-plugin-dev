# Windows 沙箱环境子进程管道陷阱与 node:vm 纯内存语法校验

> 适用场景：DSH 插件的自动化门禁、构建质检脚本、本地测试工具，以及所有涉及子进程调用的场景。
> 核心命题：**如何在 DSH 沙箱严格受限环境下安全执行语法校验与外部调用，彻底根除命名管道 EPERM 崩溃？**

---

## 一、底层陷阱：命名管道限制与次生空指针崩溃

### 1. DSH Windows 沙箱的管道边界
在 Windows 平台的 DSH 环境中，受限沙箱模式（`workspace-write` 与 `read-only` 策略）对受控进程施加了明确的安全隔离：
- **禁止创建非受信任的命名管道（Named Pipe `\\.\pipe\...`）**；
- Node.js 的 `child_process.spawn`、`spawnSync`、`exec`、`execSync` 默认配置均为 `{ stdio: 'pipe' }`，其底层机制是在父子进程间建立标准输入输出的两根命名管道。

### 2. EPERM 拦截与致命空指针调用链
当一个门禁脚本或测试工具在沙箱下执行 `spawnSync(process.execPath, ['--check', filepath])` 时：
1. **系统底层拦截**：操作被沙箱安全策略拦截，子进程根本未能正常派生（`CreateProcessW` 失败），抛出底层 `EPERM: operation not permitted`；
2. **返回结构畸变**：`spawnSync` 返回一个未正常退出的异常对象：
   ```javascript
   {
     error: [Error: spawnSync ... EPERM],
     status: null,    // 注意：不是 0，也不是非 0 整数！
     signal: null,
     stdout: undefined,
     stderr: undefined
   }
   ```
3. **致命次生崩溃**：通常的代码习惯是判断 `if (check.status !== 0)`，因为 `null !== 0` 成立，逻辑盲目进入错误分支；而在错误分支中直接编写了：
   ```javascript
   const errMsg = check.stderr.trim(); // TypeError: Cannot read properties of undefined (reading 'trim')
   ```
   导致整个门禁或测试进程瞬间暴毙，无法收集诊断信息，错误提示被空指针掩盖。

---

## 二、最优解决方案：node:vm 纯内存语法校验

### 1. 为什么坚决不要用子进程做 JS 语法校验？
在很多传统 Node.js 工具中，开发者习惯用 `spawnSync('node', ['--check', file])` 验证生成的客户端或插件产物是否语法正确。
在 DSH 插件工程中，这是绝对的**反模式（Anti-Pattern）**：
- **沙箱必死**：在受限沙箱下必因上述管道限制抛出 EPERM；
- **极其沉重**：每次校验都需要操作系统派生独立进程、冷启动 Node.js 运行时与 V8 堆内存，单次耗时通常在 30ms ~ 100ms；
- **平台依赖脆弱**：依赖 `process.execPath` 与外部环境。

### 2. 原生标准库替代：`new vm.Script(source)`
Node.js 官方标准库内置了 `node:vm` 模块，其中的 `new vm.Script(code, options)` 是语言级语法校验的黄金解法。

```javascript
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

function checkJavaScriptSyntax(filePath) {
  const source = readFileSync(filePath, 'utf8')
  try {
    // 仅调用 V8 AST 编译与字节码生成，100% 绝对不执行任何代码
    new vm.Script(source, { filename: filePath })
    return { ok: true }
  } catch (err) {
    // 语法错误时同步抛出原生 SyntaxError
    return {
      ok: false,
      error: '语法校验失败: ' + (err?.message ?? String(err))
    }
  }
}
```

### 3. node:vm 的四大核心保证
1. **绝对零代码执行（0 副作用）**：
   `new vm.Script` 对应 V8 引擎底层的 `Compiler::CompileUnboundScript`，它只进行词法分析与抽象语法树解析。只有显式调用 `script.runInThisContext()` 等运行 API 时代码才会执行。即使传入包含死循环或退出指令的代码，也只被编译为字节码，绝不执行。
2. **毫秒级极限吞吐**：
   直接复用父进程的 V8 Isolate，实测在数百行的产物文件上解析耗时仅 **1ms 左右**，比跨进程派生快几十倍至上百倍。
3. **100% 免疫沙箱 EPERM**：
   完全在当前进程的内存堆中完成，不打开任何管道，不触碰任何操作系统进程句柄。
4. **语法错误精准定位**：
   抛出的 `SyntaxError` 实例完整携带出错的虚拟文件名、行号、列号与代码高亮光标指示符。

---

## 三、必须派生子进程时的通用安全姿态

若插件确实因特定需求必须拉起外部子进程，必须遵循以下平台安全姿态：

1. **避免默认 stdio pipe 捕获**：
   - 若仅需观察退出状态：配置 `{ stdio: 'ignore' }`；
   - 若直接输出到终端：配置 `{ stdio: 'inherit' }`；
   - 若需捕获输出：避免使用 Node.js 内部管道，改用操作系统自身重定向写入临时文件（如 `> temp.log`），再通过受沙箱许可的文件系统读回。
2. **可选链严格保护（判空铁律）**：
   所有调用子进程返回对象取值时，坚决禁止裸读 `.trim()`：
   ```javascript
   const errText = check.stderr?.trim() || check.error?.message || 'unknown error';
   ```
3. **识别 EPERM 边界，严禁重试**：
   沙箱拒绝（`[sandbox: file access denied]` 或 `EPERM`）是操作系统的策略断言，不是瞬时偶发错误。遇到此类拒绝应当立即重构调用方式，绝不进行原地重试。
