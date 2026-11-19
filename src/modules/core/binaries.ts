import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Finds a bundled helper binary (yt-dlp, ffmpeg); falls back to the bare name so PATH can supply it.
export function binaryPath(name: 'yt-dlp' | 'ffmpeg' | 'adb' | 'scrcpy'): string {
  const file = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = [
    join(process.resourcesPath, 'bin', file),
    join(app.getAppPath(), 'resources', 'bin', file),
    join(process.cwd(), 'resources', 'bin', file)
  ]
  return candidates.find(existsSync) ?? file
}
