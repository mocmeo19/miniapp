import {
  BoldOutlined, CheckSquareOutlined, CodeOutlined, DeleteOutlined, ItalicOutlined, LineOutlined, LinkOutlined,
  OrderedListOutlined, PictureOutlined, PushpinFilled, PushpinOutlined, RedoOutlined, StrikethroughOutlined,
  UnderlineOutlined, UndoOutlined, UnorderedListOutlined
} from '@ant-design/icons'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Button, Divider, Input, Popconfirm, Popover, Tooltip, message } from 'antd'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MonacoCodeBlock } from './MonacoCodeBlock'
import type { Note, NoteSummary } from './types'

const errorText = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(cause)
const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

async function uploadImage(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  return window.desktop!.modules.invoke<string>('notes', 'save-image', { data, type: file.type })
}

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => imageTypes.includes(file.type))
}

function ToolButton({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <Tooltip title={title} mouseEnterDelay={0.4}>
    <button type="button" className={`note-tool${active ? ' active' : ''}`} aria-label={title} aria-pressed={active} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>
  </Tooltip>
}

function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  function apply() {
    const value = url.trim()
    const chain = editor.chain().focus().extendMarkRange('link')
    if (!value) chain.unsetLink().run()
    else chain.setLink({ href: /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}` }).run()
    setOpen(false)
  }
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setUrl((editor.getAttributes('link').href as string | undefined) ?? '') }} trigger="click" placement="bottom"
    content={<div className="flex gap-2"><Input size="small" autoFocus placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={apply} className="w-60" /><Button size="small" type="primary" onClick={apply}>{url.trim() ? 'Apply' : 'Remove'}</Button></div>}>
    <span><ToolButton title="Link" active={active} onClick={() => undefined}><LinkOutlined /></ToolButton></span>
  </Popover>
}

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), strike: current.isActive('strike'),
      code: current.isActive('code'), link: current.isActive('link'),
      h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
      bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), task: current.isActive('taskList'),
      quote: current.isActive('blockquote'), codeBlock: current.isActive('codeBlock'),
      canUndo: current.can().undo(), canRedo: current.can().redo()
    })
  })
  const chain = () => editor.chain().focus()
  return <div className="note-toolbar" role="toolbar" aria-label="Formatting">
    <ToolButton title="Undo (⌘Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()}><UndoOutlined /></ToolButton>
    <ToolButton title="Redo (⇧⌘Z)" disabled={!state.canRedo} onClick={() => chain().redo().run()}><RedoOutlined /></ToolButton>
    <Divider orientation="vertical" />
    <ToolButton title="Heading 1" active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}><b>H1</b></ToolButton>
    <ToolButton title="Heading 2" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><b>H2</b></ToolButton>
    <ToolButton title="Heading 3" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}><b>H3</b></ToolButton>
    <Divider orientation="vertical" />
    <ToolButton title="Bold (⌘B)" active={state.bold} onClick={() => chain().toggleBold().run()}><BoldOutlined /></ToolButton>
    <ToolButton title="Italic (⌘I)" active={state.italic} onClick={() => chain().toggleItalic().run()}><ItalicOutlined /></ToolButton>
    <ToolButton title="Underline (⌘U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}><UnderlineOutlined /></ToolButton>
    <ToolButton title="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><StrikethroughOutlined /></ToolButton>
    <ToolButton title="Inline code" active={state.code} onClick={() => chain().toggleCode().run()}><CodeOutlined /></ToolButton>
    <LinkButton editor={editor} active={state.link} />
    <Divider orientation="vertical" />
    <ToolButton title="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}><UnorderedListOutlined /></ToolButton>
    <ToolButton title="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}><OrderedListOutlined /></ToolButton>
    <ToolButton title="Checklist" active={state.task} onClick={() => chain().toggleTaskList().run()}><CheckSquareOutlined /></ToolButton>
    <ToolButton title="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}><span className="note-tool-glyph">❝</span></ToolButton>
    <ToolButton title="Code block" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><span className="note-tool-glyph font-mono">{'{}'}</span></ToolButton>
    <ToolButton title="Divider" onClick={() => chain().setHorizontalRule().run()}><LineOutlined /></ToolButton>
    <Divider orientation="vertical" />
    <ToolButton title="Insert image" onClick={onPickImage}><PictureOutlined /></ToolButton>
  </div>
}

type SaveState = 'saved' | 'saving' | 'error'
type Pending = { title?: string; content?: string; text?: string }

export function NoteEditor({ note, onSaved, onDelete }: { note: Note; onSaved: (note: NoteSummary) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(note.title)
  const [pinned, setPinned] = useState(note.pinned)
  const [updatedAt, setUpdatedAt] = useState(note.updatedAt)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [uploading, setUploading] = useState(0)
  const editorRef = useRef<Editor | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Changes are captured as they happen, so they can still be saved after the editor is gone.
  const pending = useRef<Pending>({})
  const timer = useRef<number | undefined>(undefined)
  const savedCallback = useRef(onSaved)
  savedCallback.current = onSaved

  function flush(): void {
    window.clearTimeout(timer.current)
    const change = pending.current
    if (Object.keys(change).length === 0) return
    pending.current = {}
    setSaveState('saving')
    void window.desktop!.modules.invoke<NoteSummary>('notes', 'update', { id: note.id, ...change }).then((summary) => {
      setUpdatedAt(summary.updatedAt)
      setSaveState('saved')
      savedCallback.current(summary)
    }).catch((cause: unknown) => {
      setSaveState('error')
      message.error(errorText(cause))
    })
  }

  function schedule(change: Pending) {
    pending.current = { ...pending.current, ...change }
    setSaveState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 600)
  }

  // Save whatever is still pending when the note is closed or another one is opened.
  useEffect(() => flush, [])

  async function insertImages(files: File[], position?: number) {
    if (files.length === 0) return
    setUploading((count) => count + files.length)
    for (const file of files) {
      try {
        const src = await uploadImage(file)
        const editor = editorRef.current
        if (!editor || editor.isDestroyed) return
        const node = { type: 'image', attrs: { src, alt: file.name || 'Pasted image' } }
        if (position === undefined) editor.chain().focus().insertContent(node).run()
        else editor.chain().focus().insertContentAt(position, node).run()
      } catch (cause) { message.error(errorText(cause)) } finally { setUploading((count) => count - 1) }
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
      MonacoCodeBlock,
      // Drag a corner or side to resize; the width and height are saved with the note.
      Image.configure({ allowBase64: false, resize: { enabled: true, directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'], minWidth: 60, minHeight: 40, alwaysPreserveAspectRatio: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing… paste or drop images straight in.' })
    ],
    content: note.content ? JSON.parse(note.content) as object : '',
    editorProps: {
      attributes: { class: 'note-prose', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files)
        if (files.length === 0) return false
        event.preventDefault()
        void insertImages(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = moved ? [] : imageFiles(event.dataTransfer?.files)
        if (files.length === 0) return false
        event.preventDefault()
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImages(files, position)
        return true
      }
    },
    onUpdate: ({ editor: current }) => schedule({ content: JSON.stringify(current.getJSON()), text: current.getText({ blockSeparator: '\n' }) })
  })
  editorRef.current = editor

  async function togglePin() {
    const next = !pinned
    setPinned(next)
    try { savedCallback.current(await window.desktop!.modules.invoke<NoteSummary>('notes', 'update', { id: note.id, pinned: next })) }
    catch (cause) { setPinned(!next); message.error(errorText(cause)) }
  }

  const status = uploading > 0 ? 'Saving image…' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : `Saved ${new Date(updatedAt).toDateString() === new Date().toDateString() ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`

  return <div className="note-editor">
    <div className="note-editor-head">
      {editor ? <Toolbar editor={editor} onPickImage={() => fileInput.current?.click()} /> : <div />}
      <div className="note-editor-actions">
        <span className={`note-status${saveState === 'error' ? ' error' : ''}`} aria-live="polite">{status}</span>
        <Tooltip title={pinned ? 'Unpin' : 'Pin to top'}><Button type="text" icon={pinned ? <PushpinFilled /> : <PushpinOutlined />} className={pinned ? 'text-(--accent)!' : ''} onClick={() => void togglePin()} aria-label={pinned ? 'Unpin note' : 'Pin note'} /></Tooltip>
        <Popconfirm placement="bottomRight" title="Delete this note?" description="Images in the note are deleted too." okText="Delete" okButtonProps={{ danger: true }} onConfirm={onDelete}>
          <Tooltip title="Delete"><Button type="text" danger icon={<DeleteOutlined />} aria-label="Delete note" /></Tooltip>
        </Popconfirm>
      </div>
    </div>
    <input ref={fileInput} type="file" accept={imageTypes.join(',')} multiple hidden onChange={(event) => { void insertImages(imageFiles(event.target.files)); event.target.value = '' }} />
    {/* Clicking the empty space below the text puts the cursor at the end of the note. */}
    <div className="note-scroll" onMouseDown={(event) => {
      if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('note-page')) { event.preventDefault(); editor?.commands.focus('end') }
    }}>
      <div className="note-page">
        <Input.TextArea className="note-title" variant="borderless" autoSize placeholder="Untitled" maxLength={200} value={title} aria-label="Note title"
          onChange={(event) => { const value = event.target.value.replace(/\n/g, ''); setTitle(value); schedule({ title: value }) }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); editor?.commands.focus('start') } }} />
        <EditorContent editor={editor} className="note-content" />
      </div>
    </div>
  </div>
}
