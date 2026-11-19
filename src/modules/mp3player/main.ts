import { BrowserWindow, dialog, protocol } from 'electron'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, sep } from 'node:path'
import type { MainModule } from '../core/main'
import { readModuleJson, writeModuleJson } from '../core/moduleData'
import { scanFolder, serveFile } from '../core/mediaFiles'
import type { Track, UrlDownloadEvent } from './types'
import { audioUrl, downloadAudio } from './urlDownload'

const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus'])
const mimeTypes: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg'
}
const maxTracks = 5000
const idPattern = /^[a-f\d]{16}$/

const idFor = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 16)
const isAudio = (path: string) => audioExtensions.has(extname(path).slice(1).toLowerCase())

export const mp3PlayerMainModule: MainModule = {
  id: 'mp3player',
  register({ handle, emit, settings, paths: dataPaths, notify }) {
    const downloads = () => dataPaths.data('downloads')
    // Playlists can exceed the 8 KB settings limit, so they live in a module data file (settings is the legacy fallback).
    const saved = readModuleJson<string[] | null>('mp3player', 'playlist', null) ?? settings.get<string[]>('playlist', [])
    // Only files in this playlist can be served through the miniapp-audio protocol.
    const paths = new Map<string, string>()
    for (const path of Array.isArray(saved) ? saved : []) {
      if (typeof path === 'string' && isAudio(path)) paths.set(idFor(path), path)
    }
    const persist = () => { void writeModuleJson('mp3player', 'playlist', [...paths.values()]).catch((error: unknown) => console.error('Could not save the playlist:', error)) }

    // Tags are cached per file until its modification time changes.
    const tagCache = new Map<string, { mtime: number; title: string | null; artist: string | null }>()

    async function readTags(path: string, mtime: number): Promise<{ title: string | null; artist: string | null }> {
      const cached = tagCache.get(path)
      if (cached?.mtime === mtime) return cached
      let tags = { title: null as string | null, artist: null as string | null }
      try {
        const { parseFile } = await import('music-metadata')
        const { common } = await parseFile(path, { skipCovers: true, duration: false })
        tags = { title: common.title?.trim() || null, artist: common.artist?.trim() || common.albumartist?.trim() || null }
      } catch { /* untagged or unreadable: fall back to the file name */ }
      tagCache.set(path, { mtime, ...tags })
      return tags
    }

    async function toTrack(id: string, path: string): Promise<Track | null> {
      try {
        const info = await stat(path)
        if (!info.isFile()) return null
        const extension = extname(path).slice(1).toLowerCase()
        const tags = await readTags(path, info.mtimeMs)
        const source = path.startsWith(downloads() + sep) ? 'download' : 'local'
        return { id, title: tags.title ?? basename(path, extname(path)), artist: tags.artist, extension, size: info.size, url: `miniapp-audio://track/${id}`, source }
      } catch { return null }
    }

    async function list(): Promise<Track[]> {
      const entries = [...paths]
      const tracks: (Track | null)[] = []
      for (let index = 0; index < entries.length; index += 8) {
        tracks.push(...await Promise.all(entries.slice(index, index + 8).map(([id, path]) => toTrack(id, path))))
      }
      return tracks.filter((track): track is Track => track !== null)
    }

    async function add(files: string[]): Promise<Track[]> {
      for (const path of files) {
        if (paths.size >= maxTracks) break
        if (isAudio(path)) paths.set(idFor(path), path)
      }
      persist()
      return list()
    }

    // Embedded cover art is read on demand and only the most recent few are kept in memory.
    const covers = new Map<string, { data: Uint8Array; format: string } | null>()
    const maxCovers = 40

    async function cover(id: string, path: string): Promise<{ data: Uint8Array; format: string } | null> {
      if (covers.has(id)) return covers.get(id) ?? null
      let found: { data: Uint8Array; format: string } | null = null
      try {
        const { parseFile, selectCover } = await import('music-metadata')
        const { common } = await parseFile(path, { duration: false })
        const picture = selectCover(common.picture)
        if (picture && /^image\/(jpeg|png|gif|webp)$/.test(picture.format)) found = { data: picture.data, format: picture.format }
      } catch { /* no readable artwork */ }
      covers.set(id, found)
      if (covers.size > maxCovers) covers.delete(covers.keys().next().value as string)
      return found
    }

    protocol.handle('miniapp-audio', async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const id = url.pathname.slice(1)
      if (url.hostname === 'cover') {
        const coverPath = idPattern.test(id) ? paths.get(id) : undefined
        const art = coverPath ? await cover(id, coverPath) : null
        if (!art) return new Response(null, { status: 404 })
        return new Response(Buffer.from(art.data), { headers: { 'Content-Type': art.format, 'Cache-Control': 'max-age=3600' } })
      }
      const path = url.hostname === 'track' && idPattern.test(id) ? paths.get(id) : undefined
      if (!path) return new Response(null, { status: 404 })
      return serveFile(request, path, mimeTypes[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream')
    })

    handle('list', () => list())
    handle('add-files', async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio', extensions: [...audioExtensions] }]
      }
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled ? list() : add(result.filePaths)
    })
    handle('add-folder', async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0] ? list() : add(await scanFolder(result.filePaths[0], isAudio, maxTracks))
    })
    handle('remove', (_event, payload) => {
      if (typeof payload !== 'string' || !idPattern.test(payload)) throw new Error('Invalid track')
      paths.delete(payload)
      persist()
      return list()
    })
    handle('clear', () => {
      paths.clear()
      persist()
      return []
    })

    // One link downloads at a time; progress goes to the window that asked.
    let job: { id: string; controller: AbortController } | null = null
    handle('download-url', (event, payload) => {
      const url = audioUrl(payload)
      if (job) throw new Error('A download is already running')
      const current = { id: randomUUID(), controller: new AbortController() }
      job = current
      const target = event.sender
      const report = (update: Omit<UrlDownloadEvent, 'jobId' | 'url'>) => emit(target, 'download', { jobId: current.id, url, ...update })
      report({ state: 'running', percent: 0 })
      void downloadAudio({ url, folder: downloads(), signal: current.controller.signal, onProgress: (percent) => report({ state: 'running', percent }) })
        .then(async (path) => {
          await add([path])
          report({ state: 'completed', percent: 100, title: basename(path, extname(path)) })
          notify({ title: 'Song added to MP3 Player', body: basename(path, extname(path)), kind: 'success', link: '/modules/mp3player' })
        })
        .catch((error: unknown) => {
          if (current.controller.signal.aborted) report({ state: 'cancelled', percent: 0 })
          else {
            const message = error instanceof Error ? error.message : String(error)
            report({ state: 'failed', percent: 0, error: message })
            notify({ title: 'Song download failed', body: message, kind: 'error', link: '/modules/mp3player' })
          }
        })
        .finally(() => { if (job === current) job = null })
      return { jobId: current.id }
    })
    handle('cancel-download', (_event, payload) => {
      if (!job || job.id !== payload) return false
      job.controller.abort()
      return true
    })

    return () => {
      job?.controller.abort()
      protocol.unhandle('miniapp-audio')
    }
  }
}
