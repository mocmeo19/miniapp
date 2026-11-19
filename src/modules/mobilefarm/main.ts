import { app, BrowserWindow, nativeImage, shell, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { binaryPath } from '../core/binaries'
import { moveMatchingFiles } from '../core/files'
import type { MainModule } from '../core/main'
import { parseInfo } from './info'
import { ScrcpySession } from './stream'
import { wallCapacity, wallColumns, wallRows, type FarmDevice, type FarmStatus, type MirrorOptions, type VideoMessage, type WallDevice } from './types'

const serialPattern = /^[\w.:-]{1,100}$/
// Name used for screenshots saved to Downloads by earlier versions: screenshot-<serial>-<epoch ms>.png
const legacyScreenshot = /^screenshot-[\w-]{1,40}-\d{13}\.png$/
const addressPattern = /^[\w.-]{1,100}(:\d{1,5})?$/
const keyEvents: Record<string, number> = { back: 4, home: 3, recents: 187, power: 26, 'volume-up': 24, 'volume-down': 25, mute: 164 }
// Wall tiles are small, so a modest stream keeps every device light on CPU and USB.
const defaults: MirrorOptions = { maxSize: 640, bitrate: 2, maxFps: 30, viewOnly: false, stayAwake: true }

function bundledDirectory(): string { return binaryPath('scrcpy') }

// GUI apps on macOS do not inherit the shell PATH, so look in the usual install locations too.
function findAdb(): string | null {
  const file = process.platform === 'win32' ? 'adb.exe' : 'adb'
  // setup:scrcpy unpacks the release (adb, scrcpy-server, VERSION) into resources/bin/scrcpy/.
  const bundled = join(bundledDirectory(), file)
  if (existsSync(bundled)) return bundled
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  const directories = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
    ...(sdk ? [join(sdk, 'platform-tools')] : []),
    join(homedir(), 'Library/Android/sdk/platform-tools'),
    join(homedir(), 'Android/Sdk/platform-tools'),
    join(homedir(), 'AppData/Local/Android/Sdk/platform-tools')
  ].filter(Boolean)
  return directories.map((directory) => join(directory, file)).find(existsSync) ?? null
}

// The jar must be started with its exact version string, so both come from the same bundle.
function findServer(): { jar: string; version: string } | null {
  const jar = join(bundledDirectory(), 'scrcpy-server')
  const versionFile = join(bundledDirectory(), 'VERSION')
  if (!existsSync(jar) || !existsSync(versionFile)) return null
  const version = readFileSync(versionFile, 'utf8').trim()
  return /^\d+(\.\d+)*$/.test(version) ? { jar, version } : null
}

function run(file: string, args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).toString().trim()))
      else resolve(stdout.toString())
    })
  })
}

