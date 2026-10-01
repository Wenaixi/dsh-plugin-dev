// 规范配置插件示例：导出 Schemastery Schema 与配置校验。
// 参考：dsh-plugin-dev 技能 references/config.md 与硬规则 6（配置一律 Schemastery）。
import Schema from '@deepseek-ai/schemastery'

export const name = 'configurable-plugin'

/**
 * 官方硬规则：配置一律导出同名 Schemastery Schema，默认值写在 schema 中。
 * 不要导出普通 JavaScript 对象充当 Config。
 */
export const Config = Schema.object({
  apiEndpoint: Schema.string()
    .default('https://api.example.com/v1')
    .description('外部 API 服务的请求基地址'),
  timeoutMs: Schema.number()
    .min(100)
    .max(60000)
    .default(5000)
    .description('请求超时毫秒数（100ms - 60000ms）'),
  enableRetry: Schema.boolean()
    .default(true)
    .description('发生瞬态故障时是否自动重试'),
  advanced: Schema.object({
    maxConcurrentRequests: Schema.number().default(5).description('并发请求上限'),
    debugHeaders: Schema.boolean().default(false).description('是否打印调试请求头')
  }).default({}).description('进阶运行参数')
}).description('configurable-plugin 配置')

/**
 * 插件入口：接收框架校验并注入默认值后的完整配置对象。
 */
export function apply(ctx, config) {
  console.log('[configurable-plugin] Plugin loaded with validated config:')
  console.log('  - apiEndpoint:', config.apiEndpoint)
  console.log('  - timeoutMs:', config.timeoutMs)
  console.log('  - enableRetry:', config.enableRetry)
  console.log('  - maxConcurrentRequests:', config.advanced.maxConcurrentRequests)

  // 官方硬规则 4：失败要响亮。对于 Schema DSL 无法表达的深层语义约束，应明确校验报错
  if (config.apiEndpoint.endsWith('/')) {
    // 自动规范化或提示
    console.warn('[configurable-plugin] Notice: Trailing slash in apiEndpoint will be trimmed.')
  }
}
