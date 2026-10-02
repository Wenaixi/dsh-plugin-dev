# DSH 插件本地开发调试回路与高频故障排查宝典 (DSH 0.2.0-rc.2)

> **⚠️ 核心定位声明**
> **本文件是辅助开发 DeepSeek Harness (DSH) 插件的权威调试指南与故障排毒手册。**
> **本项目本身是一个 Skill，绝不是 DSH 插件本身！**

---

## 一、本地极速调试三大工作流回路 (Fast Inner Loops)

编写插件时，**绝不要每次修改都发布到 npm 或打 tarball**，DSH 提供了三种极短的本地联调回路：

### 回路 1：命令行实时补丁覆盖法（推荐！0 侵入）
无需修改当前 profile 的配置，直接在启动命令后通过 `--patch` 挂载你正在编写的插件补丁：
```bash
# 启动 Web 宿主并临时叠加本地插件补丁
dsh --profile web --patch C:/path/to/my-plugin/cordis.patch.yml
```
- 退出进程后系统恢复原样，零污染；
- 每次修改代码后只需重启宿主即可立即看到变更。

### 回路 2：本地相对路径添加法（持久联调）
在测试用的 profile 中直接将本地目录添加为 bundle：
```bash
dsh plugin --profile web add C:/path/to/my-plugin
```
- 该命令会自动将本地路径加入 profile 的 `package.json` 中（以 `file:` 协议软链）；
- 插件源码修改后，Node 侧重启即生效，浏览器端配合 HMR 自动刷新。

### 回路 3：单机沙盒临时环境验证（安全隔离）
为了防止搞坏正在使用的日常 profile，可以通过重定向 `DSH_HOME` 启动完全隔离的测试环境：
```powershell
# PowerShell 环境下重定向至临时目录
$env:DSH_HOME = "C:\Temp\dsh-dev-sandbox"
dsh plugin --profile test-env add ./my-plugin
dsh --profile test-env
```

---

## 二、双面 UI 插件前端排查技巧

若你编写了带界面的插件（Dual-Face），而在浏览器控制台或设置窗口中没有看到对应的界面，请按以下顺序在浏览器 DevTools 中排查：

### 1. 检查引导清单 (`window.__DSH_BOOT__`)
在浏览器控制台输入：
```js
console.log(window.__DSH_BOOT__.clientModules)
```
- **排查点**：查看返回的已启用模块清单中，是否包含你的插件包名（如 `dsh-my-plugin`）；
- **若没有**：说明 Host 宿主端的 Loader 并没有激活该插件的 `dsh.client`，请检查 `package.json` 是否遗漏了 `dsh.client: { platform: "web" }` 声明。

### 2. 检查模块加载器状态 (`window.__ModuleLoader__`)
在控制台输入：
```js
console.log(window.__ModuleLoader__.entries)
```
- **排查点**：查看你的插件客户端 bundle 是否已注册；
- **排查 Combo 请求**：切换到 Network（网络）标签页，查看形如 `/plugins/??<id>/client.js&rev=...` 的批量加载请求是否返回了 200。若返回 404，检查 `package.json` 的 `exports["./client"]` 路径是否指向了真实存在的物理打包文件。

---

## 三、Top 8 高频故障排查速查表 (Troubleshooting Matrix)

| 故障现象 | 致命根因 | 官方权威解药 |
| :--- | :--- | :--- |
| **1. 插件卡在 PENDING，apply() 根本不执行** | `inject` 数组中声明的服务在当前 profile 中不存在或未被提供 | 检查 `export const inject = [...]`。若依赖是可选的，**严禁写进 inject**，改用在函数体内部用 `ctx.get('serviceName')` 动态探测。 |
| **2. 修改了配置项，但其他配置全部丢失了** | 违反了补丁系统的**全量替换 (Wholesale Replacement)** 规则 | 补丁覆盖是整体替换而非深合并！在 `cordis.patch.yml` 中重写某个配置时，必须把该插件在该层所需的完整字段一次性提供全。 |
| **3. 设置窗口左侧没有显示专属 Tab** | 1. 缺少双面导出；<br>2. 组件接收了 ctx 抛异常；<br>3. 忘记调 `slots.inject` | 1. 确保 `package.json` 有 `exports["./client"]`；<br>2. 确保在 `lib/client.js` 中调用 `ctx.slots.inject("settings.section", ...)`；<br>3. 检查控制台是否有报错。 |
| **4. 页面报错 "Cannot read property of undefined (ctx)"** | 违背了 **“React 组件绝不能接收 ctx”** 核心铁律 | 宿主插槽容器渲染组件时不会注入 ctx。组件需要的数据与回调必须通过纯 Props 或前端自定义 Hook 传递。 |
| **5. 运行 npm install 报 ERESOLVE 冲突** | npm 7+ 对 peerDependencies 的默认严格判定与 DSH 单例依赖产生冲突 | 运行安装时务必追加参数：`npm install --legacy-peer-deps --no-audit --no-fund`。 |
| **6. 启动报错 "1 required plugin did not activate"** | 盲目相信了 `--dump-config`，实际存在缺包或版本 peer 拦截 | `--dump-config` 不加载插件代码！检查 `~/.dsh/profiles/<profile>/cfg.err`，使用 `allow-version` 豁免兼容性或安装缺失插件。 |
| **7. 执行系统命令报注入或权限错误** | 试图拼接 shell 字符串并传给 `ctx.subprocess.spawn` | DSH 的子进程生成参数 **严格零 Shell 解释**！必须传入扁平的 `argv` 数组（如 `['git', 'status', '-s']`），绝不要传 `'sh -c "..."'`。 |
| **8. Typert Remote 方法调用报 AST 语法错误** | 远程暴露的方法签名中使用了对象解构或默认参数值 | 远程方法签名必须严格遵守规则：单一名命参数对象，禁止解构，禁止默认值，协作中断 `signal` 必须为末位参数。 |

---

## 四、日志记录与健康诊断

在插件编写过程中，输出规范的日志有助于精准定位问题：

### 1. 插件内部日志记录规范
使用 `ctx.logger` 为插件创建专属命名空间的日志记录器：
```js
export function apply(ctx) {
  const logger = ctx.logger('my-plugin');

  logger.info('插件已成功启动');
  logger.warn('检测到可选服务未加载，将降级运行');
  logger.debug('详细调试数据:', { foo: 'bar' });
  logger.error('遇到严重异常:', new Error('something went wrong'));
}
```

### 2. 宿主核心日志落盘位置
若 DSH Web 宿主启动崩溃或静默退出，请直接查阅以下两个黑匣子日志：
- `~/.dsh/profiles/<profile>/cfg.log`：运行时标准输出与插件加载拓扑
- `~/.dsh/profiles/<profile>/cfg.err`：启动失败的核心崩溃堆栈与未满足的 Service 清单
