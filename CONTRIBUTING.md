# 贡献指南 (Contributing Guide)

感谢你关注并愿意为 **dsh-plugin-dev** 做出贡献！本项目是 DeepSeek Harness (DSH 0.2.0-rc.2) 生态的核心规范与 Agent 权威技能库。为了保持知识库的高精度与工业级严谨性，请在提交贡献前阅读以下指南。

---

## 一、行为准则

参与本项目即代表你同意遵守我们的 [行为准则 (CODE_OF_CONDUCT.md)](./CODE_OF_CONDUCT.md)。我们致力于为所有人提供一个友好、安全和包容的交流环境。

---

## 二、如何参与贡献

你可以通过以下方式为项目做出贡献：
1. **报告 Bug 或过时信息**：发现 DSH 新版本 API 变更、旧文档中的错误描述或示例工程无法加载；
2. **补充架构与技术参考**：提交针对 DSH 核心服务、Seam 接口或特定场景的深度参考；
3. **完善实战示例工程**：在 `examples/` 目录下新增具有代表性的优质插件示例；
4. **改进工具脚本与评测集**：优化 `scripts/` 下的校验/脚手架脚本，或扩充 `evals/` 中的触发评测用例。

---

## 三、本地开发与验证工作流

本项目强调“零构建、可验证、无死链”的极简工程哲学。

### 1. 克隆与准备
```bash
git clone https://github.com/Wenaixi/dsh-plugin-dev.git
cd dsh-plugin-dev
```
本项目无需繁重的构建打包步骤，所有示例与脚本基于原生 Node.js (>=18) ESM 运行。

### 2. 自动化合规性校验
在提交任何修改前，必须运行随包提供的校验工具验证全部示例工程：
```bash
node scripts/validate_plugin.mjs examples/hello-plugin examples/service-provider examples/configurable-plugin examples/greet-tool examples/event-interceptor
```
确保所有工程输出 `校验通过`，退出码为 0。

### 3. 生成新插件脚手架
如需贡献新的示例插件，推荐使用内置脚手架生成标准骨架：
```bash
# 生成基础单面插件
node scripts/scaffold_plugin.mjs examples/my-new-plugin

# 生成双面 UI 插件（含 React 客户端与 Slots 插槽骨架）
node scripts/scaffold_plugin.mjs examples/my-ui-plugin --dual-face
```

---

## 四、文档编写黄金准则

修改或新增文档时，请务必遵守以下硬性规范：
1. **真源至上**：以 DSH 官方源码及导出的 TypeScript `.d.ts` 类型定义为唯一判定依据，拒绝无依据的猜测；
2. **核心大动脉单复数铁律**：严守服务命名约定（`ctx.sessions`、`ctx.agents`、`ctx.agentTeams`、`ctx.tools` 必须为复数！`ctx.schedule`、`ctx.planMode` 为单数！）；
3. **组件禁传 ctx 铁律**：在双面 UI 插件中，React 组件绝对不能接收 `ctx`，必须通过纯 Props 通信；
4. **文档绝对零死链**：Markdown 内部文件链接必须真实存在，并在提交前进行路径核对；
5. **精炼与渐进式展开**：主文档保持紧凑，重量级参考独立放入 `references/`，不写空洞废话。

---

## 五、Git 提交信息规范 (Conventional Commits)

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>
```

- `feat`: 新增插件示例、工具能力或核心章节
- `fix`: 修复示例代码缺陷、纠正过时陈旧文档、修正 API 签名
- `docs`: 文档优化、排版润色、完善说明
- `perf`: 优化技能发现 SDO、降低 Token 开销
- `chore`: 依赖更新、CI 配置、忽略规则调整

---

## 六、提交 Pull Request

1. Fork 本仓库并基于 `main` 分支创建特性分支（如 `feat/new-seam-doc`）；
2. 提交修改并确保本地 `validate_plugin.mjs` 100% 绿灯；
3. 推送分支并向本项目发起 Pull Request；
4. 详尽填写 PR 模板中的变更说明与自检项，等待维护者审查与 CI 自动化测试通过。
