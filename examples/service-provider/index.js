// 进阶服务示例：自定义 Service 基类与跨插件服务消费。
// 参考：dsh-plugin-dev 技能 references/services.md 与 references/plugin-anatomy.md。
import { Service } from '@deepseek-ai/cordis'

export const name = 'service-provider'

/**
 * 自定义内存缓存服务。
 * 继承 Service 基类后，会自动将实例以 'memoryCache' 挂载到 ctx.memoryCache 上。
 */
export class MemoryCacheService extends Service {
  constructor(ctx) {
    // 第二个参数 'memoryCache' 声明挂载到 ctx 上的属性名
    super(ctx, 'memoryCache')
    this.store = new Map()

    // 注册生命周期清理：插件卸载时清空缓存
    this.ctx.effect(() => {
      return () => {
        this.store.clear()
        console.log('[service-provider] memoryCache cleared on unload.')
      }
    })
  }

  set(key, value, ttlMs = 0) {
    let expireTimer = null
    if (ttlMs > 0) {
      expireTimer = setTimeout(() => {
        this.store.delete(key)
      }, ttlMs)
    }
    this.store.set(key, { value, expireTimer })
  }

  get(key) {
    const entry = this.store.get(key)
    return entry ? entry.value : undefined
  }

  has(key) {
    return this.store.has(key)
  }

  delete(key) {
    const entry = this.store.get(key)
    if (entry?.expireTimer) {
      clearTimeout(entry.expireTimer)
    }
    return this.store.delete(key)
  }
}

/**
 * 示例服务消费方插件。
 * 显式声明 inject: ['memoryCache']，框架保证其 apply 运行时缓存服务必然已就绪。
 */
export const consumerPlugin = {
  name: 'cache-consumer',
  inject: ['memoryCache'],
  apply(ctx) {
    console.log('[cache-consumer] memoryCache service ready, performing cache ops...')
    ctx.memoryCache.set('system:status', 'operational', 60000)
    console.log('[cache-consumer] read from cache:', ctx.memoryCache.get('system:status'))
  }
}

export function apply(ctx) {
  // 挂载服务提供方
  ctx.plugin(MemoryCacheService)
  // 挂载消费者插件
  ctx.plugin(consumerPlugin)
}
