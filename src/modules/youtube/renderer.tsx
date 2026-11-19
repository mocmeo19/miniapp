import { FolderOpenOutlined, YoutubeOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Input, Progress, Radio, Select, Space, Tag, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ModulePage } from '../core/ModulePage'
import type { RendererModule } from '../core/renderer'
import { formatDuration } from './format'
import { FormatTable } from './FormatTable'
import { HistoryPanel } from './HistoryPanel'
import type { DownloadEvent, HistoryEntry, HistoryItem, VideoInfo, YoutubeStatus } from './types'
import type { WebProfile, WebviewProfiles } from '../webview/types'

type Kind = 'video' | 'audio'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

function subfolder(folder: string, name: string): string {
  return `${folder}${folder.includes('\\') ? '\\' : '/'}${name}`
}

async function openDownloadsFolder() {
  try { await window.desktop?.modules.invoke('youtube', 'open-folder') }
  catch (cause) { message.error(errorMessage(cause)) }
}

function DownloadProgress({ download, onCancel }: { download: DownloadEvent; onCancel: () => void }) {
  const title = download.state === 'running' ? 'Downloading…' : download.state === 'completed' ? 'Download complete' : download.state === 'cancelled' ? 'Download cancelled' : 'Download failed'
  return <div className="youtube-progress">
    <div><strong>{title}</strong><span>{Math.round(download.percent)}%</span></div>
    <Progress percent={download.percent} status={download.state === 'failed' ? 'exception' : download.state === 'completed' ? 'success' : 'active'} showInfo={false} />
    {download.path && <p>Saved to: {download.path}</p>}
    {download.error && <Alert type="error" showIcon title={download.error} />}
    {download.state === 'running' && <Button size="small" onClick={onCancel} disabled={!download.jobId}>Cancel</Button>}
  </div>
}

