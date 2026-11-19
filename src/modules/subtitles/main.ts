import { app, BrowserWindow, dialog, protocol } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { MainModule } from '../core/main'
import { readModuleJson, writeModuleJson } from '../core/moduleData'
import { serveFile } from '../core/mediaFiles'
import type { AudioInfo, Doc, OpenedFile } from './types'

const maxReadBytes = 10 * 1024 * 1024
const maxWriteBytes = 30 * 1024 * 1024
// Audio (or the audio track of a video) that exercise segments can be previewed from.
const audioTypes: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm'
}
const audioType = (path: string) => audioTypes[extname(path).slice(1).toLowerCase()]
const exportTypes = { json: 'JSON', csv: 'CSV' } as const

const isDoc = (value: unknown): value is Doc => {
  const doc = value as Partial<Doc> | null
  return !!doc && typeof doc === 'object' && typeof doc.name === 'string' && Array.isArray(doc.enCues) && Array.isArray(doc.viCues) && Array.isArray(doc.items)
}

export const subtitlesMainModule: MainModule = {
  id: 'subtitles',
  register({ handle, settings }) {
    const owner = (sender: Electron.WebContents) => BrowserWindow.fromWebContents(sender)

    // Only the one attached file is ever served, through miniapp-subaudio://media/current.
    const savedAudio = settings.get<unknown>('audio-path', null)
    let audioPath: string | null = typeof savedAudio === 'string' && audioType(savedAudio) ? savedAudio : null

    async function audioInfo(): Promise<AudioInfo | null> {
      if (!audioPath) return null
      const info = await stat(audioPath).catch(() => null)
      return info?.isFile() ? { name: basename(audioPath) } : null
    }

    async function useAudio(path: unknown): Promise<AudioInfo | null> {
      if (typeof path !== 'string' || !audioType(path)) throw new Error('Định dạng âm thanh không được hỗ trợ (mp3, m4a, aac, wav, flac, ogg, opus, mp4, webm).')
      if (!(await stat(path).catch(() => null))?.isFile()) throw new Error('Không tìm thấy file âm thanh.')
      audioPath = path
      settings.set('audio-path', path)
      return audioInfo()
    }

    protocol.handle('miniapp-subaudio', async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      if (url.hostname !== 'media' || url.pathname !== '/current' || !audioPath) return new Response(null, { status: 404 })
      return serveFile(request, audioPath, audioType(audioPath) ?? 'application/octet-stream')
    })

    handle('get-audio', () => audioInfo())
    handle('pick-audio', async (event): Promise<AudioInfo | null> => {
      const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Audio', extensions: Object.keys(audioTypes) }] }
      const window = owner(event.sender)
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled || !result.filePaths[0] ? audioInfo() : useAudio(result.filePaths[0])
    })
    handle('set-audio', (_event, payload) => useAudio(payload))
    handle('clear-audio', () => { audioPath = null; settings.set('audio-path', null) })

    handle('open-file', async (event, payload): Promise<OpenedFile | null> => {
      if (payload !== 'subtitle' && payload !== 'project') throw new Error('Unsupported file type')
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: payload === 'subtitle' ? [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'xml', 'ttml', 'dfxp', 'srv3'] }] : [{ name: 'Subtitle project', extensions: ['json'] }]
      }
      const window = owner(event.sender)
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      const path = result.filePaths[0]
      if (result.canceled || !path) return null
      if ((await stat(path)).size > maxReadBytes) throw new Error('File is larger than 10 MB')
      return { path, name: basename(path), content: (await readFile(path, 'utf8')).replace(/^﻿/, '') }
    })

    handle('save-file', async (event, payload): Promise<string | null> => {
      const request = payload as { name?: unknown; ext?: unknown; content?: unknown } | null
      const ext = request?.ext
      if (ext !== 'json' && ext !== 'csv') throw new Error('Unsupported export type')
      if (typeof request?.content !== 'string' || request.content.length > maxWriteBytes) throw new Error('Nothing to save, or the data is too large')
      const name = (typeof request.name === 'string' ? request.name : '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 100) || 'subtitles'
      const options: Electron.SaveDialogOptions = {
        defaultPath: join(app.getPath('documents'), `${name}.${ext}`),
        filters: [{ name: exportTypes[ext], extensions: [ext] }]
      }
      const window = owner(event.sender)
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      // A BOM lets Excel read Vietnamese text in CSV files correctly.
      await writeFile(result.filePath, ext === 'csv' ? `﻿${request.content}` : request.content, 'utf8')
      return result.filePath
    })

    handle('load-draft', (): Doc | null => {
      const draft = readModuleJson<unknown>('subtitles', 'draft', null) ?? settings.get<unknown>('draft', null)
      return isDoc(draft) ? draft : null
    })
    handle('save-draft', async (_event, payload) => {
      if (!isDoc(payload)) throw new Error('Invalid draft')
      await writeModuleJson('subtitles', 'draft', payload)
    })
    handle('clear-draft', async () => {
      settings.set('draft', null)
      await writeModuleJson('subtitles', 'draft', null)
    })

    return () => { protocol.unhandle('miniapp-subaudio') }
  }
}
