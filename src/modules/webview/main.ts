import { BrowserWindow, session, WebContentsView, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { MainModule } from '../core/main'
import type { ScriptLogEntry, ScriptRun, WebProfile, WebScript, WebviewBounds, WebviewProfiles, WebviewState } from './types'
import { cleanScript, describeStep, exampleScript, isStopped, maxScripts, runStep, type RunControl } from './scripts'

const homeUrl = 'https://www.google.com/'
const maxProfiles = 20
type BrowserEntry = { view: WebContentsView; error: string | null }
type ActiveRun = { control: RunControl; run: ScriptRun }
type WindowBrowsers = { window: BrowserWindow; views: Map<string, BrowserEntry>; activeId: string | null; run: ActiveRun | null }
const maxLog = 300

function browserUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('Enter an address or search term')
  const input = value.trim()
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : input.includes(' ') || !input.includes('.')
    ? `https://www.google.com/search?q=${encodeURIComponent(input)}` : `https://${input}`
  let url: URL
  try { url = new URL(candidate) } catch { throw new Error('Invalid web address') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP and HTTPS pages are supported')
  return url.toString()
}

function validBounds(value: unknown, window: BrowserWindow): WebviewBounds {
  if (!value || typeof value !== 'object') throw new Error('Invalid browser area')
  const bounds = value as Partial<WebviewBounds>
  const numbers = [bounds.x, bounds.y, bounds.width, bounds.height]
  if (numbers.some((number) => typeof number !== 'number' || !Number.isFinite(number))) throw new Error('Invalid browser area')
  const { width, height } = window.getContentBounds()
  const x = Math.max(0, Math.floor(bounds.x!))
  const y = Math.max(0, Math.floor(bounds.y!))
  return {
    x, y,
    width: Math.max(0, Math.min(Math.floor(bounds.width!), width - x)),
    height: Math.max(0, Math.min(Math.floor(bounds.height!), height - y))
  }
}

export const webviewMainModule: MainModule = {
  id: 'webview',
  register({ handle, emit, settings }) {
    const saved = settings.get<WebProfile[]>('profiles', [])
    let profiles = Array.isArray(saved) ? saved.filter((profile) => profile && typeof profile.id === 'string' && /^[a-f\d-]{36}$/.test(profile.id) && typeof profile.name === 'string') : []
    if (profiles.length === 0) {
      profiles = [{ id: randomUUID(), name: 'Default' }]
      settings.set('profiles', profiles)
    }
    let activeProfileId = settings.get('active-profile-id', profiles[0].id)
    if (!profiles.some((profile) => profile.id === activeProfileId)) activeProfileId = profiles[0].id
    const windows = new Map<number, WindowBrowsers>()
    const lastUrls = settings.get<Record<string, string>>('last-urls', {})

    function requireProfile(value: unknown): WebProfile {
      const profile = profiles.find((item) => item.id === value)
      if (!profile) throw new Error('Profile not found')
      return profile
    }

    function owner(sender: WebContents): WindowBrowsers {
      const window = BrowserWindow.fromWebContents(sender)
      if (!window) throw new Error('Browser window is unavailable')
      let record = windows.get(sender.id)
      if (!record) {
        record = { window, views: new Map(), activeId: null, run: null }
        windows.set(sender.id, record)
        const cleanup = () => {
          if (record!.run) record!.run.control.stopped = true
          if (record!.activeId && !window.isDestroyed()) {
            const active = record!.views.get(record!.activeId)
            if (active) window.contentView.removeChildView(active.view)
          }
          for (const entry of record!.views.values()) if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
          record!.views.clear()
          record!.activeId = null
          windows.delete(sender.id)
        }
        window.once('close', cleanup)
        sender.once('destroyed', cleanup)
      }
      return record
    }

    function state(profileId: string, entry: BrowserEntry): WebviewState {
      const contents = entry.view.webContents
      return {
        profileId,
        url: contents.getURL() || lastUrls[profileId] || homeUrl,
        title: contents.getTitle() || 'New tab',
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        error: entry.error
      }
    }

    function publish(sender: WebContents, profileId: string, entry: BrowserEntry): void {
      if (!sender.isDestroyed()) emit(sender, 'state', state(profileId, entry))
    }

    function createEntry(sender: WebContents, profileId: string): BrowserEntry {
      const view = new WebContentsView({ webPreferences: {
        session: session.fromPartition(`persist:miniapp-webview-${profileId}`),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true
      } })
      const entry: BrowserEntry = { view, error: null }
      const contents = view.webContents
      const update = () => publish(sender, profileId, entry)
      const remember = () => {
        const url = contents.getURL()
        if (url.startsWith('http://') || url.startsWith('https://')) {
          lastUrls[profileId] = url
          settings.set('last-urls', lastUrls)
        }
        entry.error = null
        update()
      }
      contents.on('did-start-loading', update)
      contents.on('did-stop-loading', update)
      contents.on('page-title-updated', update)
      contents.on('did-navigate', remember)
      contents.on('did-navigate-in-page', remember)
      contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) { entry.error = description; update() }
      })
      contents.on('will-navigate', (event) => {
        try { browserUrl(event.url) } catch { event.preventDefault() }
      })
      contents.on('will-redirect', (event) => {
        try { browserUrl(event.url) } catch { event.preventDefault() }
      })
      contents.setWindowOpenHandler(({ url }) => {
        try { void contents.loadURL(browserUrl(url)).catch(() => undefined) } catch { /* blocked scheme */ }
        return { action: 'deny' }
      })
      void contents.loadURL(browserUrl(lastUrls[profileId] || homeUrl)).catch((error: unknown) => {
        entry.error = error instanceof Error ? error.message : String(error)
        update()
      })
      return entry
    }

    function current(sender: WebContents): { profileId: string; entry: BrowserEntry } {
      const record = owner(sender)
      const profileId = record.activeId
      const entry = profileId ? record.views.get(profileId) : undefined
      if (!profileId || !entry) throw new Error('Open the browser first')
      return { profileId, entry }
    }

    const savedScripts = settings.get<WebScript[] | null>('scripts', null)
    let scripts: WebScript[] = Array.isArray(savedScripts) ? savedScripts : [exampleScript()]
    if (!Array.isArray(savedScripts)) settings.set('scripts', scripts)

    handle('scripts', () => scripts)
    handle('save-script', (_event, value) => {
      const script = cleanScript(value)
      const exists = scripts.some((item) => item.id === script.id)
      if (!exists && scripts.length >= maxScripts) throw new Error('Script limit reached')
      scripts = exists ? scripts.map((item) => item.id === script.id ? script : item) : [...scripts, script]
      settings.set('scripts', scripts)
      return script
    })
    handle('delete-script', (_event, value) => {
      scripts = scripts.filter((item) => item.id !== value)
      settings.set('scripts', scripts)
      return scripts
    })
    handle('run-script', (event, value) => {
      const script = scripts.find((item) => item.id === value)
      if (!script) throw new Error('Script not found')
      const record = owner(event.sender)
      if (record.run?.run.status === 'running') throw new Error('Another script is still running')
      const { entry } = current(event.sender)
      const sender = event.sender
      const contents = entry.view.webContents
      const control: RunControl = { stopped: false }
      const run: ScriptRun = { runId: randomUUID(), scriptId: script.id, status: 'running', step: -1, round: 1, log: [] }
      record.run = { control, run }
      const send = () => { if (!sender.isDestroyed()) emit(sender, 'script-run', { ...run, log: [...run.log] }) }
      const log = (level: ScriptLogEntry['level'], message: string) => {
        run.log.push({ at: Date.now(), level, message })
        if (run.log.length > maxLog) run.log.splice(0, run.log.length - maxLog)
        send()
      }
      void (async () => {
        log('info', `Started “${script.name}”`)
        try {
          for (let round = 1; round <= script.repeat; round += 1) {
            run.round = round
            if (script.repeat > 1) log('info', `Round ${round} of ${script.repeat}`)
            for (const [index, step] of script.steps.entries()) {
              if (control.stopped) throw new Error('stopped')
              run.step = index
              log('info', `${index + 1}. ${describeStep(step)}`)
              await runStep(contents, step, control, log, browserUrl)
            }
          }
          run.status = 'done'
          run.step = -1
          log('success', 'Finished')
        } catch (error) {
          const stopped = control.stopped || isStopped(error)
          run.status = stopped ? 'stopped' : 'failed'
          log(stopped ? 'info' : 'error', stopped ? 'Stopped' : error instanceof Error ? error.message : String(error))
        }
      })()
      return { ...run }
    })
    handle('stop-script', (event) => {
      const active = owner(event.sender).run
      if (active?.run.status === 'running') active.control.stopped = true
    })
    handle('script-run', (event) => {
      const active = owner(event.sender).run
      return active ? { ...active.run, log: [...active.run.log] } : null
    })

    handle('profiles', (): WebviewProfiles => ({ profiles, activeProfileId }))
    handle('create-profile', (_event, value) => {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('Enter a profile name (1–40 characters)')
      if (profiles.length >= maxProfiles) throw new Error('Profile limit reached')
      const profile = { id: randomUUID(), name: value.trim() }
      profiles = [...profiles, profile]
      settings.set('profiles', profiles)
      return profile
    })
    handle('delete-profile', async (_event, value) => {
      const profile = requireProfile(value)
      if (profiles.length === 1) throw new Error('Keep at least one profile')
      for (const record of windows.values()) {
        const entry = record.views.get(profile.id)
        if (!entry) continue
        if (record.activeId === profile.id) {
          record.window.contentView.removeChildView(entry.view)
          record.activeId = null
        }
        if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
        record.views.delete(profile.id)
      }
      profiles = profiles.filter((item) => item.id !== profile.id)
      settings.set('profiles', profiles)
      if (activeProfileId === profile.id) {
        activeProfileId = profiles[0].id
        settings.set('active-profile-id', activeProfileId)
      }
      delete lastUrls[profile.id]
      settings.set('last-urls', lastUrls)
      const profileSession = session.fromPartition(`persist:miniapp-webview-${profile.id}`)
      await profileSession.clearData()
      return { profiles, activeProfileId } satisfies WebviewProfiles
    })
    handle('show', (event, value) => {
      const request = value as { profileId?: unknown; bounds?: unknown } | null
      const profile = requireProfile(request?.profileId)
      const record = owner(event.sender)
      const bounds = validBounds(request?.bounds, record.window)
      if (record.activeId && record.activeId !== profile.id) {
        const old = record.views.get(record.activeId)
        if (old) record.window.contentView.removeChildView(old.view)
      }
      let entry = record.views.get(profile.id)
      if (!entry) {
        entry = createEntry(event.sender, profile.id)
        record.views.set(profile.id, entry)
      }
      if (record.activeId !== profile.id) record.window.contentView.addChildView(entry.view)
      record.activeId = profile.id
      entry.view.setBounds(bounds)
      activeProfileId = profile.id
      settings.set('active-profile-id', activeProfileId)
      return state(profile.id, entry)
    })
    handle('resize', (event, value) => {
      const record = owner(event.sender)
      if (!record.activeId) return
      record.views.get(record.activeId)?.view.setBounds(validBounds(value, record.window))
    })
    handle('hide', (event, value) => {
      const record = owner(event.sender)
      if (!record.activeId || record.activeId !== value) return
      const entry = record.views.get(record.activeId)
      if (entry) record.window.contentView.removeChildView(entry.view)
      record.activeId = null
    })
    handle('navigate', async (event, value) => {
      const { entry } = current(event.sender)
      entry.error = null
      await entry.view.webContents.loadURL(browserUrl(value))
    })
    handle('back', (event) => { const { entry } = current(event.sender); if (entry.view.webContents.navigationHistory.canGoBack()) entry.view.webContents.navigationHistory.goBack() })
    handle('forward', (event) => { const { entry } = current(event.sender); if (entry.view.webContents.navigationHistory.canGoForward()) entry.view.webContents.navigationHistory.goForward() })
    handle('reload', (event) => { current(event.sender).entry.view.webContents.reload() })
    handle('stop', (event) => { current(event.sender).entry.view.webContents.stop() })
    handle('home', async (event) => { await current(event.sender).entry.view.webContents.loadURL(homeUrl) })

    return () => {
      for (const record of windows.values()) {
        if (record.run) record.run.control.stopped = true
        if (record.activeId) {
          const active = record.views.get(record.activeId)
          if (active) record.window.contentView.removeChildView(active.view)
        }
        for (const entry of record.views.values()) if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
        record.views.clear()
        record.activeId = null
      }
      windows.clear()
    }
  }
}
