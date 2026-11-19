import { DatabaseSync } from 'node:sqlite'
import type { DownloadItem, DownloadStatus } from '../../downloads/types'

type Row = {
  id: string; url: string; file_name: string; custom_name: number; path: string | null; folder: string; owner: string; status: DownloadStatus
  received: number; total: number | null; error: string | null; created_at: number; finished_at: number | null
}

export type StoredDownload = Omit<DownloadItem, 'speed'> & {
  folder: string
  /** True when the caller chose the file name, so the server's suggestion is ignored. */
  customName: boolean
}

const maxHistory = 500

function fromRow(row: Row): StoredDownload {
  return {
    id: row.id, url: row.url, fileName: row.file_name, customName: row.custom_name === 1, path: row.path, folder: row.folder, owner: row.owner,
    status: row.status, received: row.received, total: row.total, error: row.error, createdAt: row.created_at, finishedAt: row.finished_at
  }
}

export class DownloadStore {
  private readonly db: DatabaseSync

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        file_name TEXT NOT NULL,
        custom_name INTEGER NOT NULL DEFAULT 0,
        path TEXT,
        folder TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL,
        received INTEGER NOT NULL DEFAULT 0,
        total INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS downloads_created ON downloads(created_at DESC);
    `)
    // Transfers cannot survive a restart; offer them for retry instead.
    this.db.prepare("UPDATE downloads SET status = 'failed', error = 'Interrupted when the app closed', finished_at = ? WHERE status IN ('queued', 'running')").run(Date.now())
  }

  close(): void { this.db.close() }

  list(): StoredDownload[] {
    return (this.db.prepare('SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?').all(maxHistory) as Row[]).map(fromRow)
  }

  get(id: string): StoredDownload | undefined {
    const row = this.db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as Row | undefined
    return row ? fromRow(row) : undefined
  }

  nextQueued(): StoredDownload | undefined {
    const row = this.db.prepare("SELECT * FROM downloads WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as Row | undefined
    return row ? fromRow(row) : undefined
  }

  insert(item: StoredDownload): void {
    this.db.prepare(`INSERT INTO downloads (id, url, file_name, custom_name, path, folder, owner, status, received, total, error, created_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(item.id, item.url, item.fileName, item.customName ? 1 : 0, item.path, item.folder, item.owner,
      item.status, item.received, item.total, item.error, item.createdAt, item.finishedAt)
    this.db.prepare(`DELETE FROM downloads WHERE id NOT IN (SELECT id FROM downloads ORDER BY created_at DESC LIMIT ?)
      AND status NOT IN ('queued', 'running')`).run(maxHistory)
  }

  update(id: string, patch: Partial<Pick<StoredDownload, 'fileName' | 'path' | 'status' | 'received' | 'total' | 'error' | 'finishedAt'>>): void {
    const columns: Record<string, string> = { fileName: 'file_name', path: 'path', status: 'status', received: 'received', total: 'total', error: 'error', finishedAt: 'finished_at' }
    const entries = Object.entries(patch).filter(([key]) => key in columns)
    if (entries.length === 0) return
    this.db.prepare(`UPDATE downloads SET ${entries.map(([key]) => `${columns[key]} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, value]) => (value ?? null) as string | number | null), id)
  }

  remove(id: string): void { this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id) }

  clearFinished(): void { this.db.exec("DELETE FROM downloads WHERE status IN ('completed', 'failed', 'cancelled')") }
}
