# DSH 斜杠命令 (Slash Commands)、输入触发器与交互扩展权威指南 (DSH 0.2.0-rc.2)
---

## 一、人类斜杠命令核心架构 (`ctx.commands`)

在 DSH Web GUI 和交互式终端中，用户在输入框中键入以斜杠开头的指令（如 `/plan`、`/compact`、`/clear`），会被前端输入触发器捕获并交由核心命令注册表 `ctx.commands`（所属包 `@deepseek-ai/dsh-commands`）统一调度。

### 1. 命令与工具 (Tool) 的本质区别
- **面向模型工具 (`ctx.tools`)**：由 LLM 决定何时调用，参数由模型生成，执行结果返回给模型作为上下文；
- **人类斜杠命令 (`ctx.commands`)**：由**人类用户主动发起**，不经过模型 Function Calling 决策，直接拦截并控制会话生命周期、环境配置或派发特定任务。

```
  用户在输入框键入 "/deploy production"
               │
               ▼
  前端输入触发器 (dsh-client-ui-input-trigger) 呼出下拉候选菜单
               │ 回车确认执行
               ▼
  Typert Remote 网关调用 Host 侧 ctx.commands.execute()
               │
               ▼
  插件注册的命令执行器 (CommandExecution)
               │ 验证权限、读取会话上下文
               ▼
  返回 CommandResult (向会话注入指令或直接执行运维操作)
```

---

## 二、注册自定义斜杠命令实战

插件可以通过声明依赖 `inject: ['commands']`，在 `apply(ctx)` 中注册自定义人类命令：

```js
export const inject = ['commands'];

export function apply(ctx) {
  // 注册斜杠命令
  ctx.commands.register({
    id: 'git-sync', // 命令标识符，用户输入 /git-sync 触发
    description: '拉取最新代码并执行工作区状态自检',
    // 定义参数输入形态（可选）
    input: {
      placeholder: '可选：指定远程分支名 (默认 main)',
      required: false
    },
    // 命令执行逻辑
    async execute(execution) {
      const branch = execution.text?.trim() || 'main';
      const sessionId = execution.sessionId;

      ctx.logger('git-sync').info(`用户在会话 ${sessionId} 中触发了分支同步: ${branch}`);

      // 返回执行结果
      return {
        ok: true,
        message: `已成功为会话 ${sessionId} 触发 ${branch} 分支同步检测`
      };
    }
  });
}
```

---

## 三、前端输入触发器机制 (`dsh-client-ui-input-trigger`)

用户在输入框中打字时，系统如何实现类似 IDE 的 `/` 命令补全和 `@` 文件提及？

官方核心包 `@deepseek-ai/dsh-client-ui-input-trigger` 采用了精巧的**纯前端双面插件范式 (Pure-UI Dual-Face Pattern)**：

### 1. 架构设计规范
- **Node 宿主端 (`index.js`)**：导出完全空的 `apply()` 函数。这是为了让 Cordis Loader 在静态解析 `cordis.patch.yml` 时能成功装载该条目；
- **浏览器客户端 (`lib/client.js`)**：在 `package.json` 的 `dsh.client` 中声明，打包为懒加载 CJS bundle；
- 客户端在输入框挂载监听器，当检测到首字符为 `/` 时，通过 Typert Remote 异步拉取当前所有已注册的命令描述符（`CommandDescriptor`），在输入框正上方弹出高对比度的 Command Picker 列表面板供用户选择。

---

## 四、快捷键系统与命令联动 (`dsh-client-shortcuts`)

双面插件还可以在浏览器端直接监听快捷键：
- 官方核心包 `@deepseek-ai/dsh-client-shortcuts` 提供了跨平台的按键时序检测（Sequence Timing）；
- 支持在不同操作系统下自动适配 `Cmd` (macOS) 与 `Ctrl` (Windows/Linux)；
- 插件通过标准 DOM 快捷键绑定，可以一键唤出自己的斜杠命令输入框或专属设置面板。
