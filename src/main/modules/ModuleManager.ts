import { app } from 'electron'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import { DataDirectory } from '../config/DataDirectory'
import type { DownloadManager } from '../downloads/DownloadManager'
import type { NotificationCenter } from '../notifications/NotificationCenter'
import type { SettingsStore, StoredModule } from '../config/SettingsStore'
import { loadModule, type MainModule, type MainModuleApi } from '../../modules/core/main'
import type { CatalogEntry, InstalledModule } from '../../modules/core/types'

type PackageManifest = {
  id: string
  name: string
  version: string
  description?: string
  ui: string
  main?: string
}

const maxArchiveBytes = 50 * 1024 * 1024
const maxExtractedBytes = 100 * 1024 * 1024
const validId = /^[a-z][a-z0-9-]{1,49}$/

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..' || part === '.' || part === '') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('Package contains an unsafe file path')
  }
  return normalized
}

function validHttps(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid HTTPS URL')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS URLs are supported')
  return url.toString()
}

async function fetchLimited(url: string, limit = maxArchiveBytes): Promise<Buffer> {
  const response = await fetch(validHttps(url), { signal: AbortSignal.timeout(120000) })
  if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error(`Download failed (HTTP ${response.status})`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > limit) throw new Error('Download exceeds the size limit')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > limit) throw new Error('Download exceeds the size limit')
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}

function extractZip(buffer: Buffer, destination: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) { rejectPromise(openError ?? new Error('Could not open package')); return }
      let count = 0
      let total = 0
      let finished = false
      const fail = (error: Error) => {
        if (finished) return
        finished = true
        zip.close()
        rejectPromise(error)
      }
      zip.on('error', fail)
      zip.on('end', () => { if (!finished) { finished = true; resolvePromise() } })
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          count++
          total += entry.uncompressedSize
          if (count > 500 || total > maxExtractedBytes) throw new Error('Package exceeds extraction limits')
          const isDirectory = entry.fileName.endsWith('/')
          const relative = safeRelativePath(isDirectory ? entry.fileName.slice(0, -1) : entry.fileName)
          const output = resolve(destination, relative)
          if (!output.startsWith(`${resolve(destination)}${sep}`)) throw new Error('Package contains an unsafe file path')
          if (isDirectory) await mkdir(output, { recursive: true })
          else {
            await mkdir(dirname(output), { recursive: true })
            const stream = await new Promise<NodeJS.ReadableStream>((ok, reject) => zip.openReadStream(entry, (error, result) => error || !result ? reject(error ?? new Error('Could not read package entry')) : ok(result)))
            const { createWriteStream } = await import('node:fs')
            await pipeline(stream, createWriteStream(output, { flags: 'wx', mode: 0o644 }))
          }
          zip.readEntry()
        })().catch(fail)
      })
      zip.readEntry()
    })
  })
}

function validateManifest(value: unknown): PackageManifest {
  if (!value || typeof value !== 'object') throw new Error('Package manifest is invalid')
  const manifest = value as Partial<PackageManifest>
  if (typeof manifest.id !== 'string' || !validId.test(manifest.id) || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80 ||
      typeof manifest.version !== 'string' || !/^[\w.+-]{1,32}$/.test(manifest.version) || typeof manifest.ui !== 'string') {
    throw new Error('Package manifest is invalid')
  }
  safeRelativePath(manifest.ui)
  if (manifest.main !== undefined) safeRelativePath(manifest.main)
  if (manifest.description !== undefined && (typeof manifest.description !== 'string' || manifest.description.length > 500)) throw new Error('Package description is invalid')
  return manifest as PackageManifest
}

