import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// The shared settings store caps values at 8 KB, which is too small for playlists and drafts.
// Larger module data lives in <userData>/module-data/<moduleId>-<name>.json instead.
const maxBytes = 50 * 1024 * 1024
const validName = /^[a-z][a-z0-9-]*$/
const writes = new Map<string, Promise<void>>()

function fileFor(moduleId: string, name: string): string {
  if (!validName.test(moduleId) || !validName.test(name)) throw new Error('Invalid module data name')
  return join(app.getPath('userData'), 'module-data', `${moduleId}-${name}.json`)
}

export function readModuleJson<T>(moduleId: string, name: string, fallback: T): T {
  try { return JSON.parse(readFileSync(fileFor(moduleId, name), 'utf8')) as T } catch { return fallback }
}

// Writes are queued per file and atomic (temp file + rename), so a crash never leaves half a file.
export function writeModuleJson(moduleId: string, name: string, value: unknown): Promise<void> {
  const file = fileFor(moduleId, name)
  const serialized = JSON.stringify(value)
  if (serialized === undefined || Buffer.byteLength(serialized) > maxBytes) return Promise.reject(new Error('Data is too large to save'))
  const run = async () => {
    await mkdir(join(file, '..'), { recursive: true })
    const temp = `${file}.tmp`
    await writeFile(temp, serialized, 'utf8')
    await rename(temp, file)
  }
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(run)
  writes.set(file, next)
  return next
}
