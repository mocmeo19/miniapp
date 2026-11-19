import { randomUUID } from 'node:crypto'
import { dirname, extname, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { LibraryFile, LibraryFolder, LibraryPage, LibraryQuery, LibrarySubfolder } from '../../library/types'

type FolderRow = { id: string; path: string; added_at: string; file_count: number }
type FileRow = { id: string; folder_id: string; path: string; relative_path: string; directory: string; name: string; kind: 'image' | 'video'; extension: string; size: number; modified_at: number; width: number | null; height: number | null }

export type ScannedFile = { path: string; name: string; kind: 'image' | 'video'; size: number; modifiedAt: number; width?: number; height?: number }

export type KnownFile = { size: number; modifiedAt: number; width: number | null }

function escapeLike(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') }

function like(value: string): string { return `%${escapeLike(value)}%` }

export function directoryOf(relativePath: string): string {
  const parent = dirname(relativePath)
  return parent === '.' ? '' : parent.split(sep).join('/')
}

export class LibraryStore {
  private readonly db: DatabaseSync

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS library_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS library_files (
        id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        relative_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
        extension TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        seen_scan TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS library_tags (
        file_id TEXT NOT NULL REFERENCES library_files(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (file_id, tag)
      );
      CREATE INDEX IF NOT EXISTS library_files_folder ON library_files(folder_id);
      CREATE INDEX IF NOT EXISTS library_files_name ON library_files(name);
      CREATE INDEX IF NOT EXISTS library_files_modified ON library_files(modified_at DESC);
      CREATE INDEX IF NOT EXISTS library_tags_tag ON library_tags(tag);
    `)
    this.migrateDirectories()
    this.migrateAutoTags()
    this.migrateDimensions()
  }

  private migrateDimensions(): void {
    if (!this.columnExists('library_files', 'width')) this.db.exec('ALTER TABLE library_files ADD COLUMN width INTEGER')
    if (!this.columnExists('library_files', 'height')) this.db.exec('ALTER TABLE library_files ADD COLUMN height INTEGER')
  }

  get connection(): DatabaseSync { return this.db }

  private columnExists(table: string, column: string): boolean {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column)
  }

  private migrateAutoTags(): void {
    if (!this.columnExists('library_tags', 'source')) this.db.exec("ALTER TABLE library_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'user'")
    if (!this.columnExists('library_files', 'auto_tag_version')) this.db.exec('ALTER TABLE library_files ADD COLUMN auto_tag_version TEXT')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS library_files_auto_tag ON library_files(kind, auto_tag_version);
    `)
  }

  private migrateDirectories(): void {
    if (!this.columnExists('library_files', 'directory')) {
      this.db.exec("ALTER TABLE library_files ADD COLUMN directory TEXT NOT NULL DEFAULT ''")
      const rows = this.db.prepare('SELECT id, relative_path FROM library_files').all() as Array<{ id: string; relative_path: string }>
      const update = this.db.prepare('UPDATE library_files SET directory = ? WHERE id = ?')
      this.db.exec('BEGIN')
      try {
        for (const row of rows) update.run(directoryOf(row.relative_path), row.id)
        this.db.exec('COMMIT')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS library_files_directory ON library_files(folder_id, directory)')
  }

  close(): void { this.db.close() }

  folders(): LibraryFolder[] {
    const rows = this.db.prepare(`SELECT f.id, f.path, f.added_at, COUNT(m.id) AS file_count
      FROM library_folders f LEFT JOIN library_files m ON m.folder_id = f.id
      GROUP BY f.id ORDER BY f.added_at, f.path`).all() as FolderRow[]
    return rows.map((row) => ({ id: row.id, path: row.path, addedAt: row.added_at, fileCount: row.file_count }))
  }

  folder(id: string): LibraryFolder | undefined { return this.folders().find((folder) => folder.id === id) }

  addFolder(path: string): LibraryFolder {
    const existing = this.folders()
    if (existing.some((folder) => path === folder.path || path.startsWith(folder.path + sep) || folder.path.startsWith(path + sep))) {
      throw new Error('This folder overlaps an existing Library folder')
    }
    const id = randomUUID()
    this.db.prepare('INSERT INTO library_folders (id, path) VALUES (?, ?)').run(id, path)
    return this.folder(id)!
  }

  removeFolder(id: string): void {
    const result = this.db.prepare('DELETE FROM library_folders WHERE id = ?').run(id)
    if (result.changes === 0) throw new Error('Folder not found')
  }

  /** What the index already knows about a folder's files, so scans only re-read files that changed. */
  knownFiles(folderId: string): Map<string, KnownFile> {
    const rows = this.db.prepare('SELECT path, size, modified_at, width FROM library_files WHERE folder_id = ?').all(folderId) as Array<{ path: string; size: number; modified_at: number; width: number | null }>
    return new Map(rows.map((row) => [row.path, { size: row.size, modifiedAt: row.modified_at, width: row.width }]))
  }

  upsertBatch(folder: LibraryFolder, scanId: string, batch: ScannedFile[]): void {
    // A changed file loses its auto-tags and size; a size read during this scan always wins.
    const unchanged = 'library_files.size = excluded.size AND library_files.modified_at = excluded.modified_at'
    const statement = this.db.prepare(`INSERT INTO library_files
      (id, folder_id, path, relative_path, directory, name, kind, extension, size, modified_at, seen_scan, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
      relative_path = excluded.relative_path, directory = excluded.directory, name = excluded.name, kind = excluded.kind,
      extension = excluded.extension, size = excluded.size, modified_at = excluded.modified_at, seen_scan = excluded.seen_scan,
      auto_tag_version = CASE WHEN ${unchanged} THEN library_files.auto_tag_version ELSE NULL END,
      width = CASE WHEN excluded.width IS NOT NULL THEN excluded.width WHEN ${unchanged} THEN library_files.width ELSE NULL END,
      height = CASE WHEN excluded.height IS NOT NULL THEN excluded.height WHEN ${unchanged} THEN library_files.height ELSE NULL END`)
    this.db.exec('BEGIN')
    try {
      for (const file of batch) {
        const relativePath = relative(folder.path, file.path)
        statement.run(randomUUID(), folder.id, file.path, relativePath, directoryOf(relativePath), file.name, file.kind,
          extname(file.name).slice(1).toLowerCase(), file.size, file.modifiedAt, scanId, file.width ?? null, file.height ?? null)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  finishScan(folderId: string, scanId: string): void {
    this.db.prepare('DELETE FROM library_files WHERE folder_id = ? AND seen_scan != ?').run(folderId, scanId)
  }

  file(id: string): (FileRow & { folderPath: string }) | undefined {
    return this.db.prepare(`SELECT m.*, f.path AS folderPath FROM library_files m
      JOIN library_folders f ON f.id = m.folder_id WHERE m.id = ?`).get(id) as (FileRow & { folderPath: string }) | undefined
  }

  pendingVideoDimensions(limit: number): Array<{ id: string; path: string; folderPath: string }> {
    return this.db.prepare(`SELECT m.id, m.path, f.path AS folderPath FROM library_files m
      JOIN library_folders f ON f.id = m.folder_id WHERE m.kind = 'video' AND m.width IS NULL LIMIT ?`).all(limit) as Array<{ id: string; path: string; folderPath: string }>
  }

  setDimensions(id: string, dimensions: { width: number; height: number }): void {
    this.db.prepare('UPDATE library_files SET width = ?, height = ? WHERE id = ?').run(dimensions.width, dimensions.height, id)
  }

  removeFile(id: string): void { this.db.prepare('DELETE FROM library_files WHERE id = ?').run(id) }

  setTags(id: string, tags: string[]): void {
    if (!this.file(id)) throw new Error('File not found')
    const sources = new Map((this.db.prepare('SELECT tag, source FROM library_tags WHERE file_id = ?').all(id) as Array<{ tag: string; source: string }>)
      .map((row) => [row.tag, row.source]))
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM library_tags WHERE file_id = ?').run(id)
      const insert = this.db.prepare('INSERT INTO library_tags (file_id, tag, source) VALUES (?, ?, ?)')
      for (const tag of tags) insert.run(id, tag, sources.get(tag) ?? 'user')
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  search(query: LibraryQuery): LibraryPage {
    const where: string[] = []
    const args: Array<string | number> = []
    const searchText = query.search?.trim() ?? ''
    const searching = searchText.length > 0
    const browsing = !!query.folderId && query.directory !== undefined && !searching
    if (query.folderId) { where.push('m.folder_id = ?'); args.push(query.folderId) }
    if (query.folderId && query.directory) {
      where.push(browsing ? 'm.directory = ?' : "(m.directory = ? OR m.directory LIKE ? ESCAPE '\\')")
      args.push(query.directory)
      if (!browsing) args.push(`${escapeLike(query.directory)}/%`)
    } else if (browsing) { where.push("m.directory = ''") }
    if (query.kind) { where.push('m.kind = ?'); args.push(query.kind) }
    if (query.tag) { where.push('EXISTS (SELECT 1 FROM library_tags t WHERE t.file_id = m.id AND t.tag = ?)'); args.push(query.tag) }
    if (searching) {
      where.push(`(m.name LIKE ? ESCAPE '\\' OR m.relative_path LIKE ? ESCAPE '\\' OR EXISTS
        (SELECT 1 FROM library_tags t WHERE t.file_id = m.id AND t.tag LIKE ? ESCAPE '\\'))`)
      const pattern = like(searchText)
      args.push(pattern, pattern, pattern)
    }
    const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const subfolders = browsing ? this.subfolders(query) : []
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM library_files m ${filter}`).get(...args) as { count: number }).count
    const limit = Math.min(100, Math.max(1, query.limit ?? 48))
    const offset = Math.max(0, query.offset ?? 0)
    const order = browsing ? 'm.name COLLATE NOCASE ASC' : 'm.modified_at DESC, m.name ASC'
    const rows = this.db.prepare(`SELECT m.* FROM library_files m ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset) as FileRow[]
    const tagQuery = this.db.prepare('SELECT tag FROM library_tags WHERE file_id = ? ORDER BY tag')
    const files: LibraryFile[] = rows.map((row) => ({
      id: row.id, folderId: row.folder_id, name: row.name, relativePath: row.relative_path, directory: row.directory,
      kind: row.kind, extension: row.extension, size: row.size, modifiedAt: row.modified_at,
      width: row.width || null, height: row.height || null,
      tags: (tagQuery.all(row.id) as Array<{ tag: string }>).map((item) => item.tag)
    }))
    const tags = (this.db.prepare('SELECT DISTINCT tag FROM library_tags ORDER BY tag').all() as Array<{ tag: string }>).map((item) => item.tag)
    return { files, total, tags, subfolders }
  }

  subfolders(query: LibraryQuery): LibrarySubfolder[] {
    const parent = query.directory ?? ''
    const where = ['m.folder_id = ?']
    const args: string[] = [query.folderId!]
    if (parent) { where.push("m.directory LIKE ? ESCAPE '\\'"); args.push(`${escapeLike(parent)}/%`) } else { where.push("m.directory != ''") }
    if (query.kind) { where.push('m.kind = ?'); args.push(query.kind) }
    if (query.tag) { where.push('EXISTS (SELECT 1 FROM library_tags t WHERE t.file_id = m.id AND t.tag = ?)'); args.push(query.tag) }
    const rows = this.db.prepare(`SELECT m.directory, COUNT(*) AS count FROM library_files m WHERE ${where.join(' AND ')} GROUP BY m.directory`)
      .all(...args) as Array<{ directory: string; count: number }>
    const children = new Map<string, number>()
    for (const row of rows) {
      const rest = parent ? row.directory.slice(parent.length + 1) : row.directory
      const name = rest.split('/')[0]
      children.set(name, (children.get(name) ?? 0) + row.count)
    }
    return [...children].map(([name, fileCount]) => ({ name, path: parent ? `${parent}/${name}` : name, fileCount }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  }
}
