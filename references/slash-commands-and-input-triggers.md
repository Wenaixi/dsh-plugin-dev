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
  返回 CommandResult（{kind:'success'|'error', text?, sourceEventSeq?}；执行经 execute() 记入会话日志 command/run、command/done 生命周期事件，不创建模型消息）
```

---

## 二、注册自定义斜杠命令实战

插件可以通过声明依赖 `inject: ['commands']`，在 `apply(ctx)` 中注册自定义人类命令：

```js
export const inject = ['commands'];

export function apply(ctx) {
  // 注册斜杠命令
  ctx.commands.register({
    name: 'git-sync', // /^[a-z][a-z0-9_-]*$/（无 id/placeholder/required 字段）
    description: '拉取最新代码并执行工作区状态自检',
    input: { hint: '[<branch>]' }, // hint 必须非空字符串；可选 attachments: true
    handler: ({ agent, rawInput }) => {
      const branch = rawInput.trim() || 'main';
      ctx.logger('git-sync').info(`用户会话 ${agent.session.id} 触发分支同步: ${branch}`);
      // 必须返回 { kind: 'success' | 'error', text? }
      return { kind: 'success', text: `已为会话 ${agent.session.id} 触发 ${branch} 分支同步检测` };
    }
  });
}
```

---

## 三、前端输入触发器机制 (`dsh-client-ui-input-trigger`)

用户在输入框中打字时，系统如何实现类似 IDE 的 `/` 命令补全和 `@` 文件提及？

官方核心包 `@deepseek-ai/dsh-client-ui-input-trigger` 采用了精巧的**纯前端双面插件范式 (Pure-UI Dual-Face Pattern)**：

### 1. 架构设计规范
- **Node 宿主端 (`index.js`)**：导出空的 `apply()` 函数，使插件条目出现在宿主 cordis.yml / Loader 中（源码注释原文，无 cordis.patch.yml 静态解析依据）；
- **浏览器客户端 (`lib/client.js`)**：在 `package.json` 的 `dsh.client` 中声明，打包为懒加载 CJS bundle；
- dsh-client-ui-commands 把 `/` 命令 source 注册进 input-trigger 流水线（trigger: "/"）；候选来自按 session 预热的命令目录（经 `ctx.remote.commands.list` 异步拉取，带 generation/AbortSignal 竞态把关），按命中 fetchCandidates 后在输入框上方弹出 Command Picker 列表面板。客户端没有名为 `CommandDescriptor` 的类型，只有 descriptor（name/description/input{hint,attachments?}，可带 definitionId）。

---

## 四、快捷键系统与命令联动 (`dsh-client-shortcuts`)

双面插件还可以在浏览器端直接监听快捷键：
- 官方核心包 `@deepseek-ai/dsh-client-shortcuts` 提供快捷键服务（ShortcutsService，`ctx.shortcuts`）；`stopSequenceMs`（默认 500ms）是 ui-conversation 停止快捷键的连续两次 Esc 最大间隔（StopSequence.press 按 performance.now 计算 deadline），属固定输入序列而非通用按键时序 API；
- 支持在不同操作系统下自动适配 `Cmd` (macOS) 与 `Ctrl` (Windows/Linux)；
- 功能插件通过 `ctx.shortcuts.register({id,label,aliases,defaults,regions,modals,resolve})`（defaults 按 desktop/web×macos/windows/linux 六 profile 声明物理 code+modifiers，'primary' 按设备展开为 meta/control）注册命令，固定序列用 `registerFixed({id,keys,bindings,group})`，观察输入用 `observeFixedInput`。输入框唤出由 ui-conversation 的 fixed.slash（物理 Slash 键）承担，Mod+/（Slash+primary）由 dsh-client-ui-shortcuts 打开快捷键参考面板。
