// 事件拦截与安全门禁中间件示例。
// 参考：dsh-plugin-dev 技能 references/events.md 与 references/plugin-forms.md。
export const name = 'event-interceptor'
export const inject = ['tools']

/**
 * 黑名单模式匹配函数（演示安全规则）。
 */
function isRestrictedOperation(toolName, args) {
  // 示例规则：拦截包含敏感模式的调用
  if (toolName === 'execute_command' && args?.command) {
    const dangerousPatterns = ['rm -rf /', ':(){ :|:& };:', 'mkfs']
    return dangerousPatterns.some(pat => args.command.includes(pat))
  }
  return false
}

export function apply(ctx) {
  console.log('[event-interceptor] Plugin loaded, mounting tool execution interceptors.')

  /**
   * 1. tools/pre-execute (waterfall 模式)
   * 官方硬规则：waterfall 监听器必须调用 next()，不调用即有意短路下游。
   */
  ctx.on('tools/pre-execute', async (exec, next) => {
    const startTime = Date.now()

    // 检查安全规则
    if (isRestrictedOperation(exec.name, exec.arguments)) {
      console.warn(`[event-interceptor] SECURITY ALERT: Denied tool '${exec.name}' execution.`)
      // 返回 deny 判定，直接短路拦截，不执行后续工具
      return {
        kind: 'deny',
        reason: 'Operation denied by security policy (prohibited command pattern).'
      }
    }

    // 放行并传递给下游监听器或核心执行器
    const decision = await next()
    const elapsed = Date.now() - startTime
    console.log(`[event-interceptor] Pre-execute pass for '${exec.name}', pre-check took ${elapsed}ms.`)
    return decision
  })

  /**
   * 2. tools/result (广播事件)
   * 记录工具执行完毕后的不可变结果，用于合规审计与统计。
   */
  ctx.on('tools/result', (event) => {
    console.log(`[event-interceptor] AUDIT: Tool '${event.name}' completed with status: ${event.isError ? 'ERROR' : 'SUCCESS'}.`)
  })
}
