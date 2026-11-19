import { AppstoreOutlined, BlockOutlined, CheckCircleOutlined, CompassOutlined, PauseCircleOutlined, SearchOutlined } from '@ant-design/icons'
import { Empty, Input, Modal, Segmented, Tabs, message } from 'antd'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ModulePage } from '../../../modules/core/ModulePage'
import { getModules, modulePath } from '../../../modules/core/renderer'
import type { InstalledModule } from '../../../modules/core/types'
import { errorText } from '../errorText'
import { CatalogPanel } from './modules/CatalogPanel'
import { InstallMenu } from './modules/InstallMenu'
import { ModuleCard } from './modules/ModuleCard'

type Filter = 'all' | 'enabled' | 'disabled'

export function ModuleManagerPage({ modules }: { modules: InstalledModule[] }) {
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const registry = useMemo(() => new Map(getModules().map((module) => [module.id, module])), [])

  const enabledCount = modules.filter((module) => module.enabled).length
  const query = search.trim().toLowerCase()
  const visible = modules
    .filter((module) => filter === 'all' || (filter === 'enabled') === module.enabled)
    .filter((module) => !query || `${module.name} ${module.id} ${module.description}`.toLowerCase().includes(query))

  async function setEnabled(module: InstalledModule, enabled: boolean) {
    if (!window.desktop) return
    const apply = async () => {
      setBusyId(module.id)
      try {
        await window.desktop!.moduleManager.setEnabled(module.id, enabled)
        message.success(`${module.name} ${enabled ? 'enabled' : 'disabled'}`)
      } catch (cause) { message.error(errorText(cause)) }
      finally { setBusyId('') }
    }
    if (enabled && module.source !== 'built-in') {
      Modal.confirm({ title: `Enable ${module.name}?`, content: 'Modules with a main.cjs file run code with desktop app permissions. Enable only packages you trust.', okText: 'Enable module', onOk: apply })
    } else await apply()
  }

  function deleteModule(module: InstalledModule) {
    if (!window.desktop) return
    Modal.confirm({ title: `Delete ${module.name}?`, content: 'This removes the installed package and its saved settings from this device.', okText: 'Delete module', okButtonProps: { danger: true }, onOk: async () => {
      setBusyId(module.id)
      try { await window.desktop!.moduleManager.delete(module.id); message.success('Module deleted') }
      catch (cause) { message.error(errorText(cause)) }
      finally { setBusyId('') }
    } })
  }

  const installedTab = <>
    <div className="modules-stats">
      <div><span className="modules-stat-icon"><AppstoreOutlined /></span><strong>{modules.length}</strong><small>Installed</small></div>
      <div><span className="modules-stat-icon is-on"><CheckCircleOutlined /></span><strong>{enabledCount}</strong><small>Enabled</small></div>
      <div><span className="modules-stat-icon is-off"><PauseCircleOutlined /></span><strong>{modules.length - enabledCount}</strong><small>Disabled</small></div>
    </div>
    <div className="modules-toolbar">
      <Input allowClear prefix={<SearchOutlined />} placeholder="Search modules" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Segmented<Filter> value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]} />
      <InstallMenu disabled={!window.desktop} />
    </div>
    {visible.length > 0
      ? <div className="modules-grid">{visible.map((module) => <ModuleCard key={module.id} module={module}
        icon={registry.get(module.id)?.icon} hasSettings={!!registry.get(module.id)?.settings} busy={busyId === module.id}
        onToggle={(enabled) => void setEnabled(module, enabled)} onOpen={() => navigate(modulePath(module.id))}
        onSettings={() => navigate('/settings')} onDelete={() => deleteModule(module)} />)}</div>
      : <Empty className="modules-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={modules.length === 0 ? 'No modules installed' : 'No modules match your filters'} />}
  </>

  return <ModulePage title="Module Manager" description="Install, enable, and manage the modules in your workspace." icon={<BlockOutlined />}>
    <Tabs className="modules-tabs" items={[
      { key: 'installed', label: <span><AppstoreOutlined /> Installed</span>, children: installedTab },
      { key: 'discover', label: <span><CompassOutlined /> Discover</span>, children: <CatalogPanel installed={modules} /> }
    ]} />
  </ModulePage>
}
