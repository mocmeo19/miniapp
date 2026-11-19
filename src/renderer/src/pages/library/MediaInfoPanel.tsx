import { CloseOutlined, ExportOutlined, FolderOpenOutlined, RobotOutlined } from '@ant-design/icons'
import { Button, Select, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LibraryFile, LibraryFolder } from '../../../../library/types'
import { FileTypeIcon } from './FileTypeIcon'
import { fileSize, folderName } from './format'

export type MediaInfoActions = {
  openExternal: (file: LibraryFile) => void
  reveal: (file: LibraryFile) => void
  autoTag: (file: LibraryFile) => void
  saveTags: (file: LibraryFile, tags: string[]) => Promise<void>
}

type MediaInfoPanelProps = {
  file: LibraryFile
  folders: LibraryFolder[]
  allTags: string[]
  /** Seconds, once the video's metadata has loaded. */
  duration: number | null
  actions: MediaInfoActions
  onClose: () => void
}

function fullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
}

function clock(seconds: number): string {
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const rest = `${Math.floor((total % 3600) / 60)}:${String(total % 60).padStart(2, '0')}`
  return hours ? `${hours}:${rest.padStart(5, '0')}` : rest
}

function joinPath(folder: string, relative: string): string {
  const separator = folder.includes('\\') ? '\\' : '/'
  return `${folder}${folder.endsWith(separator) ? '' : separator}${relative.split(/[\\/]/).join(separator)}`
}

export function MediaInfoPanel({ file, folders, allTags, duration, actions, onClose }: MediaInfoPanelProps) {
  const panel = useRef<HTMLElement>(null)
  const [tags, setTags] = useState(file.tags)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setTags(file.tags) }, [file.id, file.tags])

  const folder = folders.find((item) => item.id === file.folderId)
  const path = folder ? joinPath(folder.path, file.relativePath) : file.relativePath
  const location = [folder ? folderName(folder.path) : null, ...(file.directory ? file.directory.split('/') : [])].filter(Boolean).join(' / ')
  const changed = tags.join('\n') !== file.tags.join('\n')
  const details: Array<[string, string]> = [
    ['Type', `${file.kind === 'image' ? 'Photo' : 'Video'} · ${file.extension.toUpperCase()}`],
    ...(file.width && file.height ? [['Dimensions', `${file.width} × ${file.height}${file.kind === 'image' ? ` · ${(file.width * file.height / 1e6).toFixed(1)} MP` : ''}`] as [string, string]] : []),
    ...(file.kind === 'video' && duration ? [['Duration', clock(duration)] as [string, string]] : []),
    ['Size', fileSize(file.size)],
    ['Modified', fullDate(file.modifiedAt)],
    ['Location', location || '—']
  ]

  async function save() {
    setSaving(true)
    try { await actions.saveTags(file, tags) } finally { setSaving(false) }
  }

  // Rendered above the full-screen viewer, which owns the rest of the window.
  return createPortal(<aside ref={panel} className="media-info" aria-label="Media details" onKeyDown={(event) => event.stopPropagation()}>
    <header className="media-info-head">
      <FileTypeIcon kind={file.kind} />
      <h2 title={file.name}>{file.name}</h2>
      <Button type="text" shape="circle" icon={<CloseOutlined />} aria-label="Hide details" onClick={onClose} />
    </header>

    <section>
      <h3>Details</h3>
      <dl className="media-info-details">
        {details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}
      </dl>
      <Typography.Paragraph className="media-info-path" copyable={{ text: path, tooltips: ['Copy path', 'Copied'] }}>{path}</Typography.Paragraph>
    </section>

    <section>
      <h3>Tags</h3>
      <Select mode="tags" className="media-info-tags" value={tags} onChange={setTags} tokenSeparators={[',']} maxCount={20} placeholder="Add tags"
        options={allTags.map((item) => ({ value: item, label: item }))} getPopupContainer={() => panel.current ?? document.body} />
      <div className="media-info-tag-actions">
        {file.kind === 'image' && <Button size="small" icon={<RobotOutlined />} onClick={() => actions.autoTag(file)}>Auto-tag</Button>}
        {changed && <Button size="small" onClick={() => setTags(file.tags)}>Reset</Button>}
        {changed && <Button size="small" type="primary" loading={saving} onClick={() => void save()}>Save tags</Button>}
      </div>
    </section>

    <footer className="media-info-actions">
      <Button icon={<ExportOutlined />} onClick={() => actions.openExternal(file)}>Open in default app</Button>
      <Button icon={<FolderOpenOutlined />} onClick={() => actions.reveal(file)}>Show in folder</Button>
    </footer>
  </aside>, document.body)
}
