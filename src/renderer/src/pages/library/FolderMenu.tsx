import { RobotOutlined } from '@ant-design/icons'
import { Dropdown } from 'antd'
import type { ReactNode } from 'react'

export function FolderContextMenu({ onAutoTag, children }: { onAutoTag: () => void; children: ReactNode }) {
  return <Dropdown trigger={['contextMenu']} menu={{
    items: [{ key: 'auto-tag', icon: <RobotOutlined />, label: 'Auto-tag photos' }],
    onClick: ({ domEvent }) => { domEvent.stopPropagation(); onAutoTag() }
  }}>{children}</Dropdown>
}
