import { app, BrowserWindow, dialog, protocol } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { binaryPath } from '../core/binaries'
import type { MainModule } from '../core/main'
import { readModuleJson, writeModuleJson } from '../core/moduleData'
import { scanFolder, serveFile } from '../core/mediaFiles'
import type { VideoItem } from './types'

const mimeTypes: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg'
}
const maxVideos = 5000
const idPattern = /^[a-f\d]{16}$/

// Runs ffmpeg to grab one frame; `seek` is tried first so the frame isn't a black intro.
function extractFrame(video: string, output: string, seek: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath('ffmpeg'), ['-v', 'error', '-ss', String(seek), '-i', video, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', '-y', output], { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => child.kill(), 20000)
    child.once('error', () => { clearTimeout(timer); resolve(false) })
    child.once('close', async (code) => {
      clearTimeout(timer)
      resolve(code === 0 && (await stat(output).then((info) => info.size > 0).catch(() => false)))
    })
  })
}

const idFor = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 16)
const isVideo = (path: string) => extname(path).slice(1).toLowerCase() in mimeTypes

export const videoPlayerMainModule: MainModule = {
  id: 'videoplayer',
  register({ handle, settings }) {
    // Playlists can exceed the 8 KB settings limit, so they live in a module data file (settings is the legacy fallback).
    const saved = readModuleJson<string[] | null>('videoplayer', 'playlist', null) ?? settings.get<string[]>('playlist', [])
    // Only files in this playlist can be served through the miniapp-video protocol.
    const paths = new Map<string, string>()
    for (const path of Array.isArray(saved) ? saved : []) {
      if (typeof path === 'string' && isVideo(path)) paths.set(idFor(path), path)
    }
    const persist = () => { void writeModuleJson('videoplayer', 'playlist', [...paths.values()]).catch((error: unknown) => console.error('Could not save the playlist:', error)) }

    async function list(): Promise<VideoItem[]> {
      const items = await Promise.all([...paths].map(async ([id, path]): Promise<VideoItem | null> => {
        try {
          const info = await stat(path)
          if (!info.isFile()) return null
          return { id, title: basename(path, extname(path)), extension: extname(path).slice(1).toLowerCase(), size: info.size, url: `miniapp-video://video/${id}` }
        } catch { return null }
      }))
      return items.filter((item): item is VideoItem => item !== null)
    }

    async function add(files: string[]): Promise<VideoItem[]> {
      for (const path of files) {
        if (paths.size >= maxVideos) break
        if (isVideo(path)) paths.set(idFor(path), path)
      }
      persist()
      return list()
    }

    // Thumbnails are cached on disk per file version, generated two at a time, and shared between concurrent requests.
    const thumbnailDirectory = join(app.getPath('userData'), 'video-thumbs')
    const pending = new Map<string, Promise<string | null>>()
    const queue: (() => void)[] = []
    let running = 0
    const schedule = <T,>(task: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const start = () => {
        running += 1
        task().then(resolve, reject).finally(() => { running -= 1; queue.shift()?.() })
      }
      if (running < 2) start()
      else queue.push(start)
    })

    function thumbnail(id: string, path: string): Promise<string | null> {
      const existing = pending.get(id)
      if (existing) return existing
      const job = (async () => {
        const info = await stat(path)
        await mkdir(thumbnailDirectory, { recursive: true })
        const output = join(thumbnailDirectory, `${id}-${Math.floor(info.mtimeMs)}.jpg`)
        if (await stat(output).then((cached) => cached.size > 0).catch(() => false)) return output
        return await schedule(async () => (await extractFrame(path, output, 5)) || (await extractFrame(path, output, 0)) ? output : null)
      })().catch(() => null).finally(() => { pending.delete(id) })
      pending.set(id, job)
      return job
    }

    protocol.handle('miniapp-video', async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const id = url.pathname.slice(1)
      if (url.hostname === 'thumb') {
        const source = idPattern.test(id) ? paths.get(id) : undefined
        const file = source ? await thumbnail(id, source) : null
        if (!file) return new Response(null, { status: 404 })
        return new Response(await readFile(file), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' } })
      }
      const path = url.hostname === 'video' && idPattern.test(id) ? paths.get(id) : undefined
      if (!path) return new Response(null, { status: 404 })
      return serveFile(request, path, mimeTypes[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream')
    })

    handle('list', () => list())
    handle('add-files', async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Video', extensions: Object.keys(mimeTypes) }]
      }
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? list() : add(result.filePaths)
    })
    handle('add-folder', async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0] ? list() : add(await scanFolder(result.filePaths[0], isVideo, maxVideos))
    })
    handle('remove', (_event, payload) => {
      if (typeof payload !== 'string' || !idPattern.test(payload)) throw new Error('Invalid video')
      paths.delete(payload)
      persist()
      return list()
    })
    handle('clear', () => {
      paths.clear()
      persist()
      return []
    })

    return () => { protocol.unhandle('miniapp-video') }
  }
}
