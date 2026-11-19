import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import type { DownloadManager } from './DownloadManager'

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Invalid download')
  return value
}

/** IPC for the Download page. Returns a function that removes the handlers. */
export function startDownloadIpc(manager: DownloadManager, defaultFolder: () => string): () => void {
  const channels: string[] = []
  const handle = (action: string, callback: (payload: unknown) => unknown) => {
    const channel = `downloads:${action}`
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (event.sender.isDestroyed() || !event.sender.getURL()) throw new Error('Invalid download request')
      return callback(payload)
    })
    channels.push(channel)
  }
  const finishedPath = (value: unknown) => {
    const item = manager.get(requireId(value))
    if (!item?.path || !existsSync(item.path)) throw new Error('The downloaded file is no longer there')
    return item.path
  }

  handle('list', () => manager.list())
  handle('start', (payload) => {
    const request = payload as { url?: unknown; fileName?: unknown } | null
    return manager.start({ url: request?.url as string, fileName: typeof request?.fileName === 'string' ? request.fileName : undefined })
  })
  handle('cancel', (payload) => manager.cancel(requireId(payload)))
  handle('retry', (payload) => manager.retry(requireId(payload)))
  handle('remove', (payload) => manager.remove(requireId(payload)))
  handle('clear', () => manager.clearFinished())
  handle('open', async (payload) => {
    const error = await shell.openPath(finishedPath(payload))
    if (error) throw new Error(error)
  })
  handle('reveal', (payload) => shell.showItemInFolder(finishedPath(payload)))
  handle('open-folder', async () => {
    const error = await shell.openPath(defaultFolder())
    if (error) throw new Error(error)
  })

  return () => channels.forEach((channel) => ipcMain.removeHandler(channel))
}
