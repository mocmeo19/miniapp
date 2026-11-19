import { spawn } from 'node:child_process'
import { extname } from 'node:path'
import { moveMatchingFiles, type MovedFile } from '../core/files'

// Files this module named with its output template: "<title> [<video id>].<ext>".
const downloadName = /\[[\w-]{11}\]\.[a-z0-9]{2,5}$/i
const mediaExtensions = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', '3gp', 'flv', 'm4a', 'mp3', 'opus', 'ogg', 'oga', 'aac', 'flac', 'wav'])
const audioExtensions = new Set(['m4a', 'mp3', 'opus', 'ogg', 'oga', 'aac', 'flac', 'wav'])

type Kind = 'video' | 'audio'

function extensionOf(name: string): string {
  return extname(name).slice(1).toLowerCase()
}

/** Reads the file's streams with ffmpeg; null when ffmpeg cannot tell. */
function hasVideoStream(ffmpeg: string, path: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(ffmpeg, ['-hide_banner', '-i', path], { windowsHide: true })
    const timer = setTimeout(() => child.kill(), 15000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { output = (output + chunk).slice(-20000) })
    child.once('error', () => { clearTimeout(timer); resolve(null) })
    child.once('close', () => {
      clearTimeout(timer)
      if (!/Stream #\d+:\d+/.test(output)) resolve(null)
      else resolve(/Stream #\d+:\d+.*: Video: (?!.*attached pic)/.test(output))
    })
  })
}

async function kindOf(ffmpeg: string, path: string): Promise<Kind> {
  if (audioExtensions.has(extensionOf(path))) return 'audio'
  return await hasVideoStream(ffmpeg, path) === false ? 'audio' : 'video'
}

type LegacyDownloads = {
  /** Folders only this module ever wrote to; every media file in them moves. */
  ownedFolders: string[]
  /** A folder the user picked before downloads moved to the data folder; only files this module named move. */
  sharedFolder: string | null
  ffmpeg: string
  destination: (kind: Kind) => string
}

export async function moveLegacyDownloads({ ownedFolders, sharedFolder, ffmpeg, destination }: LegacyDownloads): Promise<{ moved: MovedFile[]; failed: number }> {
  const target = async (path: string) => destination(await kindOf(ffmpeg, path))
  const isMedia = (name: string) => mediaExtensions.has(extensionOf(name))
  const results = await Promise.all([
    ...ownedFolders.map((folder) => moveMatchingFiles(folder, isMedia, target)),
    ...(sharedFolder ? [moveMatchingFiles(sharedFolder, (name) => isMedia(name) && downloadName.test(name), target)] : [])
  ])
  return { moved: results.flatMap((result) => result.moved), failed: results.reduce((sum, result) => sum + result.failed, 0) }
}
