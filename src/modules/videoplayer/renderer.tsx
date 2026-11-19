import {
  DeleteOutlined, FolderOpenOutlined, PlaySquareOutlined, PlusOutlined, StepBackwardOutlined, StepForwardOutlined, VideoCameraOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Select, Space, Switch, Tooltip, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { ModulePage } from '../core/ModulePage'
import type { RendererModule } from '../core/renderer'
import type { VideoItem } from './types'

const { Text } = Typography
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

function formatSize(bytes: number): string {
  return bytes >= 1_073_741_824 ? `${(bytes / 1_073_741_824).toFixed(1)} GB` : bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Lazy loading means a frame is only generated for rows that scroll into view.
function Thumb({ video }: { video: VideoItem }) {
  const [failed, setFailed] = useState(false)
  return <span className="video-thumb">{failed ? <VideoCameraOutlined /> : <img src={`miniapp-video://thumb/${video.id}`} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}</span>
}

function VideoPlayer() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const [autoNext, setAutoNext] = useState(true)
  const [error, setError] = useState('')

  async function call(action: string, payload?: unknown) {
    if (!window.desktop) return
    try {
      const next = await window.desktop.modules.invoke<VideoItem[]>('videoplayer', action, payload)
      setVideos(next)
      setCurrentId((id) => (next.some((video) => video.id === id) ? id : null))
    } catch (cause) { message.error(errorMessage(cause)) }
  }
  useEffect(() => { void call('list') }, [])

  const index = videos.findIndex((video) => video.id === currentId)
  const current = index >= 0 ? videos[index] : undefined
  const select = (video: VideoItem) => { setError(''); setCurrentId(video.id) }
  const step = (direction: 1 | -1) => {
    if (videos.length === 0) return
    select(videos[(Math.max(index, 0) + direction + videos.length) % videos.length])
  }

  return <ModulePage title="Video Player" description="Watch videos from your device. Add files or a whole folder to build a playlist." icon={<PlaySquareOutlined />}>
    {!window.desktop && <Alert type="warning" showIcon title="Open this page in the Electron app to play local files." className="video-alert" />}
    {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} className="video-alert" />}
    <div className="video-layout">
      <Card className="video-card video-stage">
        <div className="video-frame">
          {current
            ? <video key={current.id} src={current.url} controls autoPlay
                onLoadedMetadata={(event) => { event.currentTarget.playbackRate = speed }}
                onEnded={() => { if (autoNext && index < videos.length - 1) step(1) }}
                onError={() => setError(`Could not play “${current.title}”. The format or codec may be unsupported, or the file moved.`)} />
            : <div className="video-placeholder"><VideoCameraOutlined /><span>{videos.length ? 'Choose a video from the playlist' : 'Add videos to start watching'}</span></div>}
        </div>
        <div className="video-info">
          <div className="video-info-copy">
            <h3 title={current?.title}>{current?.title ?? 'Nothing playing'}</h3>
            <p>{current ? `${current.extension.toUpperCase()} · ${formatSize(current.size)}` : ' '}</p>
          </div>
          <Space size="middle" wrap>
            <Tooltip title="Previous video"><Button shape="circle" aria-label="Previous video" icon={<StepBackwardOutlined />} disabled={videos.length === 0} onClick={() => step(-1)} /></Tooltip>
            <Tooltip title="Next video"><Button shape="circle" aria-label="Next video" icon={<StepForwardOutlined />} disabled={videos.length === 0} onClick={() => step(1)} /></Tooltip>
            <Select aria-label="Playback speed" value={speed} style={{ width: 92 }} options={speeds.map((value) => ({ value, label: `${value}×` }))}
              onChange={(value) => { setSpeed(value); const element = document.querySelector<HTMLVideoElement>('.video-frame video'); if (element) element.playbackRate = value }} />
            <Space size="small"><Switch size="small" checked={autoNext} onChange={setAutoNext} aria-label="Play next automatically" /><Text type="secondary">Auto-play next</Text></Space>
          </Space>
        </div>
      </Card>

      <Card className="video-card video-playlist">
        <div className="video-list-head">
          <div><h3>Playlist</h3><p>{videos.length} {videos.length === 1 ? 'video' : 'videos'}</p></div>
          <Space>
            <Button icon={<PlusOutlined />} disabled={!window.desktop} onClick={() => void call('add-files')}>Files</Button>
            <Button icon={<FolderOpenOutlined />} disabled={!window.desktop} onClick={() => void call('add-folder')}>Folder</Button>
            <Button danger disabled={videos.length === 0} onClick={() => void call('clear')}>Clear</Button>
          </Space>
        </div>
        {videos.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No videos yet. Add files or a folder." /> : <ul className="video-list">
          {videos.map((video) => <li key={video.id} className={video.id === currentId ? 'active' : ''}>
            <button className="video-row" onClick={() => select(video)}>
              <Thumb video={video} />
              <span className="video-row-title" title={video.title}>{video.title}</span>
              <span className="video-row-meta">{formatSize(video.size)}</span>
            </button>
            <Tooltip title="Remove from playlist"><Button type="text" size="small" aria-label={`Remove ${video.title}`} icon={<DeleteOutlined />} onClick={() => void call('remove', video.id)} /></Tooltip>
          </li>)}
        </ul>}
      </Card>
    </div>
  </ModulePage>
}

export const videoPlayerRendererModule: RendererModule = {
  id: 'videoplayer',
  label: 'Video Player',
  icon: <PlaySquareOutlined />,
  element: <VideoPlayer />
}
