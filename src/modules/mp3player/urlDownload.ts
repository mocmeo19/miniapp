import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { binaryPath } from '../core/binaries'

export function audioUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid link')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a valid link') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links are supported')
  return url.toString()
}

type DownloadOptions = {
  url: string
  folder: string
  signal: AbortSignal
  onProgress: (percent: number) => void
}

/** Downloads the audio behind a link (a direct file or a page yt-dlp understands) and converts it to MP3. */
export function downloadAudio({ url, folder, signal, onProgress }: DownloadOptions): Promise<string> {
  const ffmpeg = binaryPath('ffmpeg')
  const ffmpegArgs = ffmpeg === 'ffmpeg' || ffmpeg === 'ffmpeg.exe' ? [] : ['--ffmpeg-location', dirname(ffmpeg)]
  const args = [
    '--ignore-config', '--js-runtimes', 'node', ...ffmpegArgs, '--no-playlist', '--no-overwrites', '--newline', '--progress',
    '--progress-template', 'download:progress:%(progress._percent_str)s',
    '--print', 'after_move:filepath:%(filepath)s',
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-P', folder, '-o', '%(title).180B [%(id)s].%(ext)s',
    '--', url
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath('yt-dlp'), args, { windowsHide: true })
    let buffer = ''
    let stderr = ''
    let finalPath = ''
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    const readLine = (line: string) => {
      if (line.startsWith('filepath:')) finalPath = line.slice('filepath:'.length).trim()
      const match = /^progress:\s*([\d.]+)%/.exec(line)
      if (match) onProgress(Math.max(0, Math.min(100, Number(match[1]))))
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(readLine)
    })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
    child.once('error', (error) => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (buffer) readLine(buffer)
      if (signal.aborted) reject(new Error('Download cancelled'))
      else if (code === 0 && finalPath) resolve(finalPath)
      else reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code ?? 'unknown'}`))
    })
  })
}
