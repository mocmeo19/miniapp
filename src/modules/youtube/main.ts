import { session, shell, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { binaryPath } from '../core/binaries'
import type { MainModule } from '../core/main'
import { SearchHistory } from './history'
import { moveLegacyDownloads } from './legacy'
import type { DownloadEvent, DownloadOption, HistoryEntry, HistoryItem, VideoInfo, YoutubeStatus } from './types'

type RawFormat = {
  format_id?: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  abr?: number
  fps?: number
  filesize?: number
  filesize_approx?: number
}
type RawInfo = {
  id?: string
  title?: string
  channel?: string
  uploader?: string
  duration?: number
  thumbnail?: string
  formats?: RawFormat[]
}
type Inspection = { url: string; info: VideoInfo }
type Job = { id: string; process: ChildProcessWithoutNullStreams; cancelled: boolean }

const inspections = new Map<number, Inspection>()
const jobs = new Map<number, Job>()

const executable = binaryPath

const profileIdPattern = /^[a-f\d-]{36}$/
const videoIdPattern = /^[\w-]{1,64}$/

function videoId(value: unknown): string {
  if (typeof value !== 'string' || !videoIdPattern.test(value)) throw new Error('Invalid video')
  return value
}
const cookieDomains = /(^|\.)(youtube\.com|google\.com|googlevideo\.com|youtube-nocookie\.com)$/
type CookieFile = { args: string[]; cleanup: () => Promise<void> }
const noCookies: CookieFile = { args: [], cleanup: async () => undefined }

// Exports the Web Browser module profile's YouTube/Google cookies to a private temporary Netscape cookie file for yt-dlp.
async function exportProfileCookies(profileId: string | null): Promise<CookieFile> {
  if (!profileId || !profileIdPattern.test(profileId)) return noCookies
  const cookies = await session.fromPartition(`persist:miniapp-webview-${profileId}`).cookies.get({})
  const lines = ['# Netscape HTTP Cookie File']
  for (const cookie of cookies) {
    const domain = cookie.domain ?? ''
    if (!cookieDomains.test(domain.replace(/^\./, ''))) continue
    if (/[\t\r\n]/.test(cookie.name + cookie.value + (cookie.path ?? ''))) continue
    lines.push([
      `${cookie.httpOnly ? '#HttpOnly_' : ''}${domain}`,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      cookie.path ?? '/',
      cookie.secure ? 'TRUE' : 'FALSE',
      Math.floor(cookie.expirationDate ?? 0),
      cookie.name,
      cookie.value
    ].join('\t'))
  }
  if (lines.length === 1) return noCookies
  const directory = await mkdtemp(join(tmpdir(), 'miniapp-yt-'))
  const file = join(directory, 'cookies.txt')
  await writeFile(file, `${lines.join('\n')}\n`, { mode: 0o600 })
  return { args: ['--cookies', file], cleanup: () => rm(directory, { recursive: true, force: true }) }
}

function ffmpegArgs(): string[] {
  const ffmpeg = executable('ffmpeg')
  return ffmpeg === 'ffmpeg' || ffmpeg === 'ffmpeg.exe' ? [] : ['--ffmpeg-location', dirname(ffmpeg)]
}

function runCapture(command: string, args: string[], timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 12_000_000) child.kill()
    })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function hasFfmpeg(): Promise<boolean> {
  try {
    await runCapture(executable('ffmpeg'), ['-version'], 5000)
    return true
  } catch {
    return false
  }
}

function youtubeUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid YouTube URL')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a valid YouTube URL') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password ||
      !(['youtu.be', 'youtube.com'].includes(host) || host.endsWith('.youtube.com'))) {
    throw new Error('Only HTTPS YouTube links are supported')
  }
  return url.toString()
}

function optionsFrom(raw: RawFormat[]): DownloadOption[] {
  const options: DownloadOption[] = []
  for (const format of raw) {
    if (!format.format_id || !/^[\w.-]+$/.test(format.format_id)) continue
    const video = !!format.vcodec && format.vcodec !== 'none'
    const audio = !!format.acodec && format.acodec !== 'none'
    if (!video && !audio) continue
    const size = format.filesize ?? format.filesize_approx ?? null
    if (video) {
      const quality = format.height ? `${format.height}p` : 'Video'
      const fps = format.fps && format.fps > 30 ? ` · ${format.fps} fps` : ''
      options.push({ id: format.format_id, kind: 'video', label: `${quality}${fps} · ${(format.ext ?? 'video').toUpperCase()}${audio ? ' · with audio' : ' · video only'}`, extension: format.ext ?? '', size, requiresFfmpeg: !audio,
        height: format.height ?? null, fps: format.fps ?? null, bitrate: null, hasAudio: audio })
    } else {
      const bitrate = format.abr ? ` · ${Math.round(format.abr)} kbps` : ''
      options.push({ id: format.format_id, kind: 'audio', label: `${(format.ext ?? 'audio').toUpperCase()}${bitrate}`, extension: format.ext ?? '', size, requiresFfmpeg: false,
        height: null, fps: null, bitrate: format.abr ? Math.round(format.abr) : null, hasAudio: true })
    }
  }
  // Show larger and higher quality formats first; retain the complete list for selection.
  return options.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'video' ? -1 : 1
    const height = (option: DownloadOption) => Number(option.label.match(/^(\d+)p/)?.[1] ?? 0)
    return a.kind === 'video' ? height(b) - height(a) : (b.size ?? 0) - (a.size ?? 0)
  })
}

