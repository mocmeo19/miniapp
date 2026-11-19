import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { DataDirectory } from '../src/main/config/DataDirectory'
import { SettingsStore } from '../src/main/config/SettingsStore'
import { startDownloadIpc } from '../src/main/downloads/downloadIpc'
import { DownloadManager } from '../src/main/downloads/DownloadManager'
import { DownloadStore } from '../src/main/downloads/DownloadStore'
import { ModuleManager } from '../src/main/modules/ModuleManager'
import { NotificationCenter } from '../src/main/notifications/NotificationCenter'
import { startNotificationIpc } from '../src/main/notifications/notificationIpc'
import { NotificationStore } from '../src/main/notifications/NotificationStore'
import type { MainModuleApi } from '../src/modules/core/main'

const userData = mkdtempSync(join(tmpdir(), 'miniapp-downloads-test-'))
app.setPath('userData', userData)
app.setPath('downloads', join(userData, 'downloads'))
const dataFolder = join(userData, 'downloads', 'MiniApp')
const payload = Buffer.alloc(256 * 1024, 7)

// Local test server: a plain file, a file named by Content-Disposition, a slow stream and a 404.
const server = createServer((request, response) => {
  if (request.url === '/file.bin') { response.writeHead(200, { 'Content-Length': payload.length }); response.end(payload); return }
  if (request.url === '/named') { response.writeHead(200, { 'Content-Disposition': 'attachment; filename="report.pdf"' }); response.end('pdf'); return }
  if (request.url === '/slow') {
    response.writeHead(200, { 'Content-Length': 10_000_000 })
    const timer = setInterval(() => response.write(Buffer.alloc(1024)), 20)
    request.on('close', () => clearInterval(timer))
    return
  }
  response.writeHead(404); response.end()
})

