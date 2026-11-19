import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { createReadStream } from 'node:fs'
import { opendir, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { binaryPath } from '../../modules/core/binaries'
import { LibraryStore, type ScannedFile } from './LibraryStore'
import { imageDimensions, unreadable, videoDimensions } from './mediaDimensions'
import { VideoDimensionQueue } from './VideoDimensionQueue'
import { AutoTagger } from './tagging/AutoTagger'
import type { ModelFetcher } from './tagging/modelFiles'
import { AutoTagStore } from './tagging/AutoTagStore'
import type { AutoTagStatus, LibraryFolder, LibraryQuery, LibraryScanEvent } from '../../library/types'
import type { NotificationInput } from '../../notifications/types'

// registerSchemesAsPrivileged may only be called once, so every custom scheme is declared here.
protocol.registerSchemesAsPrivileged([
  { scheme: 'miniapp-library', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'miniapp-audio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'miniapp-video', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'miniapp-subaudio', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'miniapp-notes', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'])
const videoExtensions = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'])
const mediaTypes: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo'
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Invalid Library item')
  return value
}

function checkedQuery(value: unknown): LibraryQuery {
  if (!value || typeof value !== 'object') return {}
  const input = value as LibraryQuery
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) throw new Error('Search is too long')
  if (input.folderId !== undefined) requireId(input.folderId)
  if (input.kind !== undefined && input.kind !== 'image' && input.kind !== 'video') throw new Error('Invalid media type')
  if (input.tag !== undefined && (typeof input.tag !== 'string' || input.tag.length > 40)) throw new Error('Invalid tag')
  if (input.directory !== undefined && (typeof input.directory !== 'string' || input.directory.length > 1024
    || input.directory.startsWith('/') || input.directory.split('/').some((part) => part === '..' || part === '.'))) throw new Error('Invalid folder')
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw new Error('Invalid page')
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1)) throw new Error('Invalid page size')
  return input
}

async function checkedPath(path: string, folderPath: string): Promise<string> {
  const [resolved, root] = await Promise.all([realpath(path), realpath(folderPath)])
  if (!resolved.startsWith(root + sep)) throw new Error('File is outside its Library folder')
  if (!(await stat(resolved)).isFile()) throw new Error('File is unavailable')
  return resolved
}

