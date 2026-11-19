import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { DataDirectory } from '../src/main/config/DataDirectory'
import { SettingsStore } from '../src/main/config/SettingsStore'
import { ModuleManager } from '../src/main/modules/ModuleManager'
import { youtubeMainModule } from '../src/modules/youtube/main'

const packageFile = process.argv[2]
if (!packageFile) throw new Error('Pass a .miniapp package path')
const userData = mkdtempSync(join(tmpdir(), 'miniapp-modules-test-'))
app.setPath('userData', userData)
app.setPath('downloads', join(userData, 'downloads'))

void app.whenReady().then(async () => {
  mkdirSync(join(userData, 'module-data'), { recursive: true })
  const sampleInfo = { id: 'abc123', title: 'Sample video', channel: 'Sample channel', duration: 212, thumbnail: null, ffmpegAvailable: false,
    options: [
      { id: '137', kind: 'video', label: '1080p · MP4 · video only', extension: 'mp4', size: 52428800, requiresFfmpeg: true },
      { id: '22', kind: 'video', label: '720p · 60 fps · MP4 · with audio', extension: 'mp4', size: 20971520, requiresFfmpeg: false },
      { id: '18', kind: 'video', label: '360p · MP4 · with audio', extension: 'mp4', size: null, requiresFfmpeg: false },
      { id: '140', kind: 'audio', label: 'M4A · 129 kbps', extension: 'm4a', size: 3145728, requiresFfmpeg: false }
    ] }
  writeFileSync(join(userData, 'module-data', 'youtube-history.json'), JSON.stringify([
    { url: 'https://www.youtube.com/watch?v=abc123', inspectedAt: Date.now() - 3600000, info: sampleInfo },
    { broken: true }
  ]))
  const store = new SettingsStore()
  const manager = new ModuleManager(store)
  try {
    manager.registerBuiltIn(youtubeMainModule, { id: 'youtube', name: 'YouTube Downloader', version: '1.0.0', description: 'Download video or audio with yt-dlp.' })
    manager.start()
    assert.equal(manager.list().find((module) => module.id === 'youtube')?.enabled, true)

    const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
    await window.loadURL('data:text/html,<html><body>test</body></html>')
    const youtubeStatus = await window.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('module:youtube:status')") as { folder: string; ffmpegAvailable: boolean }
    assert.equal(youtubeStatus.folder, join(userData, 'downloads', 'MiniApp', 'youtube'), 'YouTube data lives in <data-dir>/<module-id>')
    const dataDirectory = new DataDirectory(store)
    assert.equal(dataDirectory.folderFor('youtube', 'video'), join(userData, 'downloads', 'MiniApp', 'youtube', 'video'))
    for (const segments of [['..'], ['.'], ['a/b'], ['..', 'escape']]) assert.throws(() => dataDirectory.folderFor('youtube', ...segments), `Rejects ${segments.join(', ')}`)
    assert.throws(() => dataDirectory.folderFor('../youtube'))
    store.set('module-youtube', 'download-folder', '/somewhere/else')
    assert.equal((await window.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('module:youtube:status')") as { folder: string }).folder, youtubeStatus.folder, 'A legacy custom download folder is ignored')
    await assert.rejects(window.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('module:youtube:choose-folder')"), 'Choosing another download folder is no longer possible')

    ipcMain.handle('module-manager:list', () => manager.list())
    ipcMain.handle('preferences:get-theme', () => null)
    ipcMain.handle('preferences:set-theme', () => undefined)
    ipcMain.handle('module-manager:get-catalog-url', () => manager.getCatalogUrl())
    ipcMain.handle('module-manager:catalog', () => manager.catalog())
    const renderer = new BrowserWindow({
      show: false,
      webPreferences: { preload: join(process.cwd(), 'out/preload/index.js'), sandbox: true, contextIsolation: true }
    })
    await renderer.loadFile(join(process.cwd(), 'out/renderer/index.html'))
    const sidebarLoaded = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const link = document.querySelector('a[href="#/modules/youtube"]')
        if (link || Date.now() > deadline) resolve(Boolean(link))
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(sidebarLoaded, true, 'YouTube link should load in the sidebar by default')
    await renderer.loadURL(`${renderer.webContents.getURL()}#/modules/youtube`)
    const pageLoaded = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const heading = document.querySelector('.module-header h1')
        if (heading || Date.now() > deadline) resolve(heading?.textContent === 'YouTube Downloader')
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(pageLoaded, true, 'YouTube route should render its page')
    const activeLinks = await renderer.webContents.executeJavaScript("[...document.querySelectorAll('.nav-item.active')].map((link) => link.getAttribute('href'))") as string[]
    assert.deepEqual(activeLinks, ['#/modules/youtube'], 'Only the open module is highlighted in the sidebar')
    const historyShown = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const item = document.querySelector('.youtube-history-item')
        if (item || Date.now() > deadline) resolve(item?.textContent?.includes('Sample video') ?? false)
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(historyShown, true, 'Saved searches should be listed in History')
    await renderer.webContents.executeJavaScript("document.querySelector('.youtube-history-item')?.click()")
    const reopened = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const title = document.querySelector('.youtube-video-copy h3')
        if (title || Date.now() > deadline) resolve(title?.textContent === 'Sample video' && document.querySelector('.youtube-url-row input')?.value === 'https://www.youtube.com/watch?v=abc123')
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(reopened, true, 'Opening a history item restores the video without searching again')
    await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => { if (document.querySelector('.youtube-save-row strong')?.textContent !== '…' || Date.now() > deadline) resolve(true); else setTimeout(check, 50) }
      check()
    })`)
    const table = await renderer.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('.youtube-format-table .ant-table-tbody tr[data-row-key]')]
      return {
        keys: rows.map((row) => row.getAttribute('data-row-key')),
        quality: rows.map((row) => row.cells[0]?.textContent),
        unavailable: rows.filter((row) => row.classList.contains('is-unavailable')).map((row) => row.getAttribute('data-row-key')),
        selected: document.querySelector('.youtube-format-table tr.is-selected')?.getAttribute('data-row-key') ?? null,
        radios: document.querySelectorAll('.youtube-format-table .ant-radio').length,
        saveTo: document.querySelector('.youtube-save-row strong')?.textContent,
        steps: [...document.querySelectorAll('.youtube-step h3')].map((heading) => heading.textContent)
      }
    })()`) as { keys: string[]; quality: string[]; unavailable: string[]; selected: string | null; radios: number; saveTo: string; steps: string[] }
    assert.deepEqual(table.keys, ['137', '22', '18'], 'Video formats are listed in a table, best quality first')
    assert.deepEqual(table.quality, ['1080p', '720p60 fps', '360p'], 'Old history rows read quality and fps from the label')
    assert.deepEqual(table.unavailable, youtubeStatus.ffmpegAvailable ? [] : ['137'], 'Formats that need ffmpeg are disabled without it')
    assert.equal(table.selected, null, 'Nothing is highlighted before a download starts')
    assert.equal(table.radios, 0, 'Rows download directly instead of being selected')
    assert.deepEqual(table.steps, ['Video link', 'Download', 'History'], 'The Save to your device step is gone')
    assert.equal(table.saveTo, join(userData, 'downloads', 'MiniApp', 'youtube', 'video'), 'Video downloads go to <data-dir>/youtube/video')
    const rowButtons = await renderer.webContents.executeJavaScript(`[...document.querySelectorAll('.youtube-format-table .ant-table-tbody tr[data-row-key]')]
      .map((row) => { const button = row.querySelector('button[aria-label^="Download"]'); return button ? (button.disabled ? 'off' : 'on') : 'missing' })`) as string[]
    assert.deepEqual(rowButtons, [youtubeStatus.ffmpegAvailable ? 'on' : 'off', 'on', 'on'], 'Every format row has its own Download button')

    await renderer.webContents.executeJavaScript("location.hash = '#/modules'")
    const managerPage = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const cards = [...document.querySelectorAll('.modules-card')]
        if (cards.length || Date.now() > deadline) resolve({
          cards: cards.map((card) => card.querySelector('h3')?.textContent),
          stats: [...document.querySelectorAll('.modules-stats strong')].map((value) => value.textContent),
          hasIcon: !!cards[0]?.querySelector('.modules-card-icon .anticon-youtube'),
          install: !!document.querySelector('.modules-toolbar .ant-btn-primary')
        })
        else setTimeout(check, 50)
      }
      check()
    })`) as { cards: string[]; stats: string[]; hasIcon: boolean; install: boolean }
    assert.deepEqual(managerPage.cards, ['YouTube Downloader'], 'Module Manager shows installed modules as cards')
    assert.deepEqual(managerPage.stats, ['1', '1', '0'], 'Stats count installed, enabled and disabled modules')
    assert.equal(managerPage.hasIcon, true, 'Cards use the module icon')
    assert.equal(managerPage.install, true, 'Install button is available')
    const filtered = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const input = document.querySelector('.modules-toolbar input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'zzz')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => resolve(document.querySelectorAll('.modules-card').length), 300)
    })`) as number
    assert.equal(filtered, 0, 'Search filters the module list')
    const discover = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      [...document.querySelectorAll('.modules-tabs .ant-tabs-tab')].find((tab) => tab.textContent.includes('Discover'))?.click()
      setTimeout(() => resolve(!!document.querySelector('.modules-catalog-source input')), 500)
    })`) as boolean
    assert.equal(discover, true, 'Discover tab lets you set a catalog URL')
    renderer.destroy()

    const invokeYoutube = <T>(action: string, payload?: unknown) => window.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('module:youtube:${action}', ${JSON.stringify(payload)})`) as Promise<T>
    const historyItems = await invokeYoutube<Array<{ id: string; options?: unknown }>>('history')
    assert.deepEqual(historyItems.map((item) => item.id), ['abc123'], 'Invalid history rows are ignored')
    assert.equal(historyItems[0].options, undefined, 'History list omits format details')
    const opened = await invokeYoutube<{ info: { options: unknown[] } }>('history-open', 'abc123')
    assert.equal(opened.info.options.length, 4)
    await assert.rejects(invokeYoutube('history-open', '../etc'))
    assert.deepEqual(await invokeYoutube('history-remove', 'abc123'), [])
    assert.deepEqual(await invokeYoutube('history'), [])

    const installed = await manager.installFromFile(packageFile)
    assert.equal(installed.id, 'hello-module')
    assert.equal(installed.enabled, false)
    await manager.setEnabled(installed.id, true)
    assert.equal(manager.list().find((module) => module.id === installed.id)?.enabled, true)
    assert.match(await manager.readUi(installed.id), /miniapp\.invoke/)

    const greeting = await window.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('module:hello-module:greet', 'Tester')") as { text: string; count: number }
    assert.equal(greeting.text, 'Hello, Tester!')
    assert.equal(greeting.count, 1)
    assert.equal(store.get('module-hello-module', 'greeting-count', 0), 1)
    await manager.setEnabled(installed.id, false)
    assert.equal(manager.list().find((module) => module.id === installed.id)?.enabled, false)
    await manager.remove(installed.id)
    assert.equal(manager.list().length, 1)
    assert.equal(store.get('module-hello-module', 'greeting-count', 0), 0)
    await manager.setEnabled('youtube', false)
    const restarted = new ModuleManager(store)
    restarted.registerBuiltIn(youtubeMainModule, { id: 'youtube', name: 'YouTube Downloader', version: '1.0.0', description: 'Download video or audio with yt-dlp.' })
    restarted.start()
    assert.equal(restarted.list().find((module) => module.id === 'youtube')?.enabled, false)
    window.destroy()
    console.log('Built-in sidebar and route, default and persisted disabled state; module install, action, disable, and delete passed')
  } finally {
    store.close()
    await rm(userData, { recursive: true, force: true })
    app.quit()
  }
}).catch((error) => { console.error(error); app.exit(1) })
