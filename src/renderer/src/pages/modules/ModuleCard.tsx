import { AppstoreOutlined, DeleteOutlined, ExportOutlined, MoreOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Dropdown, Switch, Tag, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import type { InstalledModule } from '../../../../modules/core/types'

type ModuleCardProps = {
  module: InstalledModule
  icon?: ReactNode
  hasSettings: boolean
  busy: boolean
  onToggle: (enabled: boolean) => void
  onOpen: () => void
  onSettings: () => void
  onDelete: () => void
}

const sourceLabel: Record<InstalledModule['source'], { text: string; color: string }> = {
  'built-in': { text: 'Built-in', color: 'blue' },
  file: { text: 'Local package', color: 'purple' },
  url: { text: 'Online', color: 'cyan' }
}

export function ModuleCard({ module, icon, hasSettings, busy, onToggle, onOpen, onSettings, onDelete }: ModuleCardProps) {
  const source = sourceLabel[module.source]
  return <Card className={`modules-card ${module.enabled ? '' : 'is-disabled'}`}>
    <div className="modules-card-head">
      <span className="modules-card-icon">{icon ?? <AppstoreOutlined />}</span>
      <div className="modules-card-title">
        <h3 title={module.name}>{module.name}</h3>
        <span><Tag color={source.color}>{source.text}</Tag><Tag>v{module.version}</Tag></span>
      </div>
      <Tooltip title={module.enabled ? 'Disable' : 'Enable'}>
        <Switch checked={module.enabled} loading={busy} onChange={onToggle} aria-label={`${module.enabled ? 'Disable' : 'Enable'} ${module.name}`} />
      </Tooltip>
    </div>
    <p className="modules-card-description">{module.description || 'No description provided.'}</p>
    <div className="modules-card-foot">
      <code title="Module id">{module.id}</code>
      <span>
        {hasSettings && <Tooltip title="Settings"><Button type="text" size="small" icon={<SettingOutlined />} disabled={!module.enabled} onClick={onSettings} aria-label={`${module.name} settings`} /></Tooltip>}
        <Button size="small" icon={<ExportOutlined />} disabled={!module.enabled} onClick={onOpen}>Open</Button>
        {module.source !== 'built-in' && <Dropdown trigger={['click']} placement="bottomRight" menu={{
          items: [{ key: 'delete', icon: <DeleteOutlined />, label: 'Delete module', danger: true }],
          onClick: onDelete
        }}>
          <Button type="text" size="small" icon={<MoreOutlined />} disabled={busy} aria-label={`More actions for ${module.name}`} />
        </Dropdown>}
      </span>
    </div>
  </Card>
}
