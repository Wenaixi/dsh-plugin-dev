// Host 侧插件入口
export const name = 'dsh-settings-tab-plugin'

/**
 * 宿主端装载入口
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.logger('settings-tab').info('dsh-settings-tab-plugin 宿主侧已加载')
}
