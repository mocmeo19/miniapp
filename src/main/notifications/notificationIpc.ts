import { ipcMain } from 'electron'
import type { NotificationCenter } from './NotificationCenter'

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

/** IPC for the header's notification list. Returns a function that removes the handlers. */
export function startNotificationIpc(center: NotificationCenter): () => void {
  const channels: string[] = []
  const handle = (action: string, callback: (payload: unknown) => unknown) => {
    const channel = `notifications:${action}`
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (event.sender.isDestroyed() || !event.sender.getURL()) throw new Error('Invalid notification request')
      return callback(payload)
    })
    channels.push(channel)
  }
  handle('list', () => center.list())
  handle('mark-read', (payload) => {
    if (typeof payload !== 'string' || !uuid.test(payload)) throw new Error('Invalid notification')
    return center.markRead(payload)
  })
  handle('mark-all-read', () => center.markAllRead())
  handle('clear', () => center.clear())
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel))
}
