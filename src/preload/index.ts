import { contextBridge, ipcRenderer, webUtils } from 'electron'

type ModuleMessage = { moduleId: string; event: string; payload: unknown }
const validName = /^[a-z][a-z0-9-]*$/

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  preferences: {
    getTheme: () => ipcRenderer.invoke('preferences:get-theme'),
    setTheme: (mode: 'light' | 'dark') => ipcRenderer.invoke('preferences:set-theme', mode),
    getStoragePath: () => ipcRenderer.invoke('preferences:get-storage-path'),
    getSidebarCollapsed: () => ipcRenderer.invoke('preferences:get-sidebar-collapsed'),
    setSidebarCollapsed: (collapsed: boolean) => ipcRenderer.invoke('preferences:set-sidebar-collapsed', collapsed),
    getDataDirectory: () => ipcRenderer.invoke('preferences:get-data-directory'),
    chooseDataDirectory: () => ipcRenderer.invoke('preferences:choose-data-directory'),
    resetDataDirectory: () => ipcRenderer.invoke('preferences:reset-data-directory'),
    openDataDirectory: () => ipcRenderer.invoke('preferences:open-data-directory')
  },
  moduleManager: {
    list: () => ipcRenderer.invoke('module-manager:list'),
    getUi: (id: string) => ipcRenderer.invoke('module-manager:get-ui', id),
    catalog: () => ipcRenderer.invoke('module-manager:catalog'),
    getCatalogUrl: () => ipcRenderer.invoke('module-manager:get-catalog-url'),
    setCatalogUrl: (url: string) => ipcRenderer.invoke('module-manager:set-catalog-url', url),
    installUrl: (url: string) => ipcRenderer.invoke('module-manager:install-url', url),
    installFile: () => ipcRenderer.invoke('module-manager:install-file'),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('module-manager:set-enabled', { id, enabled }),
    delete: (id: string) => ipcRenderer.invoke('module-manager:delete', id),
    onChanged: (callback: (modules: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, modules: unknown) => callback(modules)
      ipcRenderer.on('module-manager:changed', listener)
      return () => ipcRenderer.removeListener('module-manager:changed', listener)
    }
  },
  library: {
    folders: () => ipcRenderer.invoke('library:folders'),
    files: (query?: unknown) => ipcRenderer.invoke('library:files', query),
    subfolders: (folderId: string, directory: string) => ipcRenderer.invoke('library:subfolders', { folderId, directory }),
    addFolders: () => ipcRenderer.invoke('library:add-folders'),
    removeFolder: (id: string) => ipcRenderer.invoke('library:remove-folder', id),
    scan: (folderId: string | 'all') => ipcRenderer.invoke('library:scan', folderId),
    setTags: (id: string, tags: string[]) => ipcRenderer.invoke('library:set-tags', { id, tags }),
    open: (id: string) => ipcRenderer.invoke('library:open', id),
    reveal: (id: string) => ipcRenderer.invoke('library:reveal', id),
    delete: (id: string) => ipcRenderer.invoke('library:delete', id),
    autoTagStatus: () => ipcRenderer.invoke('library:auto-tag-status'),
    setAutoTag: (enabled: boolean) => ipcRenderer.invoke('library:set-auto-tag', enabled),
    clearAutoTags: () => ipcRenderer.invoke('library:clear-auto-tags'),
    autoTagModels: () => ipcRenderer.invoke('library:auto-tag-models'),
    setAutoTagModels: (ids: string[]) => ipcRenderer.invoke('library:set-auto-tag-models', ids),
    autoTagFiles: (ids: string[]) => ipcRenderer.invoke('library:auto-tag-files', ids),
    autoTagFolder: (folderId: string, directory: string) => ipcRenderer.invoke('library:auto-tag-folder', { folderId, directory }),
    onAutoTag: (callback: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
      ipcRenderer.on('library:auto-tag', listener)
      return () => ipcRenderer.removeListener('library:auto-tag', listener)
    },
    onDimensions: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('library:dimensions', listener)
      return () => ipcRenderer.removeListener('library:dimensions', listener)
    },
    onScan: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result)
      ipcRenderer.on('library:scan', listener)
      return () => ipcRenderer.removeListener('library:scan', listener)
    }
  },
  notifications: {
    list: () => ipcRenderer.invoke('notifications:list'),
    markRead: (id: string) => ipcRenderer.invoke('notifications:mark-read', id),
    markAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
    clear: () => ipcRenderer.invoke('notifications:clear'),
    onAdded: (callback: (item: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, item: unknown) => callback(item)
      ipcRenderer.on('notifications:added', listener)
      return () => ipcRenderer.removeListener('notifications:added', listener)
    },
    onList: (callback: (items: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, items: unknown) => callback(items)
      ipcRenderer.on('notifications:list', listener)
      return () => ipcRenderer.removeListener('notifications:list', listener)
    }
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    start: (url: string, fileName?: string) => ipcRenderer.invoke('downloads:start', { url, fileName }),
    cancel: (id: string) => ipcRenderer.invoke('downloads:cancel', id),
    retry: (id: string) => ipcRenderer.invoke('downloads:retry', id),
    remove: (id: string) => ipcRenderer.invoke('downloads:remove', id),
    clear: () => ipcRenderer.invoke('downloads:clear'),
    open: (id: string) => ipcRenderer.invoke('downloads:open', id),
    reveal: (id: string) => ipcRenderer.invoke('downloads:reveal', id),
    openFolder: () => ipcRenderer.invoke('downloads:open-folder'),
    onItem: (callback: (item: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, item: unknown) => callback(item)
      ipcRenderer.on('downloads:item', listener)
      return () => ipcRenderer.removeListener('downloads:item', listener)
    },
    onList: (callback: (items: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, items: unknown) => callback(items)
      ipcRenderer.on('downloads:list', listener)
      return () => ipcRenderer.removeListener('downloads:list', listener)
    }
  },
  files: {
    // Sandboxed pages cannot read File.path, so drag-and-drop resolves it here.
    pathFor: (file: File) => webUtils.getPathForFile(file)
  },
  modules: {
    invoke: (moduleId: string, action: string, payload?: unknown) => {
      if (!validName.test(moduleId) || !validName.test(action)) {
        return Promise.reject(new Error('Invalid module request'))
      }
      return ipcRenderer.invoke(`module:${moduleId}:${action}`, payload)
    },
    on: (moduleId: string, event: string, callback: (payload: unknown) => void) => {
      if (!validName.test(moduleId) || !validName.test(event)) return () => undefined
      const listener = (_ipcEvent: Electron.IpcRendererEvent, message: ModuleMessage) => {
        if (message.moduleId === moduleId && message.event === event) callback(message.payload)
      }
      ipcRenderer.on('module:event', listener)
      return () => ipcRenderer.removeListener('module:event', listener)
    }
  }
})
