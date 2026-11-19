import type { DatabaseSync } from 'node:sqlite'

export type PendingImage = { id: string; path: string; folderPath: string }

const enabledKey = 'autoTag'
const modelsKey = 'autoTagModels'
const maxTagsPerFile = 20

export class AutoTagStore {
  constructor(private readonly db: DatabaseSync) {}

  enabled(): boolean {
    const row = this.db.prepare('SELECT value FROM library_settings WHERE key = ?').get(enabledKey) as { value: string } | undefined
    return row?.value === '1'
  }

  setEnabled(enabled: boolean): void {
    this.db.prepare('INSERT INTO library_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(enabledKey, enabled ? '1' : '0')
  }

  selectedModels(): string[] | null {
    const row = this.db.prepare('SELECT value FROM library_settings WHERE key = ?').get(modelsKey) as { value: string } | undefined
    try {
      const ids = row ? JSON.parse(row.value) as unknown : null
      return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : null
    } catch { return null }
  }

  setSelectedModels(ids: string[]): void {
    this.db.prepare('INSERT INTO library_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(modelsKey, JSON.stringify(ids))
  }

  pendingCount(version: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS count FROM library_files
      WHERE kind = 'image' AND (auto_tag_version IS NULL OR auto_tag_version != ?)`).get(version) as { count: number }).count
  }

  pending(version: string, limit: number): PendingImage[] {
    return this.db.prepare(`SELECT m.id, m.path, f.path AS folderPath FROM library_files m
      JOIN library_folders f ON f.id = m.folder_id
      WHERE m.kind = 'image' AND (m.auto_tag_version IS NULL OR m.auto_tag_version != ?)
      ORDER BY m.modified_at DESC LIMIT ?`).all(version, limit) as PendingImage[]
  }

  imagesById(ids: string[]): PendingImage[] {
    if (ids.length === 0) return []
    return this.db.prepare(`SELECT m.id, m.path, f.path AS folderPath FROM library_files m
      JOIN library_folders f ON f.id = m.folder_id
      WHERE m.kind = 'image' AND m.id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as PendingImage[]
  }

  /** Every image in a Library folder, or in one of its subfolders ('' = the whole folder) and below. */
  imagesIn(folderId: string, directory: string): PendingImage[] {
    const prefix = `${directory.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}/%`
    return this.db.prepare(`SELECT m.id, m.path, f.path AS folderPath FROM library_files m
      JOIN library_folders f ON f.id = m.folder_id
      WHERE m.kind = 'image' AND m.folder_id = ? AND (? = '' OR m.directory = ? OR m.directory LIKE ? ESCAPE '\\')
      ORDER BY m.directory, m.name`).all(folderId, directory, directory, prefix) as PendingImage[]
  }

  apply(fileId: string, version: string, tags: string[]): void {
    this.db.exec('BEGIN')
    try {
      const exists = this.db.prepare('SELECT 1 FROM library_files WHERE id = ?').get(fileId)
      if (exists) {
        this.db.prepare("DELETE FROM library_tags WHERE file_id = ? AND source = 'auto'").run(fileId)
        const used = (this.db.prepare('SELECT COUNT(*) AS count FROM library_tags WHERE file_id = ?').get(fileId) as { count: number }).count
        const insert = this.db.prepare("INSERT OR IGNORE INTO library_tags (file_id, tag, source) VALUES (?, ?, 'auto')")
        for (const tag of tags.slice(0, Math.max(0, maxTagsPerFile - used))) insert.run(fileId, tag)
        this.db.prepare('UPDATE library_files SET auto_tag_version = ? WHERE id = ?').run(version, fileId)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  clear(): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec("DELETE FROM library_tags WHERE source = 'auto'")
      this.db.exec('UPDATE library_files SET auto_tag_version = NULL')
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
