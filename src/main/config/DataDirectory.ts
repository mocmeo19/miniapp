import { app } from 'electron'
import { constants, mkdirSync } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { SettingsStore } from './SettingsStore'

const namespace = 'storage'
const key = 'data-directory'
const ownerName = /^[a-z][a-z0-9-]{0,49}$/
const segmentName = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/

export class DataDirectory {
  constructor(private readonly settings: SettingsStore) {}

  get defaultPath(): string { return join(app.getPath('downloads'), 'MiniApp') }

  current(): string {
    const stored = this.settings.get<string | null>(namespace, key, null)
    return typeof stored === 'string' && isAbsolute(stored) ? stored : this.defaultPath
  }

  /** `<data-dir>/<owner>/<...segments>`, created on demand. Owners (module ids) can never reach outside their own folder. */
  folderFor(owner: string, ...segments: string[]): string {
    if (!ownerName.test(owner)) throw new Error('Invalid data folder owner')
    if (segments.some((segment) => !segmentName.test(segment) || /^\.+$/.test(segment))) throw new Error('Invalid data folder name')
    const path = join(this.current(), owner, ...segments)
    mkdirSync(path, { recursive: true })
    return path
  }

  /** `<data-dir>/Downloads`, where the Download manager saves files by default. */
  downloadsFolder(): string {
    const path = join(this.current(), 'Downloads')
    mkdirSync(path, { recursive: true })
    return path
  }

  async set(path: string): Promise<string> {
    const resolved = await realpath(path)
    if (!(await stat(resolved)).isDirectory()) throw new Error('Choose a folder')
    await access(resolved, constants.W_OK)
    this.settings.set(namespace, key, resolved)
    return resolved
  }

  reset(): string {
    this.settings.set(namespace, key, null)
    return this.current()
  }
}
