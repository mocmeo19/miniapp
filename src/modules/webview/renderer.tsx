import {
  ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, GlobalOutlined, HomeOutlined, LoadingOutlined,
  ControlOutlined, LockOutlined, ReloadOutlined, StopOutlined, ThunderboltOutlined, UserOutlined
} from '@ant-design/icons'
import { Alert, Badge, Button, Drawer, Input, Select, Tabs, Tooltip } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { RendererModule } from '../core/renderer'
import { ProfilesPanel } from './ProfilesPanel'
import { ScriptsPanel } from './ScriptsPanel'
import type { ScriptRun, WebProfile, WebviewBounds, WebviewProfiles, WebviewState } from './types'

const panelKey = 'miniapp-webview-panel'
const minPanel = 340
const maxPanel = 640

function browserBounds(element: HTMLElement): WebviewBounds {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

// Panel open state and width are a per-viewer convenience, so browser storage is enough.
function savedPanel(): { open: boolean; width: number } {
  try {
    const value = JSON.parse(localStorage.getItem(panelKey) ?? '{}') as { open?: unknown; width?: unknown }
    const width = typeof value.width === 'number' ? Math.min(maxPanel, Math.max(minPanel, value.width)) : 380
    return { open: value.open === true, width }
  } catch { return { open: false, width: 380 } }
}

function WebviewPage() {
  const surface = useRef<HTMLDivElement>(null)
  const [profiles, setProfiles] = useState<WebProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [state, setState] = useState<WebviewState | null>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [panel, setPanel] = useState(savedPanel)
  const [tab, setTab] = useState('scripts')
  const [run, setRun] = useState<ScriptRun | null>(null)
  const running = run?.status === 'running'

  useEffect(() => {
    try { localStorage.setItem(panelKey, JSON.stringify(panel)) } catch { /* storage unavailable */ }
  }, [panel])

  useEffect(() => {
    const api = window.desktop?.modules
    if (!api) return
    let active = true
    void api.invoke<WebviewProfiles>('webview', 'profiles').then((result) => {
      if (!active) return
      setProfiles(result.profiles)
      setProfileId(result.activeProfileId)
    }).catch((cause: unknown) => { if (active) setError(String(cause)) })
    // A script keeps running while this page is closed; pick its progress back up.
    void api.invoke<ScriptRun | null>('webview', 'script-run').then((current) => { if (active && current) setRun(current) }).catch(() => undefined)
    const unsubscribe = api.on<ScriptRun>('webview', 'script-run', setRun)
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    const api = window.desktop?.modules
    if (!api) return
    return api.on<WebviewState>('webview', 'state', (next) => {
      if (next.profileId !== profileId) return
      setState(next)
      setAddress(next.url)
    })
  }, [profileId])

  useEffect(() => {
    const api = window.desktop?.modules
    const element = surface.current
    if (!api || !profileId || !element) return
    let active = true
    const resize = () => { void api.invoke('webview', 'resize', browserBounds(element)).catch(() => undefined) }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', resize, true)
    void api.invoke<WebviewState>('webview', 'show', { profileId, bounds: browserBounds(element) }).then((next) => {
      if (!active) return
      setState(next)
      setAddress(next.url)
      setError('')
    }).catch((cause: unknown) => { if (active) setError(String(cause)) })
    return () => {
      active = false
      observer.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', resize, true)
      void api.invoke('webview', 'hide', profileId).catch(() => undefined)
    }
  }, [profileId])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 'l') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.webview-address input')?.select()
      } else if (key === 'b' && event.shiftKey) {
        event.preventDefault()
        setPanel((value) => ({ ...value, open: !value.open }))
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  async function action(name: string, payload?: unknown) {
    try {
      setError('')
      await window.desktop?.modules.invoke('webview', name, payload)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  function selectProfile(id: string) {
    if (id === profileId) return
    setState(null)
    setProfileId(id)
  }

  const secure = state?.url.startsWith('https://')
  const togglePanel = () => setPanel((value) => ({ ...value, open: !value.open }))

  return <div className="webview-page">
    {/* The native page view cannot sit under DOM, so the open panel takes its own column. */}
    <div className="webview-main" style={{ paddingRight: panel.open ? panel.width + 12 : 0 }}>
      {!window.desktop && <Alert type="warning" showIcon title="Open the Electron app to browse websites." />}
      <div className="webview-toolbar">
        <div className="webview-navigation">
          <Tooltip title="Back"><Button type="text" aria-label="Back" icon={<ArrowLeftOutlined />} disabled={!state?.canGoBack} onClick={() => void action('back')} /></Tooltip>
          <Tooltip title="Forward"><Button type="text" aria-label="Forward" icon={<ArrowRightOutlined />} disabled={!state?.canGoForward} onClick={() => void action('forward')} /></Tooltip>
          <Tooltip title={state?.loading ? 'Stop' : 'Reload'}><Button type="text" aria-label={state?.loading ? 'Stop' : 'Reload'} icon={state?.loading ? <StopOutlined /> : <ReloadOutlined />} disabled={!profileId} onClick={() => void action(state?.loading ? 'stop' : 'reload')} /></Tooltip>
          <Tooltip title="Home"><Button type="text" aria-label="Home" icon={<HomeOutlined />} disabled={!profileId} onClick={() => void action('home')} /></Tooltip>
        </div>
        <Input className="webview-address" aria-label="Address or search" value={address} disabled={!profileId}
          placeholder="Search or enter a web address"
          prefix={<Tooltip title={state?.title || 'New tab'}>{state?.loading ? <LoadingOutlined /> : secure ? <LockOutlined /> : <GlobalOutlined />}</Tooltip>}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => event.target.select()}
          onPressEnter={() => void action('navigate', address)} />
        <Select className="webview-profile-select" aria-label="Browser profile" value={profileId || undefined} onChange={selectProfile} placeholder="Profile"
          prefix={<UserOutlined />} options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} />
        <Tooltip title={`${panel.open ? 'Hide' : 'Show'} control panel (⇧⌘B)`}>
          <Badge dot={running} offset={[-4, 4]} status="processing">
            <Button type={panel.open ? 'primary' : 'default'} aria-label="Control panel" aria-expanded={panel.open} icon={<ControlOutlined />} onClick={togglePanel} />
          </Badge>
        </Tooltip>
      </div>
      {error && <Alert className="webview-error" type="error" showIcon title={error} closable onClose={() => setError('')} />}
      {state?.error && <Alert className="webview-error" type="error" showIcon title={`Page could not load: ${state.error}`} />}
      <div className="webview-frame">
        {state?.loading && <div className="webview-loading-bar" aria-hidden />}
        <div className="webview-surface" ref={surface}>{!window.desktop && <div className="webview-empty">Web pages appear here in the desktop app.</div>}</div>
      </div>
    </div>

    <Drawer open={panel.open} getContainer={false} mask={false} placement="right" size={panel.width} maxSize={maxPanel}
      resizable={{ onResize: (width) => setPanel((value) => ({ ...value, width: Math.min(maxPanel, Math.max(minPanel, width)) })) }}
      title={<span className="webview-panel-title"><ThunderboltOutlined /> Control panel</span>} closable={false}
      extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={togglePanel} aria-label="Close control panel" />}
      classNames={{ root: 'webview-panel', body: 'webview-panel-body' }}>
      <Tabs activeKey={tab} onChange={setTab} size="small" items={[
        { key: 'scripts', label: <Badge dot={running} offset={[6, 0]}>Scripts</Badge>, children: <ScriptsPanel currentUrl={state?.url ?? ''} ready={!!state} run={run} onRunChange={setRun} /> },
        { key: 'profiles', label: 'Profiles', children: <ProfilesPanel profiles={profiles} profileId={profileId} onSelect={selectProfile}
          onChanged={(result) => { setProfiles(result.profiles); selectProfile(result.activeProfileId) }} /> }
      ]} />
    </Drawer>
  </div>
}

export const webviewRendererModule: RendererModule = {
  id: 'webview',
  label: 'Web Browser',
  icon: <GlobalOutlined />,
  element: <WebviewPage />
}
