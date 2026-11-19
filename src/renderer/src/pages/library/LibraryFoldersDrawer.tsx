import { DeleteOutlined, FolderAddOutlined, FolderFilled, ReloadOutlined } from '@ant-design/icons'
import { Button, Drawer, Empty, Popconfirm, Tooltip, Typography } from 'antd'
import type { AutoTagStatus, LibraryFolder } from '../../../../library/types'
import { AutoTagPanel } from './AutoTagPanel'
import { folderName } from './format'

type LibraryFoldersDrawerProps = {
  open: boolean
  folders: LibraryFolder[]
  busy: boolean
  scanningId?: string
  onClose: () => void
  onAdd: () => void
  onRescan: (id: string) => void
  onRemove: (id: string) => void
  autoTag: AutoTagStatus | null
  onToggleAutoTag: (enabled: boolean) => void
  onClearAutoTags: () => void
}

function addedDate(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function LibraryFoldersDrawer({ open, folders, busy, scanningId, onClose, onAdd, onRescan, onRemove, autoTag, onToggleAutoTag, onClearAutoTags }: LibraryFoldersDrawerProps) {
  return <Drawer className="library-folders-drawer" open={open} onClose={onClose} width={520} title="Library folders"
    footer={<>
      <Button icon={<ReloadOutlined />} disabled={busy || folders.length === 0} onClick={() => onRescan('all')}>Rescan all</Button>
      <Button type="primary" icon={<FolderAddOutlined />} loading={busy} onClick={onAdd}>Add folders</Button>
    </>}>
    <p className="library-folders-help">Library indexes images and videos inside these folders, including nested folders. Removing a folder only removes it from Library; files stay on disk.</p>
    {folders.length === 0
      ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No folders yet" />
      : <ul className="library-folders-list">{folders.map((folder) => <li key={folder.id}>
        <FolderFilled className="library-folders-icon" />
        <div className="library-folders-copy">
          <strong>{folderName(folder.path)}</strong>
          <Typography.Text type="secondary" copyable={{ text: folder.path }} ellipsis={{ tooltip: folder.path }}>{folder.path}</Typography.Text>
          <small>{folder.fileCount.toLocaleString()} files · added {addedDate(folder.addedAt)}</small>
        </div>
        <Tooltip title="Rescan">
          <Button type="text" shape="circle" icon={<ReloadOutlined spin={scanningId === folder.id} />} disabled={busy} onClick={() => onRescan(folder.id)} aria-label={`Rescan ${folder.path}`} />
        </Tooltip>
        <Popconfirm placement="left" title="Remove folder from Library?" description="Files on disk will not be deleted." okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => onRemove(folder.id)}>
          <Button type="text" shape="circle" danger icon={<DeleteOutlined />} disabled={busy} aria-label={`Remove ${folder.path}`} />
        </Popconfirm>
      </li>)}</ul>}
    <AutoTagPanel status={autoTag} onToggle={onToggleAutoTag} onClear={onClearAutoTags} />
  </Drawer>
}
