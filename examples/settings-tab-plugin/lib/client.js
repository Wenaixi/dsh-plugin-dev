// Browser 侧插件入口 (Dual-Face Client UI)
import React, { useState, useEffect } from 'react'

export const name = 'dsh-settings-tab-plugin/client'

/**
 * 右侧渲染的 React 设置面板组件
 * 核心铁律：React 组件绝不能接收 ctx 实例，仅通过 Props 或内部 Hook 管理状态
 */
function ExampleSettingsPanel() {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem('dsh_example_plugin_enabled') === 'true'
  })
  const [opacity, setOpacity] = useState(() => {
    return Number(localStorage.getItem('dsh_example_plugin_opacity') || '80')
  })

  const handleToggle = (checked) => {
    setEnabled(checked)
    localStorage.setItem('dsh_example_plugin_enabled', String(checked))
    window.dispatchEvent(new CustomEvent('dsh:settings-tab-plugin:change', { detail: { enabled: checked, opacity } }))
  }

  const handleOpacityChange = (val) => {
    setOpacity(val)
    localStorage.setItem('dsh_example_plugin_opacity', String(val))
    window.dispatchEvent(new CustomEvent('dsh:settings-tab-plugin:change', { detail: { enabled, opacity: val } }))
  }

  return React.createElement(
    'div',
    { style: { padding: '24px', maxWidth: '680px', color: 'var(--dsw-alias-label-primary, inherit)' } },
    React.createElement('h2', { style: { fontSize: '18px', fontWeight: 600, marginBottom: '8px' } }, '专属插件设置'),
    React.createElement('p', { style: { color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '13px', marginBottom: '24px' } },
      '演示如何向 DSH 全局设置窗口注入自定义 UI 选项卡与偏好控制面板。'
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle, #eee)' } },
      React.createElement(
        'div',
        null,
        React.createElement('div', { style: { fontWeight: 500, fontSize: '14px' } }, '功能启用开关'),
        React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)', marginTop: '2px' } }, '即时将配置落盘到浏览器本地存储，0 延迟生效')
      ),
      React.createElement('input', {
        type: 'checkbox',
        checked: enabled,
        onChange: (e) => handleToggle(e.target.checked),
        style: { width: '18px', height: '18px', cursor: 'pointer' }
      })
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0' } },
      React.createElement(
        'div',
        null,
        React.createElement('div', { style: { fontWeight: 500, fontSize: '14px' } }, `效果透明度 (${opacity}%)`),
        React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)', marginTop: '2px' } }, '拖动滑块即时调节视觉透明度参数')
      ),
      React.createElement('input', {
        type: 'range',
        min: '10',
        max: '100',
        value: opacity,
        onChange: (e) => handleOpacityChange(Number(e.target.value)),
        style: { width: '140px', cursor: 'pointer' }
      })
    )
  )
}

/**
 * 客户端装载入口
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // 向设置窗口左侧导航注入专属 Tab 选项卡
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'settings-tab-plugin', // 选项卡唯一标识
        order: 85,                  // 排列顺序权重
        label: () => '示例插件设置' // 侧边栏按钮文字
      },
      ExampleSettingsPanel
    )
  )
}