function YoutubeDownloader() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<YoutubeStatus | null>(null)
  const [folder, setFolder] = useState('')
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [kind, setKind] = useState<Kind>('video')
  const [activeFormatId, setActiveFormatId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [download, setDownload] = useState<DownloadEvent | null>(null)
  const [starting, setStarting] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyError, setHistoryError] = useState('')
  const running = starting || download?.state === 'running'

  function refreshHistory() {
    void window.desktop?.modules.invoke<HistoryItem[]>('youtube', 'history')
      .then((items) => { setHistory(items); setHistoryError('') })
      .catch((cause) => setHistoryError(errorMessage(cause)))
  }

  useEffect(() => {
    const api = window.desktop?.modules
    if (!api) return
    void api.invoke<YoutubeStatus>('youtube', 'status').then(setStatus).catch((cause) => setError(errorMessage(cause)))
    void api.invoke<string>('youtube', 'folder').then(setFolder).catch(() => undefined)
    refreshHistory()
    return api.on<DownloadEvent>('youtube', 'download', (event) => {
      setDownload(event)
      if (event.state === 'completed') refreshHistory()
    })
  }, [])

  const choices = useMemo(() => info?.options.filter((option) => option.kind === kind) ?? [], [info, kind])

  function showInfo(result: VideoInfo) {
    setInfo(result)
    setActiveFormatId(undefined)
    setKind(result.options.some((option) => option.kind === 'video' && (!option.requiresFfmpeg || result.ffmpegAvailable)) ? 'video' : 'audio')
  }

  async function inspect() {
    const api = window.desktop?.modules
    if (!api) return
    setLoading(true)
    setError('')
    setInfo(null)
    setDownload(null)
    try {
      showInfo(await api.invoke<VideoInfo>('youtube', 'inspect', url))
      refreshHistory()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  async function openHistory(id: string) {
    const api = window.desktop?.modules
    if (!api) return
    setError('')
    setDownload(null)
    try {
      const entry = await api.invoke<HistoryEntry>('youtube', 'history-open', id)
      setUrl(entry.url)
      showInfo(entry.info)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (cause) {
      message.error(errorMessage(cause))
      refreshHistory()
    }
  }

  async function removeHistory(id: string) {
    try { setHistory(await window.desktop!.modules.invoke<HistoryItem[]>('youtube', 'history-remove', id)) }
    catch (cause) { message.error(errorMessage(cause)) }
  }

  async function clearHistory() {
    try { setHistory(await window.desktop!.modules.invoke<HistoryItem[]>('youtube', 'history-clear')) }
    catch (cause) { message.error(errorMessage(cause)) }
  }

  async function startDownload(formatId: string) {
    if (!window.desktop?.modules) return
    setActiveFormatId(formatId)
    setError('')
    setStarting(true)
    setDownload({ jobId: '', state: 'running', percent: 0 })
    try {
      const result = await window.desktop.modules.invoke<{ jobId: string }>('youtube', 'download', { formatId })
      setDownload((current) => current?.state === 'running' ? { ...current, jobId: result.jobId } : current)
    } catch (cause) {
      setDownload(null)
      setError(errorMessage(cause))
    } finally {
      setStarting(false)
    }
  }

  async function cancelDownload() {
    if (!download?.jobId || !window.desktop?.modules) return
    try { await window.desktop.modules.invoke('youtube', 'cancel', { jobId: download.jobId }) }
    catch (cause) { message.error(errorMessage(cause)) }
  }

  return <ModulePage title="YouTube Downloader" description="Paste a link, then download the content and quality you want." icon={<YoutubeOutlined />}>

    {!window.desktop && <Alert type="warning" showIcon title="Open this page in the Electron app to use downloads." className="youtube-alert" />}
    {status && !status.available && <Alert type="warning" showIcon title="yt-dlp is not installed" description="Run npm run setup:yt-dlp, then restart the app. You can also install yt-dlp on your PATH." className="youtube-alert" />}
    {error && <Alert type="error" showIcon title="Could not continue" description={error} closable onClose={() => setError('')} className="youtube-alert" />}

    <Card className="youtube-card"><div className="youtube-step"><span>01</span><div><h3>Video link</h3><p>Enter a YouTube video or Shorts URL.</p></div></div><div className="youtube-url-row"><Input size="large" placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={() => void inspect()} disabled={running || loading} /><Button size="large" type="primary" loading={loading} disabled={!url.trim() || running || !status?.available} onClick={() => void inspect()}>Get video info</Button></div></Card>

    {info && <Card className="youtube-card">
      <div className="youtube-step"><span>02</span><div><h3>Download</h3><p>Pick the content type, then download any format from the table.</p></div></div>
      <div className="youtube-video"><div className="youtube-thumbnail">{info.thumbnail ? <img src={info.thumbnail} alt="Video thumbnail" /> : <YoutubeOutlined />}</div><div className="youtube-video-copy"><Tag color="purple">YOUTUBE VIDEO</Tag><h3>{info.title}</h3><p>{info.channel} <span>·</span> {formatDuration(info.duration)}</p></div></div>
      <div className="youtube-form-row"><div><label>Content</label><Radio.Group value={kind} onChange={(event) => setKind(event.target.value as Kind)} optionType="button" buttonStyle="solid" disabled={running}><Radio.Button value="video">Video</Radio.Button><Radio.Button value="audio">Audio only</Radio.Button></Radio.Group></div></div>
      <div className="youtube-format"><label>Format / quality</label><FormatTable kind={kind} options={choices} ffmpegAvailable={info.ffmpegAvailable} activeId={activeFormatId} disabled={running} onDownload={(id) => void startDownload(id)} /></div>
      {!info.ffmpegAvailable && info.options.some((option) => option.kind === 'video' && option.requiresFfmpeg) && <Alert type="info" showIcon title="High quality video may need ffmpeg" description="Install ffmpeg to enable video-only formats that must be merged with audio. Combined video formats and original audio formats work without it." className="youtube-format-note" />}
      <div className="youtube-save-row">
        <span>Files are saved to <strong title={folder ? subfolder(folder, kind) : undefined}>{folder ? subfolder(folder, kind) : '…'}</strong></span>
        <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void openDownloadsFolder()}>Open folder</Button>
      </div>
      {download && <DownloadProgress download={download} onCancel={() => void cancelDownload()} />}
    </Card>}

    {window.desktop && <HistoryPanel items={history} error={historyError} activeId={info?.id} disabled={running || loading} onOpen={(id) => void openHistory(id)} onRemove={(id) => void removeHistory(id)} onClear={() => void clearHistory()} />}

    <div className="youtube-footnote"><Space><span>Powered by yt-dlp</span><span>·</span><span>Download content you have permission to save.</span></Space></div>
  </ModulePage>
}

function YoutubeSettings() {
  const [status, setStatus] = useState<YoutubeStatus | null>(null)
  const [profiles, setProfiles] = useState<WebProfile[]>([])
  useEffect(() => {
    void window.desktop?.modules.invoke<YoutubeStatus>('youtube', 'status').then(setStatus)
    void window.desktop?.modules.invoke<WebviewProfiles>('webview', 'profiles').then((result) => setProfiles(result.profiles)).catch(() => undefined)
  }, [])
  async function changeProfile(profileId: string | null) {
    if (!window.desktop || !status) return
    try {
      const saved = await window.desktop.modules.invoke<string | null>('youtube', 'set-cookie-profile', profileId)
      setStatus({ ...status, cookieProfileId: saved })
      message.success(saved ? 'Using Web Browser profile cookies' : 'Browser cookies disabled')
    } catch (cause) { message.error(errorMessage(cause)) }
  }
  return <Card className="settings-card">
    <div className="settings-row"><div className="settings-icon"><FolderOpenOutlined /></div><div><h3>Download folder</h3><p className="settings-path" title={status?.folder}>{status?.folder ?? 'Loading…'}</p><p>Inside the app data folder (Settings → Data folder). yt-dlp {status?.version ?? 'not found'} · ffmpeg {status?.ffmpegAvailable ? 'ready' : 'not found'}</p></div><Button onClick={() => void openDownloadsFolder()}>Open</Button></div>
    <div className="settings-row"><div className="settings-icon"><YoutubeOutlined /></div><div><h3>Use Web Browser profile cookies</h3><p>Helps with “429 Too Many Requests” and sign-in checks. Sign in to YouTube in the Web Browser module with this profile first.</p></div><Select allowClear placeholder="Off" value={status?.cookieProfileId ?? undefined} style={{ width: 160 }} onChange={(value) => void changeProfile(value ?? null)} options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))} /></div>
  </Card>
}

export const youtubeRendererModule: RendererModule = {
  id: 'youtube',
  label: 'YouTube Downloader',
  icon: <YoutubeOutlined />,
  element: <YoutubeDownloader />,
  settings: <YoutubeSettings />
}