function screencap(adb: string, serial: string): Promise<Buffer> {
  return new Promise((resolve, reject) => execFile(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', timeout: 15000, maxBuffer: 64 * 1024 * 1024 },
    (error, stdout) => error ? reject(error) : resolve(stdout)))
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

function sanitizeOptions(value: unknown): MirrorOptions {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof MirrorOptions, unknown>>
  const flag = (key: 'viewOnly' | 'stayAwake') => typeof raw[key] === 'boolean' ? raw[key] as boolean : defaults[key]
  return {
    maxSize: clampInt(raw.maxSize, 240, 2048, defaults.maxSize),
    bitrate: clampInt(raw.bitrate, 1, 50, defaults.bitrate),
    maxFps: clampInt(raw.maxFps, 1, 60, defaults.maxFps),
    viewOnly: flag('viewOnly'), stayAwake: flag('stayAwake')
  }
}

function serialOf(value: unknown): string {
  if (typeof value !== 'string' || !serialPattern.test(value)) throw new Error('Invalid device serial')
  return value
}

export const mobileFarmMainModule: MainModule = {
  id: 'mobilefarm',
  register({ handle, emit, settings, paths }) {
    // One-time move of screenshots saved before they lived in <data-dir>/mobilefarm/screenshots.
    const screenshots = paths.data('screenshots')
    void Promise.all([
      moveMatchingFiles(join(dirname(paths.data()), 'Screenshots'), (name) => name.toLowerCase().endsWith('.png'), () => screenshots),
      moveMatchingFiles(app.getPath('downloads'), (name) => legacyScreenshot.test(name), () => screenshots)
    ]).then((results) => {
      const moved = results.reduce((sum, result) => sum + result.moved.length, 0)
      if (moved) console.log(`Moved ${moved} earlier screenshot(s) into ${screenshots}`)
    })
    const sessions = new Map<string, ScrcpySession>()
    const wallDevices = new Map<string, WallDevice>()
    const screens = new Map<string, { width: number; height: number }>()
    let wall: BrowserWindow | null = null
    let options = sanitizeOptions(settings.get('options', defaults))

    function requireAdb(): string {
      const path = findAdb()
      if (!path) throw new Error('adb was not found. Run "npm run setup:media" or install Android platform-tools, then restart the app.')
      return path
    }

    async function listDevices(): Promise<FarmDevice[]> {
      const adb = findAdb()
      if (!adb) return []
      const output = await run(adb, ['devices', '-l']).catch(() => '')
      return output.split('\n').slice(1).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length >= 2 && parts[0]).map((parts) => ({
        serial: parts[0],
        state: parts[1],
        model: (parts.find((part) => part.startsWith('model:')) ?? '').slice(6).replaceAll('_', ' '),
        mirroring: wallDevices.has(parts[0])
      }))
    }

    async function status(): Promise<FarmStatus> {
      return { adb: findAdb(), server: findServer()?.jar ?? null, devices: await listDevices(), options }
    }

    const wallContents = (): WebContents | null => wall && !wall.isDestroyed() ? wall.webContents : null
    const sendVideo = (message: VideoMessage) => { const target = wallContents(); if (target) emit(target, 'video', message) }
    const publishWall = () => { const target = wallContents(); if (target) emit(target, 'devices', [...wallDevices.values()]) }

    function openWall(): void {
      if (wall && !wall.isDestroyed()) { if (wall.isMinimized()) wall.restore(); wall.focus(); return }
      const window = new BrowserWindow({
        width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#101014', title: 'Mobile Farm — Mirror wall',
        webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      wall = window
      window.setMenuBarVisibility(false)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault() })
      window.once('closed', () => {
        if (wall === window) wall = null
        for (const session of sessions.values()) session.stop()
        sessions.clear()
        wallDevices.clear()
        screens.clear()
      })
      if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/mobilefarm-wall`)
      else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/mobilefarm-wall' })
    }

    function addToWall(devices: FarmDevice[]): void {
      const fresh = devices.filter((device) => device.state === 'device' && !wallDevices.has(device.serial))
      if (wallDevices.size + fresh.length > wallCapacity) throw new Error(`The mirror wall shows at most ${wallCapacity} devices (${wallColumns} × ${wallRows})`)
      for (const device of fresh) wallDevices.set(device.serial, { serial: device.serial, model: device.model })
      openWall()
      publishWall()
    }

    function removeFromWall(serial: string): void {
      sessions.get(serial)?.stop()
      sessions.delete(serial)
      screens.delete(serial)
      wallDevices.delete(serial)
      publishWall()
    }

    // Streams start when a tile attaches, so no packet is sent before its decoder exists.
    async function attach(serial: string): Promise<void> {
      if (!wallDevices.has(serial) || sessions.has(serial)) return
      const server = findServer()
      if (!server) { sendVideo({ serial, kind: 'closed', reason: 'scrcpy-server was not found. Run "npm run setup:media".' }); return }
      const session = new ScrcpySession(requireAdb(), server.jar, server.version, serial, options, {
        session: (width, height) => { screens.set(serial, { width, height }); sendVideo({ serial, kind: 'session', width, height }) },
        config: (data) => sendVideo({ serial, kind: 'config', data }),
        frame: (data, key, pts) => sendVideo({ serial, kind: 'frame', data, key, pts }),
        closed: (reason) => { if (sessions.get(serial) === session) sessions.delete(serial); sendVideo({ serial, kind: 'closed', reason }) }
      })
      sessions.set(serial, session)
      try { await session.start() }
      catch (error) {
        if (sessions.get(serial) === session) sessions.delete(serial)
        sendVideo({ serial, kind: 'closed', reason: error instanceof Error ? error.message : String(error) })
      }
    }

    async function performAction(serial: string, action: string): Promise<void> {
      const adb = requireAdb()
      const shellRun = (...args: string[]) => run(adb, ['-s', serial, 'shell', ...args])
      if (action in keyEvents) {
        const session = sessions.get(serial)
        if (session) session.key(keyEvents[action])
        else await shellRun('input', 'keyevent', String(keyEvents[action]))
      } else if (action === 'notifications') await shellRun('cmd', 'statusbar', 'expand-notifications')
      else if (action === 'rotate') {
        const current = Number((await shellRun('settings', 'get', 'system', 'user_rotation')).trim()) || 0
        await shellRun('settings', 'put', 'system', 'accelerometer_rotation', '0')
        await shellRun('settings', 'put', 'system', 'user_rotation', String((current + 1) % 4))
      } else if (action === 'screenshot') {
        const file = join(paths.data('screenshots'), `screenshot-${serial.replace(/[^\w-]/g, '_').slice(0, 40)}-${Date.now()}.png`)
        await writeFile(file, await screencap(adb, serial))
        shell.showItemInFolder(file)
      } else throw new Error('Unknown action')
    }

    handle('status', () => status())
    handle('set-options', (_event, value) => {
      options = sanitizeOptions(value)
      settings.set('options', options)
      return options
    })
    handle('start', async (_event, value) => {
      const serial = serialOf(value)
      const device = (await listDevices()).find((item) => item.serial === serial)
      if (!device || device.state !== 'device') throw new Error('Device is not ready (check USB debugging authorization)')
      addToWall([device])
      return status()
    })
    handle('start-all', async () => {
      addToWall(await listDevices())
      return status()
    })
    handle('stop', async (_event, value) => { removeFromWall(serialOf(value)); return status() })
    handle('stop-all', async () => { [...wallDevices.keys()].forEach(removeFromWall); return status() })

    // Mirror wall window API.
    handle('wall-devices', () => [...wallDevices.values()])
    handle('wall-attach', (_event, value) => attach(serialOf(value)))
    // Wi-Fi devices drop off adb when the link breaks, so they are reconnected before streaming again.
    handle('wall-reconnect', async (_event, value) => {
      const serial = serialOf(value)
      sessions.get(serial)?.stop()
      sessions.delete(serial)
      if (/^[\w.-]+:\d{1,5}$/.test(serial)) await run(requireAdb(), ['connect', serial], 15000).catch(() => undefined)
      await attach(serial)
    })
    handle('wall-remove', (_event, value) => removeFromWall(serialOf(value)))
    handle('wall-touch', (_event, value) => {
      const request = (value && typeof value === 'object' ? value : {}) as { serial?: unknown; action?: unknown; x?: unknown; y?: unknown }
      const screen = screens.get(serialOf(request.serial))
      const action = request.action
      if (!screen || (action !== 0 && action !== 1 && action !== 2) || typeof request.x !== 'number' || typeof request.y !== 'number') return
      const clamp = (n: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(n)))
      sessions.get(request.serial as string)?.touch(action, clamp(request.x, screen.width), clamp(request.y, screen.height), screen.width, screen.height)
    })
    handle('action', async (_event, value) => {
      const request = (value && typeof value === 'object' ? value : {}) as { serial?: unknown; action?: unknown }
      await performAction(serialOf(request.serial), typeof request.action === 'string' ? request.action : '')
      return status()
    })

    // Small JPEG of the current screen, resized here so the renderer never receives a full-resolution PNG.
    handle('thumbnail', async (_event, value) => {
      const image = nativeImage.createFromBuffer(await screencap(requireAdb(), serialOf(value)))
      if (image.isEmpty()) throw new Error('Could not capture the screen')
      const scaled = image.getSize().width > 240 ? image.resize({ width: 240, quality: 'good' }) : image
      return `data:image/jpeg;base64,${scaled.toJPEG(70).toString('base64')}`
    })
    handle('info', async (_event, value) => {
      const script = 'getprop; echo @@@; dumpsys battery; echo @@@; wm size; wm density; echo @@@; head -3 /proc/meminfo; echo @@@; df -k /data; echo @@@; ip addr show wlan0'
      return parseInfo(await run(requireAdb(), ['-s', serialOf(value), 'shell', script], 20000))
    })
    handle('connect', async (_event, value) => {
      if (typeof value !== 'string' || !addressPattern.test(value.trim())) throw new Error('Enter an address like 192.168.1.20:5555')
      const address = value.trim().includes(':') ? value.trim() : `${value.trim()}:5555`
      const output = await run(requireAdb(), ['connect', address], 15000)
      if (/failed|cannot|unable/i.test(output)) throw new Error(output.trim())
      return status()
    })
    handle('disconnect', async (_event, value) => {
      const serial = serialOf(value)
      removeFromWall(serial)
      if (serial.includes(':')) await run(requireAdb(), ['disconnect', serial]).catch(() => undefined)
      return status()
    })

    const closeAll = () => {
      for (const session of sessions.values()) session.stop()
      sessions.clear()
      wallDevices.clear()
      if (wall && !wall.isDestroyed()) wall.destroy()
    }
    app.once('before-quit', closeAll)
    return closeAll
  }
}
