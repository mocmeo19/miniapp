/// <reference types="vite/client" />
import type { CatalogEntry, InstalledModule } from '../../modules/core/types'
import type { DownloadItem } from '../../downloads/types'
import type { AppNotification } from '../../notifications/types'
import type { AutoTagModels, AutoTagStatus, LibraryFolder, LibraryPage, LibraryQuery, LibraryScanEvent, LibrarySubfolder } from '../../library/types'

declare global {
type DataDirectoryInfo = { path: string; defaultPath: string }

interface Window {
  desktop?: {
    platform: string
    preferences: {
      getTheme: () => Promise<'light' | 'dark' | null>
      setTheme: (mode: 'light' | 'dark') => Promise<void>
      getStoragePath: () => Promise<string>
      getSidebarCollapsed: () => Promise<boolean>
      setSidebarCollapsed: (collapsed: boolean) => Promise<void>
      getDataDirectory: () => Promise<DataDirectoryInfo>
      chooseDataDirectory: () => Promise<DataDirectoryInfo>
      resetDataDirectory: () => Promise<DataDirectoryInfo>
      openDataDirectory: () => Promise<void>
    }
    moduleManager: {
      list: () => Promise<InstalledModule[]>
      getUi: (id: string) => Promise<string>
      catalog: () => Promise<CatalogEntry[]>
      getCatalogUrl: () => Promise<string>
      setCatalogUrl: (url: string) => Promise<void>
      installUrl: (url: string) => Promise<InstalledModule>
      installFile: () => Promise<InstalledModule | null>
      setEnabled: (id: string, enabled: boolean) => Promise<void>
      delete: (id: string) => Promise<void>
      onChanged: (callback: (modules: InstalledModule[]) => void) => () => void
    }
    library: {
      folders: () => Promise<LibraryFolder[]>
      files: (query?: LibraryQuery) => Promise<LibraryPage>
      subfolders: (folderId: string, directory: string) => Promise<LibrarySubfolder[]>
      addFolders: () => Promise<LibraryFolder[]>
      removeFolder: (id: string) => Promise<void>
      scan: (folderId: string | 'all') => Promise<LibraryScanEvent[]>
      setTags: (id: string, tags: string[]) => Promise<void>
      open: (id: string) => Promise<void>
      reveal: (id: string) => Promise<void>
      delete: (id: string) => Promise<void>
      autoTagStatus: () => Promise<AutoTagStatus>
      setAutoTag: (enabled: boolean) => Promise<AutoTagStatus>
      clearAutoTags: () => Promise<AutoTagStatus>
      autoTagModels: () => Promise<AutoTagModels>
      setAutoTagModels: (ids: string[]) => Promise<AutoTagModels>
      autoTagFiles: (ids: string[]) => Promise<AutoTagStatus>
      autoTagFolder: (folderId: string, directory: string) => Promise<AutoTagStatus>
      onAutoTag: (callback: (status: AutoTagStatus) => void) => () => void
      onDimensions: (callback: () => void) => () => void
      onScan: (callback: (event: LibraryScanEvent) => void) => () => void
    }
    notifications: {
      list: () => Promise<AppNotification[]>
      markRead: (id: string) => Promise<AppNotification[]>
      markAllRead: () => Promise<AppNotification[]>
      clear: () => Promise<AppNotification[]>
      onAdded: (callback: (item: AppNotification) => void) => () => void
      onList: (callback: (items: AppNotification[]) => void) => () => void
    }
    downloads: {
      list: () => Promise<DownloadItem[]>
      start: (url: string, fileName?: string) => Promise<DownloadItem>
      cancel: (id: string) => Promise<void>
      retry: (id: string) => Promise<DownloadItem>
      remove: (id: string) => Promise<DownloadItem[]>
      clear: () => Promise<DownloadItem[]>
      open: (id: string) => Promise<void>
      reveal: (id: string) => Promise<void>
      openFolder: () => Promise<void>
      onItem: (callback: (item: DownloadItem) => void) => () => void
      onList: (callback: (items: DownloadItem[]) => void) => () => void
    }
    files: {
      pathFor: (file: File) => string
    }
    modules: {
      invoke: <T>(moduleId: string, action: string, payload?: unknown) => Promise<T>
      on: <T>(moduleId: string, event: string, callback: (payload: T) => void) => () => void
    }
  }
}
}
