import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DataDirectory } from './config/DataDirectory'
import { SettingsStore } from './config/SettingsStore'
import { ModuleManager } from './modules/ModuleManager'
import { youtubeMainModule } from '../modules/youtube/main'
import { webviewMainModule } from '../modules/webview/main'
import { mp3PlayerMainModule } from '../modules/mp3player/main'
import { videoPlayerMainModule } from '../modules/videoplayer/main'
import { mobileFarmMainModule } from '../modules/mobilefarm/main'
import { subtitlesMainModule } from '../modules/subtitles/main'
import { notesMainModule } from '../modules/notes/main'
import { expensesMainModule } from '../modules/expenses/main'
import { startLibrary } from './library/LibraryService'
import { startDownloadIpc } from './downloads/downloadIpc'
import { DownloadManager } from './downloads/DownloadManager'
import { DownloadStore } from './downloads/DownloadStore'
import { NotificationCenter } from './notifications/NotificationCenter'
import { startNotificationIpc } from './notifications/notificationIpc'
import { NotificationStore } from './notifications/NotificationStore'

function createWindow(): void {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#f8f9fd',
    title: 'Miniapp Studio',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let settingsStore: SettingsStore | null = null
let stopLibrary: (() => void) | null = null
let downloadStore: DownloadStore | null = null
let downloads: DownloadManager | null = null
let stopDownloadIpc: (() => void) | null = null
let notificationStore: NotificationStore | null = null
let notifications: NotificationCenter | null = null
let stopNotificationIpc: (() => void) | null = null

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png'))
  settingsStore = new SettingsStore()
  const store = settingsStore
  store.retireBuiltInModule('library')
  const dataDirectory = new DataDirectory(store)
  stopLibrary = startLibrary(store.path, () => dataDirectory.folderFor('library', 'models'),
    () => [join(dataDirectory.current(), 'Models'), join(app.getPath('userData'), 'models')],
    // Auto-tag models download through the Download manager, so they show up on the Download page.
    async ({ url, folder, fileName, signal, onProgress }) => {
      if (!downloads) throw new Error('Downloads are not available')
      const item = await downloads.downloadTo({ url, fileName, folder, owner: 'library', signal, onProgress: (update) => onProgress(update.received) })
      return item.path!
    },
    (input) => { notifications?.notify('library', input) })
  const broadcast = (channel: string, payload: unknown) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(channel, payload))
  notificationStore = new NotificationStore(store.path)
  notifications = new NotificationCenter(notificationStore, {
    added: (item) => broadcast('notifications:added', item),
    list: (items) => broadcast('notifications:list', items)
  })
  stopNotificationIpc = startNotificationIpc(notifications)
  downloadStore = new DownloadStore(store.path)
  downloads = new DownloadManager(downloadStore, () => dataDirectory.downloadsFolder(), {
    item: (item) => broadcast('downloads:item', item),
    list: (items) => broadcast('downloads:list', items),
    finished: (item) => {
      if (item.status === 'completed') notifications?.notify('downloads', { title: 'Download complete', body: item.fileName, kind: 'success', link: '/downloads' })
      if (item.status === 'failed') notifications?.notify('downloads', { title: 'Download failed', body: `${item.fileName}: ${item.error ?? 'unknown error'}`, kind: 'error', link: '/downloads' })
    }
  })
  stopDownloadIpc = startDownloadIpc(downloads, () => dataDirectory.downloadsFolder())
  const manager = new ModuleManager(store, dataDirectory, downloads, notifications)
  manager.registerBuiltIn(youtubeMainModule, { id: 'youtube', name: 'YouTube Downloader', version: '1.0.0', description: 'Download video or audio with yt-dlp.' })
  manager.registerBuiltIn(webviewMainModule, { id: 'webview', name: 'Web Browser', version: '1.0.0', description: 'Browse websites with separate profiles.' })
  manager.registerBuiltIn(mp3PlayerMainModule, { id: 'mp3player', name: 'MP3 Player', version: '1.0.0', description: 'Play local audio files and folders.' })
  manager.registerBuiltIn(videoPlayerMainModule, { id: 'videoplayer', name: 'Video Player', version: '1.0.0', description: 'Watch local video files and folders.' })
  manager.registerBuiltIn(subtitlesMainModule, { id: 'subtitles', name: 'Biên soạn phụ đề', version: '1.0.0', description: 'Liên kết phụ đề tiếng Anh và tiếng Việt thành dữ liệu đáp án.' })
  manager.registerBuiltIn(mobileFarmMainModule, { id: 'mobilefarm', name: 'Mobile Farm', version: '1.0.0', description: 'Mirror and control multiple Android devices with scrcpy.' })
  manager.registerBuiltIn(notesMainModule, { id: 'notes', name: 'Notes', version: '1.0.0', description: 'Write rich notes and paste images straight in.' })
  manager.registerBuiltIn(expensesMainModule, { id: 'expenses', name: 'Expenses', version: '1.0.0', description: 'Track spending by category with weekly, monthly and yearly totals.' })
  manager.start()
  const notifyModulesChanged = () => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('module-manager:changed', manager.list()))
  const requireId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,49}$/.test(value)) throw new Error('Invalid module id')
    return value
  }
  ipcMain.handle('preferences:get-theme', () => store.get<'light' | 'dark' | null>('appearance', 'theme', null))
  ipcMain.handle('preferences:set-theme', (_event, mode: unknown) => {
    if (mode !== 'light' && mode !== 'dark') throw new Error('Invalid theme')
    store.set('appearance', 'theme', mode)
  })
  ipcMain.handle('preferences:get-storage-path', () => store.path)
  ipcMain.handle('preferences:get-sidebar-collapsed', () => store.get<boolean>('appearance', 'sidebar-collapsed', false) === true)
  ipcMain.handle('preferences:set-sidebar-collapsed', (_event, collapsed: unknown) => {
    if (typeof collapsed !== 'boolean') throw new Error('Invalid sidebar state')
    store.set('appearance', 'sidebar-collapsed', collapsed)
  })
  const dataDirectoryInfo = () => ({ path: dataDirectory.current(), defaultPath: dataDirectory.defaultPath })
  ipcMain.handle('preferences:get-data-directory', () => dataDirectoryInfo())
  ipcMain.handle('preferences:choose-data-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Choose data folder', defaultPath: dataDirectory.current(), properties: ['openDirectory', 'createDirectory'] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (!result.canceled && result.filePaths[0]) await dataDirectory.set(result.filePaths[0])
    return dataDirectoryInfo()
  })
  ipcMain.handle('preferences:reset-data-directory', () => { dataDirectory.reset(); return dataDirectoryInfo() })
  ipcMain.handle('preferences:open-data-directory', async () => {
    const path = dataDirectory.current()
    await mkdir(path, { recursive: true })
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.handle('module-manager:list', () => manager.list())
  ipcMain.handle('module-manager:get-ui', (_event, id: unknown) => manager.readUi(requireId(id)))
  ipcMain.handle('module-manager:catalog', () => manager.catalog())
  ipcMain.handle('module-manager:get-catalog-url', () => manager.getCatalogUrl())
  ipcMain.handle('module-manager:set-catalog-url', (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid catalog URL')
    manager.setCatalogUrl(url)
  })
  ipcMain.handle('module-manager:install-url', async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid package URL')
    const module = await manager.installFromUrl(url)
    notifyModulesChanged()
    return module
  })
  ipcMain.handle('module-manager:install-file', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Miniapp module', extensions: ['miniapp', 'zip'] }] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const module = await manager.installFromFile(result.filePaths[0])
    notifyModulesChanged()
    return module
  })
  ipcMain.handle('module-manager:set-enabled', async (_event, value: unknown) => {
    const request = value as { id?: unknown; enabled?: unknown } | null
    if (typeof request?.enabled !== 'boolean') throw new Error('Invalid module state')
    await manager.setEnabled(requireId(request.id), request.enabled)
    notifyModulesChanged()
  })
  ipcMain.handle('module-manager:delete', async (_event, id: unknown) => {
    await manager.remove(requireId(id))
    notifyModulesChanged()
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopDownloadIpc?.()
  stopNotificationIpc?.()
  const closingStore = downloadStore
  const closingNotifications = notificationStore
  notifications = null
  void (downloads?.dispose() ?? Promise.resolve()).then(() => { closingStore?.close(); closingNotifications?.close() })
  stopLibrary?.()
  settingsStore?.close()
})