void app.whenReady().then(async () => {
  let passed = false
  const settings = new SettingsStore()
  const store = new DownloadStore(settings.path)
  const notificationStore = new NotificationStore(settings.path)
  const notifications = new NotificationCenter(notificationStore, {
    added: (item) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('notifications:added', item)),
    list: (items) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('notifications:list', items))
  })
  const stopNotificationIpc = startNotificationIpc(notifications)
  const manager = new DownloadManager(store, () => new DataDirectory(settings).downloadsFolder(), {
    item: () => undefined,
    list: () => undefined,
    finished: (item) => {
      if (item.status === 'completed') notifications.notify('downloads', { title: 'Download complete', body: item.fileName, kind: 'success', link: '/downloads' })
      if (item.status === 'failed') notifications.notify('downloads', { title: 'Download failed', body: item.fileName, kind: 'error', link: '/downloads' })
    }
  })
  const stopIpc = startDownloadIpc(manager, () => new DataDirectory(settings).downloadsFolder())
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const first = await manager.wait(manager.start({ url: `${base}/file.bin` }).id)
    assert.equal(first.path, join(dataFolder, 'Downloads', 'file.bin'), 'Downloads go to <data-dir>/Downloads by default')
    assert.equal(statSync(first.path!).size, payload.length)
    assert.equal(first.owner, 'app')
    const second = await manager.wait(manager.start({ url: `${base}/file.bin` }).id)
    assert.equal(second.fileName, 'file (2).bin', 'Existing files are never overwritten')
    assert.equal((await manager.wait(manager.start({ url: `${base}/named` }).id)).fileName, 'report.pdf', 'Content-Disposition names the file')
    assert.equal((await manager.wait(manager.start({ url: `${base}/file.bin`, fileName: '../evil:name.bin' }).id)).fileName, '_evil_name.bin', 'Requested names are made safe')

    const missing = manager.start({ url: `${base}/missing.txt` })
    await assert.rejects(manager.wait(missing.id), /HTTP 404/)
    assert.equal(manager.get(missing.id)?.status, 'failed')
    manager.retry(missing.id)
    await assert.rejects(manager.wait(missing.id), /HTTP 404/, 'Failed downloads can be retried')

    const slow = manager.start({ url: `${base}/slow` })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(manager.get(slow.id)?.status, 'running')
    manager.cancel(slow.id)
    await assert.rejects(manager.wait(slow.id))
    assert.equal(manager.get(slow.id)?.status, 'cancelled')
    assert.equal(readdirSync(join(dataFolder, 'Downloads')).some((name) => name.endsWith('.part')), false, 'Cancelled downloads leave no partial file')
    assert.throws(() => manager.start({ url: 'ftp://example.com/a.bin' }), /HTTP and HTTPS/)

    let moduleApi: MainModuleApi | null = null
    const modules = new ModuleManager(settings, new DataDirectory(settings), manager, notifications)
    modules.registerBuiltIn({ id: 'tester', register: (api) => { moduleApi = api } }, { id: 'tester', name: 'Tester', version: '1.0.0', description: 'Test module' })
    modules.start()
    const fromModule = await moduleApi!.downloads.wait(moduleApi!.downloads.start({ url: `${base}/file.bin`, subfolder: 'cache' }).id)
    assert.equal(fromModule.owner, 'tester', 'Module downloads record which module started them')
    assert.equal(fromModule.path, join(dataFolder, 'tester', 'cache', 'file.bin'), 'Modules can keep downloads in their own data folder')
    const toDownloads = await moduleApi!.downloads.wait(moduleApi!.downloads.start({ url: `${base}/named` }).id)
    assert.equal(toDownloads.path, join(dataFolder, 'Downloads', 'report (2).pdf'), 'Module downloads default to the app Downloads folder')

    const sent = moduleApi!.notify({ title: 'Hello from tester', body: 'Module message', link: 'https://evil.example' })
    assert.equal(sent?.source, 'tester', 'Module notifications record their module')
    assert.equal(sent?.link, null, 'Notifications only link inside the app')
    const titles = notifications.list().map((item) => item.title)
    assert.equal(titles.filter((title) => title === 'Download complete').length, 6, 'Every finished download is announced')
    assert.equal(titles.filter((title) => title === 'Download failed').length, 2, 'Failed downloads are announced (cancelled ones are not)')

    const interrupted = manager.start({ url: `${base}/slow` })
    await new Promise((resolve) => setTimeout(resolve, 200))
    const reopened = new DownloadStore(settings.path)
    assert.equal(reopened.get(interrupted.id)?.status, 'failed', 'Downloads left running when the app closed can be retried')
    reopened.close()
    manager.cancel(interrupted.id)
    await manager.wait(interrupted.id).catch(() => undefined)

    ipcMain.handle('module-manager:list', () => modules.list())
    ipcMain.handle('preferences:get-theme', () => null)
    const renderer = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { preload: join(process.cwd(), 'out/preload/index.js'), sandbox: true, contextIsolation: true } })
    await renderer.loadFile(join(process.cwd(), 'out/renderer/index.html'), { hash: '/downloads' })
    const ui = (code: string) => renderer.webContents.executeJavaScript(code)
    const waitFor = async (expression: string) => { for (let index = 0; index < 100; index++) { if (await ui(expression)) return true; await new Promise((resolve) => setTimeout(resolve, 100)) } return false }
    assert.equal(await waitFor("document.querySelectorAll('.downloads-row').length === 9"), true, 'The Download page lists every download')
    assert.equal(await ui("document.querySelector('a.nav-item.active')?.getAttribute('href')"), '#/downloads', 'Download is in the sidebar and highlighted')
    assert.equal(await ui("[...document.querySelectorAll('.downloads-row .ant-tag')].some((tag) => tag.textContent === 'tester')"), true, 'Module downloads show their module')
    await ui("[...document.querySelectorAll('.downloads-toolbar .ant-segmented-item')].find((item) => item.textContent.startsWith('Failed'))?.click(); 0")
    assert.equal(await waitFor("document.querySelectorAll('.downloads-row').length === 3"), true, 'The Failed filter shows failed and cancelled downloads')
    assert.equal(await waitFor("document.querySelector('.bell-button .ant-badge-count')?.textContent === '9'"), true, 'The header bell shows the unread count')
    await ui("document.querySelector('.bell-button')?.click(); 0")
    assert.equal(await waitFor("document.querySelectorAll('.bell-panel .bell-item').length === 9"), true, 'The bell lists recent notifications')
    assert.equal(await ui("document.querySelector('.bell-panel .bell-item strong')?.textContent"), 'Hello from tester', 'Newest notifications come first')
    await ui("[...document.querySelectorAll('.bell-panel header button')].find((button) => button.textContent.includes('Mark all'))?.click(); 0")
    assert.equal(await waitFor("!document.querySelector('.bell-button .ant-badge-count') && !document.querySelector('.bell-item.is-unread')"), true, 'Mark all as read clears the badge')
    renderer.destroy()

    console.log('Downloads: default folder, unique names, Content-Disposition, failures and retry, cancel, module API, restart recovery and UI passed')
    passed = true
  } catch (error) { console.error(error) }
  finally {
    stopIpc()
    stopNotificationIpc()
    await manager.dispose()
    store.close()
    notificationStore.close()
    settings.close()
    server.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await rm(userData, { recursive: true, force: true }).catch(() => undefined)
    app.exit(passed ? 0 : 1)
  }
})
