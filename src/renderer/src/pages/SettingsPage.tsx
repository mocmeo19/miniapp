import { AppstoreOutlined, BgColorsOutlined, CheckCircleFilled, CopyOutlined, DatabaseOutlined, InfoCircleOutlined, PictureOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Tag, Tooltip, message } from 'antd'
import { useEffect, useState, type ReactNode } from 'react'
import { ModulePage } from '../../../modules/core/ModulePage'
import { getModules } from '../../../modules/core/renderer'
import type { InstalledModule } from '../../../modules/core/types'
import { useTheme } from '../theme/ThemeProvider'
import { AutoTagModelsCard } from './AutoTagModelsCard'
import { DataFolderCard } from './DataFolderCard'

type Section = { id: string; label: string; description: string; icon: ReactNode; content: ReactNode }

function CopyPath({ path }: { path: string }) {
  async function copy() {
    try { await navigator.clipboard.writeText(path); message.success('Path copied') } catch { message.error('Could not copy the path') }
  }
  return <div className="settings-path-box">
    <code title={path}>{path || 'Loading…'}</code>
    <Tooltip title="Copy path"><Button type="text" size="small" icon={<CopyOutlined />} disabled={!path} onClick={() => void copy()} aria-label="Copy path" /></Tooltip>
  </div>
}

function ThemePicker() {
  const { mode, setMode } = useTheme()
  return <div className="theme-picker" role="radiogroup" aria-label="Theme">
    {(['light', 'dark'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={mode === value} className={`theme-option theme-option-${value}${mode === value ? ' selected' : ''}`} onClick={() => setMode(value)}>
      <span className="theme-preview" aria-hidden><span className="theme-preview-side" /><span className="theme-preview-main"><span /><span /><span /></span></span>
      <span className="theme-option-label">{value === 'light' ? 'Light' : 'Dark'}{mode === value && <CheckCircleFilled />}</span>
    </button>)}
  </div>
}

function SettingsNav({ sections, active }: { sections: Section[]; active: string }) {
  return <nav className="settings-nav" aria-label="Settings sections">
    {sections.map((section) => <button key={section.id} type="button" className={active === section.id ? 'active' : ''} aria-current={active === section.id ? 'true' : undefined}
      onClick={() => document.getElementById(`settings-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
      {section.icon}<span>{section.label}</span>
    </button>)}
  </nav>
}

export function SettingsPage({ installed }: { installed: InstalledModule[] }) {
  const [databasePath, setDatabasePath] = useState('')
  useEffect(() => { void window.desktop?.preferences.getStoragePath().then(setDatabasePath).catch(() => undefined) }, [])

  const modules = getModules().filter((module) => module.settings && installed.some((item) => item.id === module.id && item.enabled))
  const sections: Section[] = [
    { id: 'appearance', label: 'Appearance', description: 'Choose how Miniapp looks on this device.', icon: <BgColorsOutlined />, content: <Card className="settings-card"><ThemePicker /></Card> },
    { id: 'storage', label: 'Storage', description: 'Where your files and app settings are kept.', icon: <DatabaseOutlined />, content: <>
      <DataFolderCard />
      <Card className="settings-card"><div className="settings-row">
        <div className="settings-icon"><DatabaseOutlined /></div>
        <div><h3>Configuration database</h3><p>Preferences, profiles and history are stored in a local SQLite database.</p><CopyPath path={databasePath} /></div>
        <Tag color="green">SQLite</Tag>
      </div></Card>
    </> },
    { id: 'library', label: 'Library', description: 'Automatic tagging for your photos.', icon: <PictureOutlined />, content: <AutoTagModelsCard /> },
    ...modules.map((module) => ({ id: `module-${module.id}`, label: module.label, description: `Settings for the ${module.label} module.`, icon: module.icon ?? <AppstoreOutlined />, content: module.settings })),
    { id: 'about', label: 'About', description: 'Version and platform details.', icon: <InfoCircleOutlined />, content: <Card className="settings-card"><div className="settings-about">
      <div className="brand-mark" aria-hidden><span /><span /><span /><span /></div>
      <div><h3>Miniapp Studio</h3><p>Desktop app running on {window.desktop?.platform ?? 'your device'} with Electron.</p></div>
      <Tag>v0.1.0</Tag>
    </div></Card> }
  ]

  const [active, setActive] = useState(sections[0].id)
  const ids = sections.map((section) => section.id).join(',')
  useEffect(() => {
    // Highlight the section that sits in the upper part of the window.
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setActive(visible.target.id.replace(/^settings-/, ''))
    }, { rootMargin: '-15% 0px -70% 0px' })
    for (const id of ids.split(',')) {
      const element = document.getElementById(`settings-${id}`)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [ids])

  return <ModulePage title="Settings" description="Configure your workspace and installed modules." icon={<SettingOutlined />}>
    <div className="settings-layout">
      <SettingsNav sections={sections} active={active} />
      <div className="settings-sections">
        {sections.map((section) => <section key={section.id} id={`settings-${section.id}`} className="settings-section" aria-labelledby={`settings-${section.id}-title`}>
          <header><h2 id={`settings-${section.id}-title`}>{section.label}</h2><p>{section.description}</p></header>
          {section.content}
        </section>)}
      </div>
    </div>
  </ModulePage>
}
