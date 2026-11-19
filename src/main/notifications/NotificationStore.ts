import { DatabaseSync } from 'node:sqlite'
import type { AppNotification, NotificationKind } from '../../notifications/types'

type Row = { id: string; title: string; body: string | null; kind: NotificationKind; source: string; link: string | null; created_at: number; read: number }

const maxStored = 200

export class NotificationStore {
  private readonly db: DatabaseSync

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        link TEXT,
        created_at INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at DESC);
    `)
  }

  close(): void { this.db.close() }

  list(): AppNotification[] {
    return (this.db.prepare('SELECT * FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT ?').all(maxStored) as Row[])
      .map((row) => ({ id: row.id, title: row.title, body: row.body, kind: row.kind, source: row.source, link: row.link, createdAt: row.created_at, read: row.read === 1 }))
  }

  insert(item: AppNotification): void {
    this.db.prepare('INSERT INTO notifications (id, title, body, kind, source, link, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.title, item.body, item.kind, item.source, item.link, item.createdAt, item.read ? 1 : 0)
    this.db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC, rowid DESC LIMIT ?)').run(maxStored)
  }

  markRead(id: string): void { this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id) }

  markAllRead(): void { this.db.exec('UPDATE notifications SET read = 1') }

  clear(): void { this.db.exec('DELETE FROM notifications') }
}
