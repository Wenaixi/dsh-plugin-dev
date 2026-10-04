# 安全策略 (Security Policy)

## 支持的版本

本项目严格跟踪并对标 DeepSeek Harness (DSH) 官方稳定版本：

| 版本系列 | 支持状态 | 说明 |
| :--- | :--- | :--- |
| 当前核验版本 | :white_check_mark: 以对应核验记录为准 | 使用前重新检查源码、发布物和运行时行为 |
| 未经核验的旧版本 | :warning: 不作兼容承诺 | 版本差异可能影响 API、配置和装载行为 |

## 安全设计原则

本技能库编写的所有插件范例与架构指南均默认贯彻最高安全工程标准：
1. **单调守卫不可逆 (Monotonic Guard)**：高危操作阻断一票否决，不可撤销；
2. **零 Shell 解释注入防御 (Zero-Shell Interpretation)**：`ctx.subprocess.spawn` 原生参数直接传递，不经由 shell 展开；
3. **沙箱文件隔离 (Sandbox Isolation)**：严格遵循 `read-only` / `workspace-write` 最小权限准则；
4. **敏感信息动态注入**：在补丁中使用 `!!js process.env.VAR`，严禁敏感密钥硬编码落盘。

## 报告安全漏洞

如果你在本技能文档中发现了可能影响用户系统安全的错误指引（例如把凭据写入明文文件、建议执行破坏性命令）：
1. **请勿直接公开创建 Public Issue**；
2. 请通过 GitHub 仓库的 **Security Advisories** 功能提交私密漏洞报告，或通过维护者个人主页联系；
3. 我们会在 48 小时内确认漏洞细节并展开修复，在补丁发布前对漏洞信息严格保密。
