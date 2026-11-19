import { DeleteOutlined, EyeOutlined, ExportOutlined, MoreOutlined, RobotOutlined, TagsOutlined } from '@ant-design/icons'
import { Button, Dropdown, Modal, type MenuProps } from 'antd'
import type { ReactNode } from 'react'
import type { LibraryFile } from '../../../../library/types'

export type FileActions = {
  view: (file: LibraryFile) => void
  openExternal: (file: LibraryFile) => void
  editTags: (file: LibraryFile) => void
  autoTag: (file: LibraryFile) => void
  remove: (file: LibraryFile) => void
}

function menuFor(file: LibraryFile, actions: FileActions): MenuProps {
  const confirmRemove = () => Modal.confirm({
    title: 'Move file to Trash?',
    content: `"${file.name}" will be removed from disk and Library.`,
    okText: 'Move to Trash',
    okButtonProps: { danger: true },
    onOk: () => actions.remove(file)
  })
  return {
    items: [
      { key: 'view', icon: <EyeOutlined />, label: 'Preview', onClick: () => actions.view(file) },
      { key: 'open', icon: <ExportOutlined />, label: 'Open in default app', onClick: () => actions.openExternal(file) },
      { key: 'tags', icon: <TagsOutlined />, label: 'Edit tags', onClick: () => actions.editTags(file) },
      ...(file.kind === 'image' ? [{ key: 'auto-tag', icon: <RobotOutlined />, label: 'Auto-tag', onClick: () => actions.autoTag(file) }] : []),
      { type: 'divider' },
      { key: 'remove', icon: <DeleteOutlined />, label: 'Move to Trash', danger: true, onClick: confirmRemove }
    ],
    onClick: ({ domEvent }) => domEvent.stopPropagation()
  }
}

export function FileContextMenu({ file, actions, children }: { file: LibraryFile; actions: FileActions; children: ReactNode }) {
  return <Dropdown trigger={['contextMenu']} menu={menuFor(file, actions)}>{children}</Dropdown>
}

export function FileMenuButton({ file, actions }: { file: LibraryFile; actions: FileActions }) {
  return <Dropdown trigger={['click']} menu={menuFor(file, actions)} placement="bottomRight">
    <Button type="text" shape="circle" size="small" icon={<MoreOutlined />} aria-label={`Actions for ${file.name}`} onClick={(event) => event.stopPropagation()} />
  </Dropdown>
}
