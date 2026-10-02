// Browser 侧插件入口 (Dual-Face Client UI)
import React, { useState } from 'react'

export const name = 'dsh-sidebar-tab-plugin/client'

/**
 * 右侧边栏主体面板组件
 * 核心铁律：React 组件绝不能接收 ctx 实例
 */
function CustomSidebarPanel({ sessionId }) {
  const [notes, setNotes] = useState(['欢迎使用侧边面板！', '支持会话独立上下文'])
  const [input, setInput] = useState('')

  const handleAdd = () => {
    if (!input.trim()) return
    setNotes(prev => [...prev, input.trim()])
    setInput('')
  }

  return React.createElement(
    'div',
    { style: { padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--dsw-alias-label-primary, inherit)' } },
    React.createElement('div', { style: { fontWeight: 600, fontSize: '15px', marginBottom: '8px' } }, '专属会话备忘录'),
    React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)', marginBottom: '16px' } }, `当前会话 ID: ${sessionId || '全局'}`),
    React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px' } },
      React.createElement('input', {
        value: input,
        onChange: (e) => setInput(e.target.value),
        placeholder: '输入临时备忘...',
        style: { flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-subtle, #ccc)' }
      }),
      React.createElement('button', {
        onClick: handleAdd,
        style: { padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', background: 'var(--dsw-alias-accent-primary, #0066cc)', color: '#fff', border: 'none' }
      }, '添加')
    ),
    React.createElement('ul', { style: { flex: 1, overflowY: 'auto', margin: 0, paddingLeft: '20px' } },
      notes.map((n, i) => React.createElement('li', { key: i, style: { marginBottom: '8px', fontSize: '13px' } }, n))
    )
  )
}

/**
 * 会话顶部工具栏按钮组件
 */
function HeaderUtilityButton() {
  const handleClick = () => {
    alert('触发了顶部快捷动作！可在插件中执行自定义业务逻辑。')
  }

  return React.createElement('button', {
    onClick: handleClick,
    title: '侧边栏插件快捷操作',
    style: {
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '4px 8px',
      borderRadius: '4px',
      display: 'inline-flex',
      alignItems: 'center'
    }
  }, '📌')
}

/**
 * 客户端装载入口
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // 1. 注册主界面右侧边栏面板 (sidebar.right.pane.tab)
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: 'sidebar-tab-plugin', // 选项卡唯一标识
        // 通过 inject 函数安全传递当前会话参数
        inject: (sessionId) => ({ sessionId })
      },
      CustomSidebarPanel
    )
  )

  // 2. 注册会话顶部右上角快捷工具按钮 (conversation.session.header.utilities)
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'sidebar-tab-plugin:quick-action',
        order: 40 // 排序权重
      },
      HeaderUtilityButton
    )
  )
}
