import { EditOutlined, FileTextOutlined, PlusOutlined, PushpinFilled, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Input, Spin, message } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { RendererModule } from '../core/renderer'
import { NoteEditor } from './NoteEditor'
import type { Note, NoteSummary } from './types'

const lastKey = 'miniapp-notes-last'
const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
const invoke = <T,>(action: string, payload?: unknown) => window.desktop!.modules.invoke<T>('notes', action, payload)
const sortNotes = (notes: NoteSummary[]) => [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)

function when(time: number): string {
  const date = new Date(time)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function remember(id: string | null) {
  try { if (id) localStorage.setItem(lastKey, id); else localStorage.removeItem(lastKey) } catch { /* storage unavailable */ }
}

function NotesPage() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [current, setCurrent] = useState<Note | null>(null)
  const [opening, setOpening] = useState(false)
  const first = useRef(true)

  async function open(id: string) {
    if (current?.id === id) return
    setOpening(true)
    try {
      const note = await invoke<Note>('get', id)
      setCurrent(note)
      remember(note.id)
    } catch (cause) { message.error(errorText(cause)) } finally { setOpening(false) }
  }

  useEffect(() => {
    if (!window.desktop) { setLoading(false); return }
    let active = true
    const timer = window.setTimeout(() => {
      void invoke<NoteSummary[]>('list', query).then((list) => {
        if (!active) return
        setNotes(list)
        setLoading(false)
        if (first.current) {
          first.current = false
          let last: string | null = null
          try { last = localStorage.getItem(lastKey) } catch { /* storage unavailable */ }
          const target = list.find((item) => item.id === last) ?? list[0]
          if (target) void open(target.id)
        }
      }).catch((cause: unknown) => { if (active) { setLoading(false); message.error(errorText(cause)) } })
    }, first.current ? 0 : 200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [query])

  async function create() {
    try {
      const note = await invoke<Note>('create')
      setQuery('')
      setNotes((list) => sortNotes([note, ...list]))
      setCurrent(note)
      remember(note.id)
    } catch (cause) { message.error(errorText(cause)) }
  }

  async function remove(id: string) {
    try {
      await invoke('delete', id)
      const index = notes.findIndex((item) => item.id === id)
      const rest = notes.filter((item) => item.id !== id)
      setNotes(rest)
      const next = rest[Math.min(index, rest.length - 1)]
      setCurrent(null)
      remember(null)
      if (next) void open(next.id)
      message.success('Note deleted')
    } catch (cause) { message.error(errorText(cause)) }
  }

  function saved(summary: NoteSummary) {
    setNotes((list) => sortNotes(list.some((item) => item.id === summary.id) ? list.map((item) => item.id === summary.id ? summary : item) : [summary, ...list]))
  }

  return <div className="notes-page">
    <aside className="notes-sidebar">
      <div className="notes-sidebar-head">
        <div><h1>Notes</h1><span>{notes.length} {notes.length === 1 ? 'note' : 'notes'}{query ? ' found' : ''}</span></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => void create()} disabled={!window.desktop}>New</Button>
      </div>
      <Input allowClear prefix={<SearchOutlined />} placeholder="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} className="notes-search" aria-label="Search notes" />
      <div className="notes-list" role="listbox" aria-label="Notes">
        {loading ? <div className="notes-list-empty"><Spin /></div>
          : notes.length === 0 ? <div className="notes-list-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? 'No notes match your search' : 'No notes yet'} /></div>
          : notes.map((item) => {
            const active = item.id === current?.id
            return <button key={item.id} type="button" role="option" aria-selected={active} className={`notes-item${active ? ' active' : ''}`} onClick={() => void open(item.id)}>
              <span className="notes-item-top"><strong>{item.title || 'Untitled'}</strong>{item.pinned && <PushpinFilled aria-label="Pinned" />}</span>
              <span className="notes-item-preview"><time>{when(item.updatedAt)}</time>{item.preview || 'No additional text'}</span>
            </button>
          })}
      </div>
    </aside>
    <section className="notes-main" aria-busy={opening}>
      {!window.desktop && <Alert type="warning" showIcon title="Open the Electron app to write notes." className="m-6" />}
      {current
        ? <NoteEditor key={current.id} note={current} onSaved={saved} onDelete={() => void remove(current.id)} />
        : !loading && window.desktop && <div className="notes-empty">
          <div className="notes-empty-icon"><FileTextOutlined /></div>
          <h2>{notes.length ? 'Pick a note' : 'Write your first note'}</h2>
          <p>Headings, checklists, links and images — paste a screenshot straight into the page.</p>
          <Button type="primary" icon={<EditOutlined />} onClick={() => void create()}>New note</Button>
        </div>}
    </section>
  </div>
}

export const notesRendererModule: RendererModule = {
  id: 'notes',
  label: 'Notes',
  icon: <FileTextOutlined />,
  element: <NotesPage />
}
