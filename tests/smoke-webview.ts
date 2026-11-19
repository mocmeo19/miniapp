import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { SettingsStore } from '../src/main/config/SettingsStore'
import { ModuleManager } from '../src/main/modules/ModuleManager'
import { webviewMainModule } from '../src/modules/webview/main'
import type { WebProfile, WebviewProfiles } from '../src/modules/webview/types'

const userData = mkdtempSync(join(tmpdir(), 'miniapp-webview-test-'))
app.setPath('userData', userData)

void app.whenReady().then(async () => {
  const store = new SettingsStore()
  const manager = new ModuleManager(store)
  const server = createServer((request, response) => {
    if (request.url === '/set') response.setHeader('Set-Cookie', 'profile-marker=first; Path=/')
    response.setHeader('Content-Type', 'text/html')
    response.end(`<html><head><title>Local test</title></head><body>${request.url}</body></html>`)
  })
  let window: BrowserWindow | null = null
  let passed = false
  try {
    manager.registerBuiltIn(webviewMainModule, { id: 'webview', name: 'Web Browser', version: '1.0.0', description: 'Browse websites with separate profiles.' })
    manager.start()
    assert.equal(manager.list()[0].enabled, true)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start test server')
    const url = `http://127.0.0.1:${address.port}`
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
    await window.loadURL('data:text/html,<html><body>webview test</body></html>')
    const invoke = <T>(action: string, payload?: unknown): Promise<T> => window!.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke('module:webview:${action}', ${JSON.stringify(payload)})`
    ) as Promise<T>

    const initial = await invoke<WebviewProfiles>('profiles')
    assert.equal(initial.profiles.length, 1)
    const first = initial.profiles[0]

    ipcMain.handle('module-manager:list', () => manager.list())
    ipcMain.handle('preferences:get-theme', () => null)
    ipcMain.handle('preferences:set-theme', () => undefined)
    const renderer = new BrowserWindow({
      show: false,
      webPreferences: { preload: join(process.cwd(), 'out/preload/index.js'), sandbox: true, contextIsolation: true }
    })
    await renderer.loadFile(join(process.cwd(), 'out/renderer/index.html'))
    const linkLoaded = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const link = document.querySelector('a[href="#/modules/webview"]')
        if (link || Date.now() > deadline) resolve(Boolean(link))
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(linkLoaded, true, 'Web Browser link should appear by default')
    await renderer.loadURL(`${renderer.webContents.getURL()}#/modules/webview`)
    const pageLoaded = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const input = document.querySelector('.webview-address input')
        if (input || Date.now() > deadline) resolve(Boolean(input))
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(pageLoaded, true, 'Web Browser page should render')
    renderer.destroy()

    const second = await invoke<WebProfile>('create-profile', 'Work')
    assert.notEqual(first.id, second.id)
    const bounds = { x: 0, y: 0, width: 400, height: 300 }
    await invoke('show', { profileId: first.id, bounds })
    await invoke('navigate', `${url}/set`)
    const firstSession = session.fromPartition(`persist:miniapp-webview-${first.id}`)
    assert.equal((await firstSession.cookies.get({ url })).find((cookie) => cookie.name === 'profile-marker')?.value, 'first')

    await invoke('show', { profileId: second.id, bounds })
    await invoke('navigate', `${url}/read`)
    const secondSession = session.fromPartition(`persist:miniapp-webview-${second.id}`)
    assert.equal((await secondSession.cookies.get({ url })).find((cookie) => cookie.name === 'profile-marker'), undefined)
    await assert.rejects(invoke('navigate', 'javascript:alert(1)'))

    await invoke('delete-profile', first.id)
    assert.equal((await firstSession.cookies.get({ url })).length, 0)
    assert.equal((await invoke<WebviewProfiles>('profiles')).profiles.length, 1)
    await manager.setEnabled('webview', false)
    await assert.rejects(invoke('profiles'))
    console.log('Webview profiles, isolated cookies, deletion, and module disable passed')
    passed = true
  } catch (error) {
    console.error(error)
  } finally {
    window?.destroy()
    server.close()
    server.closeAllConnections()
    store.close()
    setTimeout(() => { console.error('Electron did not quit after closing web views'); process.exit(1) }, 5000)
    if (passed) app.quit()
    else app.exit(1)
  }
}).catch((error) => { console.error(error); app.exit(1) })