function emitProgress(target: WebContents, emit: (target: WebContents, event: string, payload: unknown) => void, event: DownloadEvent): void {
  emit(target, 'download', event)
}

export const youtubeMainModule: MainModule = {
  id: 'youtube',
  register({ handle, emit, settings, paths, notify }) {
    // Downloads always live in <data-dir>/youtube, split by content type.
    const folder = () => paths.data()
    const folderFor = (kind: DownloadOption['kind']) => paths.data(kind)
    const history = new SearchHistory('youtube')

    // One-time move of downloads saved before they lived in <data-dir>/youtube: the old "YouTube" folder
    // in the data folder, and files this module named inside a folder the user picked earlier.
    const legacyFolder = settings.get<string | null>('download-folder', null)
    void moveLegacyDownloads({
      ownedFolders: [join(dirname(folder()), 'YouTube')],
      sharedFolder: typeof legacyFolder === 'string' && isAbsolute(legacyFolder) ? legacyFolder : null,
      ffmpeg: executable('ffmpeg'),
      destination: folderFor
    }).then(async ({ moved, failed }) => {
      if (moved.length) console.log(`Moved ${moved.length} earlier YouTube download(s) into ${folder()}`)
      await history.relocate(moved)
      if (failed === 0 && legacyFolder !== null) settings.set('download-folder', null)
    }).catch((error: unknown) => console.error('Could not move earlier YouTube downloads', error))
    const cookieProfileId = (): string | null => {
      const value = settings.get<string | null>('cookie-profile-id', null)
      return typeof value === 'string' && profileIdPattern.test(value) ? value : null
    }
    handle('status', async (): Promise<YoutubeStatus> => {
      let version: string | null = null
      try { version = await runCapture(executable('yt-dlp'), ['--version'], 45000) } catch { /* shown in UI */ }
      return {
        available: version !== null,
        version,
        ffmpegAvailable: await hasFfmpeg(),
        folder: folder(),
        cookieProfileId: cookieProfileId()
      }
    })

    handle('set-cookie-profile', (_event, payload): string | null => {
      if (payload !== null && (typeof payload !== 'string' || !profileIdPattern.test(payload))) throw new Error('Invalid browser profile')
      settings.set('cookie-profile-id', payload)
      return payload
    })

    handle('folder', () => folder())

    handle('open-folder', async () => {
      const error = await shell.openPath(folder())
      if (error) throw new Error(error)
    })

    handle('inspect', async (event, payload): Promise<VideoInfo> => {
      const url = youtubeUrl(payload)
      let stdout: string
      const cookies = await exportProfileCookies(cookieProfileId())
      try {
        stdout = await runCapture(executable('yt-dlp'), ['--ignore-config', '--js-runtimes', 'node', ...ffmpegArgs(), ...cookies.args, '--no-playlist', '--dump-single-json', '--', url])
      } catch (error) {
        throw new Error(`Could not read this video. ${error instanceof Error ? error.message : String(error)}`)
      } finally { await cookies.cleanup() }
      const raw = JSON.parse(stdout) as RawInfo
      if (!raw.id || !raw.title || !Array.isArray(raw.formats)) throw new Error('No downloadable video formats were found')
      const ffmpegAvailable = await hasFfmpeg()
      const info: VideoInfo = {
        id: raw.id,
        title: raw.title,
        channel: raw.channel ?? raw.uploader ?? 'YouTube',
        duration: raw.duration ?? null,
        thumbnail: raw.thumbnail?.startsWith('https://') ? raw.thumbnail : null,
        options: optionsFrom(raw.formats),
        ffmpegAvailable
      }
      inspections.set(event.sender.id, { url, info })
      await history.add(url, info).catch((error: unknown) => console.error('Could not save YouTube history', error))
      return info
    })

    handle('history', (): HistoryItem[] => history.list())

    handle('history-open', async (event, payload): Promise<HistoryEntry> => {
      const entry = history.get(videoId(payload))
      if (!entry) throw new Error('This video is no longer in history')
      const info: VideoInfo = { ...entry.info, ffmpegAvailable: await hasFfmpeg() }
      inspections.set(event.sender.id, { url: entry.url, info })
      return { ...entry, info }
    })

    handle('history-remove', async (_event, payload): Promise<HistoryItem[]> => {
      await history.remove(videoId(payload))
      return history.list()
    })

    handle('history-clear', async (): Promise<HistoryItem[]> => {
      await history.clear()
      return history.list()
    })

    handle('download', async (event, payload) => {
      const request = payload as { formatId?: unknown } | null
      const inspection = inspections.get(event.sender.id)
      if (!inspection) throw new Error('Inspect a video before downloading')
      if (jobs.has(event.sender.id)) throw new Error('A download is already running')
      const option = inspection.info.options.find((item) => item.id === request?.formatId)
      if (!option) throw new Error('Choose a valid format')
      if (option.requiresFfmpeg && !inspection.info.ffmpegAvailable) throw new Error('This format needs ffmpeg to merge video and audio')
      const format = option.kind === 'video' && option.requiresFfmpeg
        ? `${option.id}+bestaudio/${option.id}` : option.id
      const targetFolder = folderFor(option.kind)
      const cookies = await exportProfileCookies(cookieProfileId())
      if (jobs.has(event.sender.id)) { await cookies.cleanup(); throw new Error('A download is already running') }
      const args = [
        '--ignore-config', '--js-runtimes', 'node', ...ffmpegArgs(), ...cookies.args, '--no-playlist', '--no-overwrites', '--newline', '--progress',
        '--progress-template', 'download:progress:%(progress._percent_str)s',
        '--print', 'after_move:filepath:%(filepath)s',
        '-f', format, '-P', targetFolder, '-o', '%(title).180B [%(id)s].%(ext)s',
        '--', inspection.url
      ]
      const child = spawn(executable('yt-dlp'), args, { windowsHide: true })
      const job: Job = { id: randomUUID(), process: child, cancelled: false }
      jobs.set(event.sender.id, job)
      const target = event.sender
      let stdoutBuffer = ''
      let stderr = ''
      let finalPath = ''
      let percent = 0
      let completedParts = 0
      let lastPartPercent = 0
      const parts = format.includes('+') ? 2 : 1
      const readLine = (line: string) => {
        if (line.startsWith('filepath:')) finalPath = line.slice('filepath:'.length).trim()
        const match = line.match(/^progress:\s*([\d.]+)%/)
        if (match) {
          const partPercent = Math.max(0, Math.min(100, Number(match[1])))
          if (partPercent >= 100 && lastPartPercent < 100) completedParts = Math.min(parts, completedParts + 1)
          percent = Math.max(percent, parts === 1 ? partPercent : completedParts >= parts ? 100 : (completedParts === 1 && partPercent < 100 ? 50 + partPercent / 2 : partPercent / 2))
          lastPartPercent = partPercent
          emitProgress(target, emit, { jobId: job.id, state: 'running', percent })
        }
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ''
        lines.forEach(readLine)
      })
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
      child.once('error', (error) => {
        void cookies.cleanup()
        jobs.delete(target.id)
        emitProgress(target, emit, { jobId: job.id, state: 'failed', percent, error: error.message })
      })
      child.once('close', (code) => {
        void cookies.cleanup()
        if (jobs.get(target.id) !== job) return
        jobs.delete(target.id)
        if (stdoutBuffer) readLine(stdoutBuffer)
        const state = job.cancelled ? 'cancelled' : code === 0 ? 'completed' : 'failed'
        if (state === 'completed' && finalPath) {
          void history.markDownloaded(inspection.info.id, { path: finalPath, label: option.label, at: Date.now() })
            .catch((error: unknown) => console.error('Could not save YouTube history', error))
          notify({ title: 'YouTube download complete', body: basename(finalPath), kind: 'success', link: '/modules/youtube' })
        }
        if (state === 'failed') notify({ title: 'YouTube download failed', body: inspection.info.title, kind: 'error', link: '/modules/youtube' })
        emitProgress(target, emit, { jobId: job.id, state, percent: state === 'completed' ? 100 : percent, path: finalPath || undefined, error: state === 'failed' ? stderr.trim() || `yt-dlp exited with code ${code ?? 'unknown'}` : undefined })
      })
      target.once('destroyed', () => { child.kill(); jobs.delete(target.id); inspections.delete(target.id) })
      return { jobId: job.id }
    })

    handle('cancel', (event, payload) => {
      const job = jobs.get(event.sender.id)
      if (!job || job.id !== (payload as { jobId?: unknown } | null)?.jobId) return false
      job.cancelled = true
      job.process.kill()
      return true
    })
    return () => {
      jobs.forEach((job) => { job.cancelled = true; job.process.kill() })
      jobs.clear()
      inspections.clear()
    }
  }
}
