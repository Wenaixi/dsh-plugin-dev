// 事件拦截与安全门禁中间件示例 (DSH 0.2.0-rc.2 规范)
// 参考：dsh-plugin-dev 技能 references/tools.md 与 references/events.md
export const name = 'event-interceptor'
export const inject = ['tools']

/**
 * 危险模式判定函数（演示安全规则）。
 */
function isRestrictedOperation(toolName, args) {
  if (toolName === 'execute_command' && args?.command) {
    const dangerousPatterns = ['rm -rf /', ':(){ :|:& };:', 'mkfs', 'del /f /s /q C:\\']
    return dangerousPatterns.some(pat => args.command.includes(pat))
  }
  return false
}

export function apply(ctx) {
  console.log('[event-interceptor] Plugin loaded, mounting security guards and audit listeners.')

  /**
   * 1. 单调安全守卫 (ctx.tools.guard)
   * 官方规范：在 tools/pre-execute 之后触发。
   * 单调安全法则：只要返回非空错误描述字符串，调用即被判定为拒绝 (Deny)。
   * 任何守卫均不可强制放行已被其他守卫拒绝的调用。
   */
  const unregisterGuard = ctx.tools.guard((call) => {
    if (isRestrictedOperation(call.toolName, call.args)) {
      console.warn(`[event-interceptor] SECURITY ALERT: Denied tool '${call.toolName}' execution.`)
      return 'Operation denied by security policy: prohibited command pattern detected.'
    }
  })

  /**
   * 2. 执行后审计监听 (tools/post-execute 事件)
   * 用于不可变合规审计、耗时统计与执行状态记录。
   */
  const unregisterAudit = ctx.on('tools/post-execute', (event) => {
    console.log(`[event-interceptor] AUDIT: Tool '${event.toolName}' finished with status: ${event.error ? 'ERROR' : 'SUCCESS'}.`)
  })

  // 注册的 guard 和事件监听器在插件卸载时自动受 ctx 生命周期管理注销
}
