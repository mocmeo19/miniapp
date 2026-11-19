import { protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { MainModule } from '../core/main'
import { notesImageScheme, type Note, type NoteSummary } from './types'

type Row = { id: string; title: string; content: string; text: string; pinned: number; created_at: number; updated_at: number }

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/
const imageName = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.(png|jpg|gif|webp)$/
const imageRefs = new RegExp(`${notesImageScheme}://image/([a-f\\d-]{36}\\.(?:png|jpg|gif|webp))`, 'g')
const imageTypes: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const contentTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const maxImage = 20 * 1024 * 1024
const maxContent = 5 * 1024 * 1024
const day = 24 * 60 * 60 * 1000

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Invalid note')
  return value
}

// The declared type must match the file's own signature, so a renamed file cannot pose as an image.
function sniff(data: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'webp'
  return null
}

const summary = (row: Pick<Row, 'id' | 'title' | 'text' | 'pinned' | 'updated_at'>): NoteSummary =>
  ({ id: row.id, title: row.title, preview: row.text.slice(0, 160).replace(/\s+/g, ' ').trim(), pinned: row.pinned === 1, updatedAt: row.updated_at })

export const notesMainModule: MainModule = {
  id: 'notes',
  register({ handle, paths }) {
    let db: DatabaseSync | null = null
    let dbPath = ''
    let swept = false

    // The data folder can change while the app runs, so the database follows it.
    function database(): DatabaseSync {
      const path = join(paths.data(), 'notes.db')
      if (db && path === dbPath) return db
      db?.close()
      db = new DatabaseSync(path)
      dbPath = path
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL DEFAULT '',
          pinned INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notes_order ON notes(pinned DESC, updated_at DESC);
      `)
      if (!swept) { swept = true; void sweepImages().catch(() => undefined) }
      return db
    }

    function find(id: string): Row {
      const row = database().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
      if (!row) throw new Error('Note not found')
      return row
    }

    const full = (row: Row): Note => ({ ...summary(row), content: row.content, createdAt: row.created_at })

    // Pasted images that no note uses any more (deleted text, closed without saving) are removed after a day.
    async function sweepImages(): Promise<void> {
      const folder = paths.data('images')
      const used = new Set<string>()
      for (const row of database().prepare('SELECT content FROM notes').all() as Pick<Row, 'content'>[]) {
        for (const match of row.content.matchAll(imageRefs)) used.add(match[1])
      }
      for (const name of await readdir(folder)) {
        if (!imageName.test(name) || used.has(name)) continue
        const info = await stat(join(folder, name))
        if (Date.now() - info.mtimeMs > day) await unlink(join(folder, name))
      }
    }

    protocol.handle(notesImageScheme, async (request) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const name = url.pathname.slice(1)
      if (url.hostname !== 'image' || !imageName.test(name)) return new Response(null, { status: 404 })
      try {
        const data = await readFile(join(paths.data('images'), name))
        return new Response(data, { headers: { 'Content-Type': contentTypes[name.split('.').pop()!], 'Cache-Control': 'max-age=31536000, immutable' } })
      } catch { return new Response(null, { status: 404 }) }
    })

    handle('list', (_event, value) => {
      const query = typeof value === 'string' ? value.trim().slice(0, 200) : ''
      const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
      const rows = database().prepare(`SELECT id, title, text, pinned, updated_at FROM notes
        WHERE ? = '' OR title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\'
        ORDER BY pinned DESC, updated_at DESC LIMIT 1000`).all(query, like, like) as Row[]
      return rows.map(summary)
    })
    handle('get', (_event, value) => full(find(requireId(value))))
    handle('create', () => {
      const now = Date.now()
      const id = randomUUID()
      database().prepare('INSERT INTO notes (id, created_at, updated_at) VALUES (?, ?, ?)').run(id, now, now)
      return full(find(id))
    })
    handle('update', (_event, value) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid note')
      const input = value as Record<string, unknown>
      const row = find(requireId(input.id))
      const title = typeof input.title === 'string' ? input.title.slice(0, 200) : row.title
      const content = typeof input.content === 'string' ? input.content : row.content
      const text = typeof input.text === 'string' ? input.text.slice(0, 1_000_000) : row.text
      const pinned = typeof input.pinned === 'boolean' ? (input.pinned ? 1 : 0) : row.pinned
      if (content.length > maxContent) throw new Error('This note is too large to save')
      if (content) { try { JSON.parse(content) } catch { throw new Error('Invalid note content') } }
      // Pinning is not an edit, so it keeps the note's place in the list.
      const edited = title !== row.title || content !== row.content
      const updatedAt = edited ? Date.now() : row.updated_at
      database().prepare('UPDATE notes SET title = ?, content = ?, text = ?, pinned = ?, updated_at = ? WHERE id = ?').run(title, content, text, pinned, updatedAt, row.id)
      return summary({ id: row.id, title, text, pinned, updated_at: updatedAt })
    })
    handle('delete', async (_event, value) => {
      const row = find(requireId(value))
      database().prepare('DELETE FROM notes WHERE id = ?').run(row.id)
      const names = new Set([...row.content.matchAll(imageRefs)].map((match) => match[1]))
      const folder = paths.data('images')
      for (const name of names) {
        const stillUsed = database().prepare('SELECT 1 FROM notes WHERE content LIKE ? LIMIT 1').get(`%${name}%`)
        if (!stillUsed) await unlink(join(folder, name)).catch(() => undefined)
      }
    })
    handle('save-image', async (_event, value) => {
      const input = value as { data?: unknown; type?: unknown } | null
      if (!(input?.data instanceof Uint8Array)) throw new Error('Invalid image')
      if (input.data.byteLength > maxImage) throw new Error('Images can be at most 20 MB')
      const declared = typeof input.type === 'string' ? imageTypes[input.type] : undefined
      const actual = sniff(input.data)
      if (!actual || (declared && declared !== actual)) throw new Error('Only PNG, JPEG, GIF and WebP images can be pasted')
      const name = `${randomUUID()}.${actual}`
      await writeFile(join(paths.data('images'), name), input.data)
      return `${notesImageScheme}://image/${name}`
    })

    return () => {
      protocol.unhandle(notesImageScheme)
      db?.close()
      db = null
    }
  }
}
