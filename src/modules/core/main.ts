import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { DownloadItem, DownloadRequest } from '../../downloads/types'
import type { DataDirectory } from '../../main/config/DataDirectory'
import type { SettingsStore } from '../../main/config/SettingsStore'
import type { DownloadManager } from '../../main/downloads/DownloadManager'
import type { NotificationCenter } from '../../main/notifications/NotificationCenter'
import type { AppNotification, NotificationInput } from '../../notifications/types'

export type ModuleDownloadRequest = DownloadRequest & {
  /** Save inside the module's data folder (`<data-dir>/<module-id>/<subfolder>`) instead of the app's Downloads folder. */
  subfolder?: string
}

export type MainModuleApi = {
  handle: (action: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown) => void
  emit: (target: WebContents, event: string, payload: unknown) => void
  settings: {
    get: <T>(key: string, fallback: T) => T
    set: (key: string, value: unknown) => void
  }
  paths: {
    /**
     * The module's own data folder, `<data-dir>/<module-id>`, or a folder inside it (`data('video')`).
     * Created on demand. Downloads and generated files belong here; the module decides the layout inside.
     */
    data: (...segments: string[]) => string
  }
  /** The app's Download manager: queued, shown on the Download page, saved to <data-dir>/Downloads by default. */
  downloads: {
    start: (request: ModuleDownloadRequest) => DownloadItem
    /** Resolves with the finished download (its `path` points at the file); rejects if it fails or is cancelled. */
    wait: (id: string) => Promise<DownloadItem>
    get: (id: string) => DownloadItem | undefined
  }
  /** Shows a notification in the header's bell; `link` is an in-app route such as '/modules/<module-id>'. */
  notify: (input: NotificationInput) => AppNotification | null
}

export type MainModule = {
  id: string
  register: (api: MainModuleApi) => void | (() => void)
}

const loaded = new Set<string>()
const validName = /^[a-z][a-z0-9-]*$/

// Called once per module by the main application at startup.
export function loadModule(module: MainModule, settingsStore: SettingsStore, dataDirectory: DataDirectory, downloads?: DownloadManager, notifications?: NotificationCenter): () => void {
  if (!validName.test(module.id) || loaded.has(module.id)) {
    throw new Error(`Invalid or duplicate module id: ${module.id}`)
  }
  loaded.add(module.id)
  const channels: string[] = []

  const api: MainModuleApi = {
    settings: {
      get: (key, fallback) => settingsStore.get(`module-${module.id}`, key, fallback),
      set: (key, value) => settingsStore.set(`module-${module.id}`, key, value)
    },
    paths: { data: (...segments) => dataDirectory.folderFor(module.id, ...segments) },
    downloads: {
      start: ({ subfolder, ...request }) => {
        if (!downloads) throw new Error('Downloads are not available')
        const folder = subfolder ? dataDirectory.folderFor(module.id, ...subfolder.split('/').filter(Boolean)) : undefined
        return downloads.start(request, module.id, folder)
      },
      wait: (id) => downloads ? downloads.wait(id) : Promise.reject(new Error('Downloads are not available')),
      get: (id) => downloads?.get(id)
    },
    notify: (input) => notifications?.notify(module.id, input) ?? null,
    handle(action, handler) {
      if (!validName.test(action)) throw new Error(`Invalid action: ${action}`)
      const channel = `module:${module.id}:${action}`
      if (ipcMain.listenerCount(channel)) throw new Error(`Duplicate action: ${channel}`)
      channels.push(channel)
      ipcMain.handle(channel, (event, payload: unknown) => {
        if (event.sender.isDestroyed() || event.sender.getURL() === '') {
          throw new Error('Invalid module request')
        }
        return handler(event, payload)
      })
    },
    emit(target, event, payload) {
      if (!validName.test(event) || target.isDestroyed()) return
      target.send('module:event', { moduleId: module.id, event, payload })
    }
  }
  try {
    const cleanup = module.register(api)
    return () => {
      try { cleanup?.() }
      finally {
        channels.forEach((channel) => ipcMain.removeHandler(channel))
        loaded.delete(module.id)
      }
    }
  } catch (error) {
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    loaded.delete(module.id)
    throw error
  }
}
