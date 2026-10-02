# 安全策略 (Security Policy)

## 支持的版本

本项目严格跟踪并对标 DeepSeek Harness (DSH) 官方稳定版本：

| 版本系列 | 支持状态 | 说明 |
| :--- | :--- | :--- |
| **0.2.0-rc.2 (最新)** | :white_check_mark: 正在全力支持 | 官方 2026-09-30 升级基准，所有文档与示例以此为准 |
| < 0.1.7 | :x: 已停止维护 | 早期架构存在破坏性变更，不再提供兼容保证 |

## 安全设计原则

本技能库编写的所有插件范例与架构指南均默认贯彻最高安全工程标准：
1. **单调守卫不可逆 (Monotonic Guard)**：高危操作阻断一票否决，不可撤销；
2. **零 Shell 解释注入防御 (Zero-Shell Interpretation)**：`ctx.subprocess.spawn` 原生参数直接传递，不经由 shell 展开；
3. **沙箱文件隔离 (Sandbox Isolation)**：严格遵循 `read-only` / `workspace-write` 最小权限准则；
4. **敏感信息动态注入**：在补丁中使用 `!!js process.env.VAR`，严禁敏感密钥硬编码落盘。

## 报告安全漏洞

如果你在示例工程、脚手架脚本或安全指引中发现了潜在的安全漏洞：
1. **请勿直接公开创建 Public Issue**；
2. 请通过 GitHub 仓库的 **Security Advisories** 功能提交私密漏洞报告，或通过维护者个人主页联系；
3. 我们会在 48 小时内确认漏洞细节并展开修复，在补丁发布前对漏洞信息严格保密。
