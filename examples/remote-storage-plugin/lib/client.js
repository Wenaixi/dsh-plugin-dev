// Browser 客户端入口：调用 ctx.remote 并渲染 React 面板
import React, { useState, useEffect } from 'react'

export const name = 'dsh-remote-storage-plugin/client'

/**
 * 前端全栈面板组件
 * 核心铁律：组件绝不接收 ctx，通过回调接收 Remote 通信函数
 */
function RemoteStoragePanel({ onAdd, onFetch }) {
  const [list, setList] = useState([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  const loadData = async () => {
    try {
      const res = await onFetch()
      if (res.ok) setList(res.list || [])
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreate = async () => {
    if (!title.trim()) return
    setLoading(true)
    try {
      const res = await onAdd({ title, content })
      if (res.ok) {
        setTitle('')
        setContent('')
        await loadData()
      }
    } catch (e) {
      alert('保存失败: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  return React.createElement(
    'div',
    { style: { padding: '24px', maxWidth: '680px', color: 'var(--dsw-alias-label-primary, inherit)' } },
    React.createElement('h2', { style: { fontSize: '18px', fontWeight: 600, marginBottom: '8px' } }, '跨端持久化笔记'),
    React.createElement('p', { style: { color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '13px', marginBottom: '20px' } },
      '演示通过 Typert Remote RPC 向 Node.js 宿主发起调用，并经由 ctx.storage.domain 写入服务端持久化存储。'
    ),
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--dsw-alias-surface-secondary, #f8f8f8)', padding: '16px', borderRadius: '8px', marginBottom: '24px' } },
      React.createElement('input', {
        value: title,
        onChange: (e) => setTitle(e.target.value),
        placeholder: '笔记标题...',
        style: { padding: '8px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-subtle, #ccc)' }
      }),
      React.createElement('textarea', {
        value: content,
        onChange: (e) => setContent(e.target.value),
        placeholder: '笔记内容...',
        rows: 3,
        style: { padding: '8px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-subtle, #ccc)' }
      }),
      React.createElement('button', {
        onClick: handleCreate,
        disabled: loading,
        style: { alignSelf: 'flex-start', padding: '8px 16px', background: 'var(--dsw-alias-accent-primary, #0066cc)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }
      }, loading ? '保存中...' : '提交至服务端持久化存储')
    ),
    React.createElement('h3', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '12px' } }, '服务端已落盘记录:'),
    React.createElement('ul', { style: { paddingLeft: '20px', margin: 0 } },
      list.map(item => React.createElement(
        'li',
        { key: item.id, style: { marginBottom: '10px', fontSize: '13px' } },
        React.createElement('strong', null, item.title),
        React.createElement('span', { style: { color: '#666', marginLeft: '8px' } }, item.content),
        React.createElement('span', { style: { fontSize: '11px', color: '#999', marginLeft: '8px' } }, new Date(item.createdAt).toLocaleTimeString())
      ))
    )
  )
}

/**
 * 客户端装载入口
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // 向全局设置窗口注入面板，并通过 props 将 remote 调用透传给纯 React 组件
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'remote-storage-plugin',
        order: 95,
        label: () => '跨端存储面板'
      },
      () => React.createElement(RemoteStoragePanel, {
        onAdd: async (payload) => {
          // 调用 Typert Remote RPC
          return await ctx.remote.remoteStorage.addNote(payload)
        },
        onFetch: async () => {
          return await ctx.remote.remoteStorage.listNotes({})
        }
      })
    )
  )
}
