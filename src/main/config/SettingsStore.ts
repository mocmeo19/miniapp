import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { InstalledModule } from '../../modules/core/types'

export type StoredModule = InstalledModule & { directory: string | null }

const validName = /^[a-z][a-z0-9-]*$/

export class SettingsStore {
  readonly path: string
  private readonly db: DatabaseSync

  constructor() {
    const directory = join(app.getPath('userData'), 'miniapp')
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, 'config.sqlite')
    this.db = new DatabaseSync(this.path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (namespace, key)
      );
      CREATE TABLE IF NOT EXISTS modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT NOT NULL,
        directory TEXT,
        enabled INTEGER NOT NULL DEFAULT 1
      );
    `)
  }

  get<T>(namespace: string, key: string, fallback: T): T {
    this.checkName(namespace, key)
    const row = this.db.prepare('SELECT value FROM settings WHERE namespace = ? AND key = ?').get(namespace, key) as { value: string } | undefined
    if (!row) return fallback
    try { return JSON.parse(row.value) as T } catch { return fallback }
  }

  set(namespace: string, key: string, value: unknown): void {
    this.checkName(namespace, key)
    const serialized = JSON.stringify(value)
    if (serialized === undefined || serialized.length > 8192) throw new Error('Invalid setting value')
    this.db.prepare(`
      INSERT INTO settings (namespace, key, value) VALUES (?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(namespace, key, serialized)
  }

  close(): void {
    this.db.close()
  }

  addBuiltInModule(module: Omit<InstalledModule, 'source' | 'enabled'>): void {
    this.db.prepare(`INSERT OR IGNORE INTO modules (id, name, version, description, source, directory, enabled)
      VALUES (?, ?, ?, ?, 'built-in', NULL, 1)`).run(module.id, module.name, module.version, module.description)
  }

  retireBuiltInModule(id: string): void {
    this.db.prepare("DELETE FROM modules WHERE id = ? AND source = 'built-in'").run(id)
  }

  addInstalledModule(module: StoredModule): void {
    this.db.prepare(`INSERT INTO modules (id, name, version, description, source, directory, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(module.id, module.name, module.version, module.description, module.source, module.directory, module.enabled ? 1 : 0)
  }

  listModules(): StoredModule[] {
    const rows = this.db.prepare('SELECT id, name, version, description, source, directory, enabled FROM modules ORDER BY source = \'built-in\' DESC, name ASC').all() as Array<Omit<StoredModule, 'enabled'> & { enabled: number }>
    return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }))
  }

  getModule(id: string): StoredModule | undefined {
    const row = this.db.prepare('SELECT id, name, version, description, source, directory, enabled FROM modules WHERE id = ?').get(id) as (Omit<StoredModule, 'enabled'> & { enabled: number }) | undefined
    return row ? { ...row, enabled: row.enabled === 1 } : undefined
  }

  setModuleEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE modules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  }

  deleteModule(id: string): void {
    this.db.prepare('DELETE FROM modules WHERE id = ? AND source != \'built-in\'').run(id)
  }

  deleteNamespace(namespace: string): void {
    this.checkName(namespace, 'settings')
    this.db.prepare('DELETE FROM settings WHERE namespace = ?').run(namespace)
  }

  private checkName(namespace: string, key: string): void {
    if (!validName.test(namespace) || !validName.test(key)) throw new Error('Invalid setting name')
  }
}
