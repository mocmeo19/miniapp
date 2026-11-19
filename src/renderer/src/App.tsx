import {
  AppstoreOutlined, BlockOutlined,
  DownloadOutlined, EllipsisOutlined, HomeOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, MoonOutlined, PictureOutlined, SettingOutlined, SunOutlined
} from '@ant-design/icons'
import { Avatar } from 'antd'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useTheme } from './theme/ThemeProvider'
import { getModules, modulePath } from '../../modules/core/renderer'
import type { InstalledModule } from '../../modules/core/types'
import { ModuleManagerPage } from './pages/ModuleManagerPage'
import { ExternalModule } from './pages/ExternalModule'
import { LibraryPage } from './pages/Library'
import { DownloadsPage } from './pages/DownloadsPage'
import { NotificationBell } from './components/NotificationBell'
import { SettingsPage } from './pages/SettingsPage'
import { Overview } from './pages/Overview'

function Brand() {
  return <div className="brand"><div className="brand-mark"><span /><span /><span /><span /></div><span>miniapp<span className="brand-accent">.</span></span></div>
}

function Sidebar({ installed }: { installed: InstalledModule[] }) {
  const builtIns = getModules().filter((module) => installed.some((item) => item.id === module.id && item.enabled))
  const external = installed.filter((item) => item.enabled && item.source !== 'built-in')
  const nav = [
    { to: '/', label: 'Overview', icon: <HomeOutlined /> },
    { to: '/library', label: 'Library', icon: <PictureOutlined /> },
    { to: '/downloads', label: 'Download', icon: <DownloadOutlined /> },
    { to: '/modules', label: 'Module Manager', icon: <BlockOutlined /> },
    { to: '/settings', label: 'Settings', icon: <SettingOutlined /> }
  ]
  return <aside className="sidebar">
    <Brand />
    <div className="nav-caption">WORKSPACE</div>
    <nav className="side-nav">{nav.map((item) => <NavLink key={item.to} to={item.to} end title={item.label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>{item.icon}<span>{item.label}</span></NavLink>)}</nav>
    {(builtIns.length > 0 || external.length > 0) && <><div className="nav-caption module-nav-caption">MODULES</div><nav className="side-nav">{builtIns.map((item) => <NavLink key={item.id} to={modulePath(item.id)} title={item.label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>{item.icon}<span>{item.label}</span></NavLink>)}{external.map((item) => <NavLink key={item.id} to={modulePath(item.id)} title={item.name} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><AppstoreOutlined /><span>{item.name}</span></NavLink>)}</nav></>}
    <div className="sidebar-bottom">
      <div className="account"><Avatar className="account-avatar">JD</Avatar><div><strong>Jane Doe</strong><small>Workspace admin</small></div><EllipsisOutlined /></div>
    </div>
  </aside>
}

function Topbar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { mode, toggleMode } = useTheme()
  return <header className="topbar"><button className="icon-button sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</button><div className="top-actions"><button className="icon-button" aria-label={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`} onClick={toggleMode}>{mode === 'light' ? <MoonOutlined /> : <SunOutlined />}</button><NotificationBell /><Avatar className="top-avatar">JD</Avatar></div></header>
}

export default function App({ initialInstalled, initialCollapsed }: { initialInstalled: InstalledModule[]; initialCollapsed?: boolean }) {
  const [installed, setInstalled] = useState<InstalledModule[]>(initialInstalled)
  // Saved in the app's settings database (localStorage is per origin, so it is lost when the dev server port changes).
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof initialCollapsed === 'boolean') return initialCollapsed
    try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false }
  })
  const toggleSidebar = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', next ? '1' : '0') } catch { /* fallback only */ }
    void window.desktop?.preferences.setSidebarCollapsed(next).catch(() => undefined)
  }
  useEffect(() => {
    const api = window.desktop?.moduleManager
    if (!api) return
    const unsubscribe = api.onChanged(setInstalled)
    void api.list().then(setInstalled).catch((error: unknown) => console.error('Could not refresh modules:', error))
    return unsubscribe
  }, [])
  const builtInRoutes = getModules().filter((module) => installed.some((item) => item.id === module.id && item.enabled))
  const externalRoutes = installed.filter((module) => module.enabled && module.source !== 'built-in')
  return <div className={`app-shell${collapsed ? ' collapsed' : ''}`}><Sidebar installed={installed} /><div className="main-shell"><Topbar collapsed={collapsed} onToggle={toggleSidebar} /><main><Routes><Route path="/" element={<Overview installed={installed} />} /><Route path="/library" element={<LibraryPage />} /><Route path="/downloads" element={<DownloadsPage />} /><Route path="/modules" element={<ModuleManagerPage modules={installed} />} /><Route path="/settings" element={<SettingsPage installed={installed} />} />{builtInRoutes.map((module) => <Route key={module.id} path={modulePath(module.id)} element={module.element} />)}{externalRoutes.map((module) => <Route key={module.id} path={modulePath(module.id)} element={<ExternalModule id={module.id} />} />)}<Route path="*" element={<Navigate to="/" replace />} /></Routes></main></div></div>
}
