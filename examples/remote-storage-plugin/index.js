// Host 宿主服务端入口：暴露 @Remote 服务并读写 ctx.storage.domain
import { Service } from '@deepseek-ai/cordis'
import { z } from 'zod'

export const name = 'dsh-remote-storage-plugin'
export const inject = ['storage']

/**
 * 远程存储服务实现类
 * 必须继承 Service 基类并挂载在 Context 上
 */
export class RemoteStorageService extends Service {
  constructor(ctx) {
    // 挂载服务名为 remoteStorage
    super(ctx, 'remoteStorage', true)
    this.memoryFallback = new Map()

    // 若系统挂载了领域存储，声明强校验数据表
    if (ctx.storage?.domain) {
      const NoteSchema = z.object({
        id: z.string(),
        title: z.string().min(1),
        content: z.string(),
        createdAt: z.number()
      })

      this.notesTable = ctx.storage.domain.register({
        name: 'remote_plugin_notes',
        schema: NoteSchema
      })
    }
  }

  /**
   * 远程 RPC 方法：添加笔记
   * 严格遵守四大约束：单一名命参数对象、禁止解构、禁止默认值、末位为 signal
   */
  async addNote(payload, signal) {
    if (signal?.aborted) throw new Error('操作已取消')

    const id = 'note_' + Date.now()
    const record = {
      id,
      title: payload.title,
      content: payload.content || '',
      createdAt: Date.now()
    }

    if (this.notesTable) {
      await this.notesTable.set(id, record)
    } else {
      this.memoryFallback.set(id, record)
    }

    return { ok: true, id, record }
  }

  /**
   * 远程 RPC 方法：获取笔记列表
   */
  async listNotes(payload, signal) {
    if (signal?.aborted) throw new Error('操作已取消')

    if (this.notesTable) {
      const list = await this.notesTable.list?.() || []
      return { ok: true, list }
    }

    return { ok: true, list: Array.from(this.memoryFallback.values()) }
  }
}

export function apply(ctx) {
  ctx.plugin(RemoteStorageService)
  ctx.logger('remote-storage').info('RemoteStorageService 已挂载至 Context')
}