export class ModuleManager {
  private readonly directory = join(app.getPath('userData'), 'miniapp', 'modules')
  private readonly active = new Map<string, () => void>()
  private readonly builtIns = new Map<string, MainModule>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly dataDirectory = new DataDirectory(settings),
    private readonly downloads?: DownloadManager,
    private readonly notifications?: NotificationCenter
  ) {}

  registerBuiltIn(module: MainModule, info: Omit<InstalledModule, 'source' | 'enabled'>): void {
    this.builtIns.set(module.id, module)
    this.settings.addBuiltInModule(info)
  }

  start(): void {
    for (const module of this.settings.listModules().filter((item) => item.enabled)) {
      try { this.activate(module) }
      catch (error) {
        this.settings.setModuleEnabled(module.id, false)
        console.error(`Could not start module ${module.id}:`, error)
      }
    }
  }

  list(): InstalledModule[] {
    return this.settings.listModules().map(({ directory: _directory, ...module }) => module)
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const module = this.settings.getModule(id)
    if (!module) throw new Error('Module not found')
    if (module.enabled === enabled) return
    if (enabled) this.activate(module)
    else this.deactivate(id)
    this.settings.setModuleEnabled(id, enabled)
  }

  async remove(id: string): Promise<void> {
    const module = this.settings.getModule(id)
    if (!module) throw new Error('Module not found')
    if (module.source === 'built-in') throw new Error('Built-in modules cannot be deleted')
    if (module.enabled) {
      this.deactivate(id)
      this.settings.setModuleEnabled(id, false)
    }
    if (module.directory) await rm(module.directory, { recursive: true, force: true })
    this.settings.deleteModule(id)
    this.settings.deleteNamespace(`module-${id}`)
  }

  async installFromFile(file: string): Promise<InstalledModule> {
    const info = await stat(file)
    if (!info.isFile() || info.size > maxArchiveBytes) throw new Error('Package file is too large')
    return this.installBuffer(await readFile(file), 'file')
  }

  async installFromUrl(url: string): Promise<InstalledModule> {
    return this.installBuffer(await fetchLimited(url), 'url')
  }

  async catalog(): Promise<CatalogEntry[]> {
    const url = this.settings.get('marketplace', 'catalog-url', '')
    if (!url) return []
    const value = JSON.parse((await fetchLimited(url, 2 * 1024 * 1024)).toString('utf8')) as unknown
    if (!Array.isArray(value) || value.length > 100) throw new Error('Catalog must be an array of at most 100 modules')
    return value.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid catalog entry')
      const entry = item as Partial<CatalogEntry>
      if (typeof entry.id !== 'string' || !validId.test(entry.id) || typeof entry.name !== 'string' || entry.name.length > 80 ||
          typeof entry.version !== 'string' || typeof entry.description !== 'string' || typeof entry.downloadUrl !== 'string') throw new Error('Invalid catalog entry')
      return { id: entry.id, name: entry.name, version: entry.version, description: entry.description, downloadUrl: validHttps(entry.downloadUrl) }
    })
  }

  getCatalogUrl(): string { return this.settings.get('marketplace', 'catalog-url', '') }
  setCatalogUrl(url: string): void { this.settings.set('marketplace', 'catalog-url', url ? validHttps(url) : '') }

  async readUi(id: string): Promise<string> {
    const record = this.settings.getModule(id)
    if (!record || !record.enabled || !record.directory) throw new Error('Module UI is not available')
    const manifest = validateManifest(JSON.parse(await readFile(join(record.directory, 'manifest.json'), 'utf8')))
    const file = join(record.directory, safeRelativePath(manifest.ui))
    const info = await stat(file)
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Module UI is too large')
    return readFile(file, 'utf8')
  }

  private async installBuffer(buffer: Buffer, source: 'file' | 'url'): Promise<InstalledModule> {
    if (buffer.length > maxArchiveBytes) throw new Error('Package is too large')
    await mkdir(this.directory, { recursive: true })
    const temporary = join(this.directory, `.install-${crypto.randomUUID()}`)
    await mkdir(temporary)
    try {
      await extractZip(buffer, temporary)
      const manifest = validateManifest(JSON.parse(await readFile(join(temporary, 'manifest.json'), 'utf8')))
      if (this.settings.getModule(manifest.id)) throw new Error(`Module ${manifest.id} is already installed`)
      if (!existsSync(join(temporary, manifest.ui))) throw new Error('Module UI file is missing')
      if (manifest.main && !existsSync(join(temporary, manifest.main))) throw new Error('Module main file is missing')
      const directory = join(this.directory, manifest.id)
      if (existsSync(directory)) throw new Error('Module directory already exists')
      await rename(temporary, directory)
      const record: StoredModule = { id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description ?? '', source, directory, enabled: false }
      try { this.settings.addInstalledModule(record) }
      catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
      const { directory: _directory, ...publicRecord } = record
      return publicRecord
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }

  private activate(record: StoredModule): void {
    let module = this.builtIns.get(record.id)
    if (!module) {
      if (!record.directory) throw new Error('Module files are missing')
      const manifest = validateManifest(JSON.parse(require('node:fs').readFileSync(join(record.directory, 'manifest.json'), 'utf8')))
      if (!manifest.main) return // UI-only modules need no main process handlers.
      const moduleRequire = createRequire(join(record.directory, 'manifest.json'))
      const file = join(record.directory, safeRelativePath(manifest.main))
      const resolved = moduleRequire.resolve(file)
      delete moduleRequire.cache[resolved]
      const plugin = moduleRequire(file) as { activate?: (api: MainModuleApi) => void | (() => void) }
      if (typeof plugin.activate !== 'function') throw new Error('Module main file must export activate(api)')
      module = { id: record.id, register: (api) => plugin.activate!(api) }
    }
    this.active.set(record.id, loadModule(module, this.settings, this.dataDirectory, this.downloads, this.notifications))
  }

  private deactivate(id: string): void {
    try { this.active.get(id)?.() }
    catch (error) { console.error(`Could not clean up module ${id}:`, error) }
    this.active.delete(id)
  }
}