export function startLibrary(
  databasePath: string,
  modelsDirectory: () => string = () => join(app.getPath('userData'), 'models'),
  legacyModelDirectories: () => string[] = () => [],
  fetchModel?: ModelFetcher,
  notify: (input: NotificationInput) => void = () => undefined
): () => void {
    const store = new LibraryStore(databasePath)
    const scans = new Map<string, Promise<LibraryScanEvent>>()
    const channels: string[] = []
    let disposed = false
    const handle = (action: string, callback: (event: IpcMainInvokeEvent, payload: unknown) => unknown) => {
      const channel = `library:${action}`
      ipcMain.handle(channel, (event, payload: unknown) => {
        if (event.sender.isDestroyed() || !event.sender.getURL()) throw new Error('Invalid Library request')
        return callback(event, payload)
      })
      channels.push(channel)
    }
    const emit = (target: WebContents, event: string, payload: unknown) => {
      if (!target.isDestroyed()) target.send(`library:${event}`, payload)
    }
    const broadcast = (event: string, payload: unknown) => {
      for (const window of BrowserWindow.getAllWindows()) emit(window.webContents, event, payload)
    }
    const autoTagStore = new AutoTagStore(store.connection)
    let lastPhase: AutoTagStatus['phase'] = 'idle'
    let lastDone = 0
    const tagger = new AutoTagger(autoTagStore, modelsDirectory, checkedPath, (status) => {
      broadcast('auto-tag', status)
      if (lastPhase === 'tagging' && status.phase === 'idle' && lastDone > 0) {
        notify({ title: 'Auto-tag finished', body: `${lastDone.toLocaleString()} photo${lastDone === 1 ? '' : 's'} tagged`, kind: 'success', link: '/library' })
      }
      if (lastPhase !== 'error' && status.phase === 'error') notify({ title: 'Auto-tagging stopped', body: status.error, kind: 'error', link: '/library' })
      lastPhase = status.phase
      if (status.phase === 'tagging') lastDone = status.done
    }, legacyModelDirectories, fetchModel)
    const videoSizes = new VideoDimensionQueue(store,
      async (path, folderPath) => videoDimensions(binaryPath('ffmpeg'), await checkedPath(path, folderPath)).catch(() => unreadable),
      () => broadcast('dimensions', null))

    protocol.handle('miniapp-library', async (request) => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
        const url = new URL(request.url)
        if (url.hostname !== 'media') return new Response(null, { status: 404 })
        const file = store.file(requireId(url.pathname.slice(1)))
        if (!file) return new Response(null, { status: 404 })
        const path = await checkedPath(file.path, file.folderPath)
        const size = (await stat(path)).size
        let start = 0
        let end = Math.max(0, size - 1)
        let status = 200
        const range = request.headers.get('range')
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)
          if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
          if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
          else { const suffix = Number(match[2]); start = Math.max(0, size - suffix); end = size - 1 }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
          }
          status = 206
        }
        const headers = new Headers({
          'Content-Type': mediaTypes[file.extension] ?? 'application/octet-stream',
          'Content-Length': String(size === 0 ? 0 : end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=60',
          'X-Content-Type-Options': 'nosniff'
        })
        if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
        if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
        const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>
        return new Response(body, { status, headers })
      } catch { return new Response(null, { status: 404 }) }
    })

    async function scanFolder(folder: LibraryFolder, target: Electron.WebContents): Promise<LibraryScanEvent> {
      const running = scans.get(folder.id)
      if (running) return running
      const task = (async () => {
        const scanId = randomUUID()
        const result: LibraryScanEvent = { folderId: folder.id, state: 'started', indexed: 0, skipped: 0 }
        const publish = () => emit(target, 'scan', { ...result })
        const known = store.knownFiles(folder.id)
        const batch: ScannedFile[] = []
        const flush = () => { if (batch.length) { store.upsertBatch(folder, scanId, batch); batch.length = 0 } }
        publish()
        try {
          const directories = [folder.path]
          while (directories.length) {
            if (disposed) throw new Error('Library is closing')
            const directory = directories.pop()!
            let listing
            try { listing = await opendir(directory) }
            catch { result.skipped++; continue }
            for await (const entry of listing) {
              if (disposed) throw new Error('Library is closing')
              const path = join(directory, entry.name)
              if (entry.isSymbolicLink()) continue
              if (entry.isDirectory()) { directories.push(path); continue }
              if (!entry.isFile()) continue
              const extension = extname(entry.name).slice(1).toLowerCase()
              const kind = imageExtensions.has(extension) ? 'image' : videoExtensions.has(extension) ? 'video' : null
              if (!kind) continue
              try {
                const details = await stat(path)
                if (!details.isFile()) continue
                const file: ScannedFile = { path, name: entry.name, kind, size: details.size, modifiedAt: Math.trunc(details.mtimeMs) }
                const previous = known.get(path)
                const sizeKnown = previous && previous.width !== null && previous.size === file.size && previous.modifiedAt === file.modifiedAt
                if (kind === 'image' && !sizeKnown) Object.assign(file, await imageDimensions(path))
                batch.push(file)
                result.indexed++
              } catch { result.skipped++; continue }
              if (batch.length >= 250) flush()
              if (result.indexed % 50 === 0) { result.state = 'progress'; publish() }
            }
          }
          flush()
          if (result.skipped === 0) store.finishScan(folder.id, scanId)
          result.state = 'completed'
          publish()
          notify({ title: 'Library updated', body: `${basename(folder.path)} · ${result.indexed.toLocaleString()} files${result.skipped ? ` · ${result.skipped} skipped` : ''}`, kind: result.skipped ? 'warning' : 'success', link: '/library' })
          tagger.start()
          videoSizes.start()
          return result
        } catch (error) {
          result.state = 'failed'
          result.error = error instanceof Error ? error.message : String(error)
          publish()
          if (!disposed) notify({ title: 'Library scan failed', body: `${basename(folder.path)}: ${result.error}`, kind: 'error', link: '/library' })
          throw error
        }
      })()
      scans.set(folder.id, task)
      try { return await task } finally { scans.delete(folder.id) }
    }

    handle('folders', () => store.folders())
    handle('files', (_event, query) => store.search(checkedQuery(query)))
    handle('subfolders', (_event, query) => {
      const checked = checkedQuery(query)
      return store.subfolders({ folderId: requireId(checked.folderId), directory: checked.directory ?? '' })
    })
    handle('add-folders', async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = { title: 'Add folders to Library', properties: ['openDirectory', 'multiSelections'] }
      const choice = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      if (choice.canceled) return []
      const added: LibraryFolder[] = []
      for (const selected of [...choice.filePaths].sort((a, b) => a.length - b.length)) {
        const path = await realpath(selected)
        if (!(await stat(path)).isDirectory()) continue
        try { added.push(store.addFolder(path)) }
        catch (error) { if (!(error instanceof Error) || !error.message.includes('overlaps')) throw error }
      }
      return added
    })
    handle('remove-folder', (_event, value) => {
      const id = requireId(value)
      if (scans.has(id)) throw new Error('Wait for indexing to finish')
      store.removeFolder(id)
    })
    handle('scan', async (event, value) => {
      const selected = value === 'all' ? store.folders() : [store.folder(requireId(value))].filter((item): item is LibraryFolder => !!item)
      if (selected.length === 0) throw new Error('Folder not found')
      const results: LibraryScanEvent[] = []
      for (const folder of selected) results.push(await scanFolder(folder, event.sender))
      return results
    })
    handle('set-tags', (_event, value) => {
      const input = value as { id?: unknown; tags?: unknown } | null
      const id = requireId(input?.id)
      if (!Array.isArray(input?.tags) || input.tags.length > 20 || input.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)) throw new Error('Use up to 20 tags of 1–40 characters')
      const tags = [...new Set(input.tags.map((tag: string) => tag.trim()))]
      store.setTags(id, tags)
    })
    handle('auto-tag-status', () => tagger.current())
    handle('set-auto-tag', (_event, value) => {
      if (typeof value !== 'boolean') throw new Error('Invalid auto-tag setting')
      return tagger.setEnabled(value)
    })
    handle('clear-auto-tags', () => tagger.clear())
    handle('auto-tag-models', () => tagger.models())
    handle('set-auto-tag-models', (_event, value) => {
      if (!Array.isArray(value) || value.length === 0 || value.length > 10 || value.some((id) => typeof id !== 'string')) throw new Error('Choose at least one model')
      return tagger.setModels(value as string[])
    })
    handle('auto-tag-files', (_event, value) => {
      if (!Array.isArray(value) || value.length === 0 || value.length > 500) throw new Error('Choose up to 500 files')
      const images = autoTagStore.imagesById(value.map(requireId))
      if (images.length === 0) throw new Error('Only photos can be auto-tagged')
      return tagger.tagNow(images)
    })
    handle('auto-tag-folder', (_event, value) => {
      const query = checkedQuery(value)
      const images = autoTagStore.imagesIn(requireId(query.folderId), query.directory ?? '')
      if (images.length === 0) throw new Error('This folder has no photos')
      return tagger.tagNow(images)
    })
    handle('reveal', async (_event, value) => {
      const file = store.file(requireId(value))
      if (!file) throw new Error('File not found')
      shell.showItemInFolder(await checkedPath(file.path, file.folderPath))
    })
    handle('open', async (_event, value) => {
      const file = store.file(requireId(value))
      if (!file) throw new Error('File not found')
      const error = await shell.openPath(await checkedPath(file.path, file.folderPath))
      if (error) throw new Error(error)
    })
    handle('delete', async (_event, value) => {
      const file = store.file(requireId(value))
      if (!file) throw new Error('File not found')
      if (scans.has(file.folder_id)) throw new Error('Wait for indexing to finish')
      await shell.trashItem(await checkedPath(file.path, file.folderPath))
      store.removeFile(file.id)
    })

    tagger.start()
    videoSizes.start()

    return () => {
      disposed = true
      channels.forEach((channel) => ipcMain.removeHandler(channel))
      protocol.unhandle('miniapp-library')
      void Promise.allSettled([...scans.values(), tagger.dispose(), videoSizes.dispose()]).then(() => store.close())
    }
}
