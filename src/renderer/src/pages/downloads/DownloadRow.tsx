import {
  CloseOutlined, DeleteOutlined, ExportOutlined, FileOutlined, FileImageOutlined, FileZipOutlined, FolderOpenOutlined, MoreOutlined,
  PlaySquareOutlined, ReloadOutlined, SoundOutlined
} from '@ant-design/icons'
import { Button, Dropdown, Progress, Tag, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import type { DownloadItem } from '../../../../downloads/types'

export type DownloadActions = {
  cancel: (item: DownloadItem) => void
  retry: (item: DownloadItem) => void
  remove: (item: DownloadItem) => void
  open: (item: DownloadItem) => void
  reveal: (item: DownloadItem) => void
}

const kinds: Array<[RegExp, ReactNode]> = [
  [/\.(jpe?g|png|gif|webp|avif|bmp|heic|svg)$/i, <FileImageOutlined key="image" />],
  [/\.(mp4|mkv|mov|webm|avi|m4v)$/i, <PlaySquareOutlined key="video" />],
  [/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, <SoundOutlined key="audio" />],
  [/\.(zip|rar|7z|tar|gz|dmg|pkg|exe|msi)$/i, <FileZipOutlined key="archive" />]
]

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}

function remaining(item: DownloadItem): string | null {
  if (!item.total || !item.speed) return null
  const seconds = Math.max(0, Math.round((item.total - item.received) / item.speed))
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min left`
    : seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s left` : `${seconds} s left`
}

function host(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function summary(item: DownloadItem): string {
  if (item.status === 'running') {
    const progress = item.total ? `${bytes(item.received)} of ${bytes(item.total)}` : bytes(item.received)
    return [progress, item.speed ? `${bytes(item.speed)}/s` : null, remaining(item)].filter(Boolean).join(' · ')
  }
  if (item.status === 'queued') return 'Waiting…'
  if (item.status === 'completed') return `${bytes(item.total ?? item.received)} · ${new Date(item.finishedAt ?? item.createdAt).toLocaleString()}`
  return item.error ?? (item.status === 'cancelled' ? 'Cancelled' : 'Failed')
}

const statusTag: Record<DownloadItem['status'], { color: string; label: string }> = {
  queued: { color: 'default', label: 'Queued' },
  running: { color: 'processing', label: 'Downloading' },
  completed: { color: 'success', label: 'Completed' },
  failed: { color: 'error', label: 'Failed' },
  cancelled: { color: 'warning', label: 'Cancelled' }
}

export function DownloadRow({ item, ownerName, actions }: { item: DownloadItem; ownerName?: string; actions: DownloadActions }) {
  const active = item.status === 'running' || item.status === 'queued'
  const percent = item.total ? Math.floor((item.received / item.total) * 100) : 0
  return <li className={`downloads-row is-${item.status}`}>
    <span className="downloads-icon">{kinds.find(([pattern]) => pattern.test(item.fileName))?.[1] ?? <FileOutlined />}</span>
    <div className="downloads-copy">
      <div className="downloads-title">
        <strong title={item.fileName}>{item.fileName}</strong>
        <Tag color={statusTag[item.status].color}>{statusTag[item.status].label}</Tag>
        {item.owner !== 'app' && <Tag>{ownerName ?? item.owner}</Tag>}
      </div>
      {item.status === 'running' && <Progress percent={percent} size="small" showInfo={!!item.total} status="active" />}
      <small title={item.url}><span className="downloads-host">{host(item.url)}</span> · <span className={item.status === 'failed' ? 'downloads-error' : ''}>{summary(item)}</span></small>
    </div>
    <div className="downloads-actions">
      {active && <Tooltip title="Cancel"><Button type="text" shape="circle" icon={<CloseOutlined />} aria-label={`Cancel ${item.fileName}`} onClick={() => actions.cancel(item)} /></Tooltip>}
      {(item.status === 'failed' || item.status === 'cancelled') && <Button size="small" icon={<ReloadOutlined />} onClick={() => actions.retry(item)}>Retry</Button>}
      {item.status === 'completed' && <>
        <Button size="small" icon={<ExportOutlined />} onClick={() => actions.open(item)}>Open</Button>
        <Tooltip title="Show in folder"><Button type="text" shape="circle" icon={<FolderOpenOutlined />} aria-label={`Show ${item.fileName} in folder`} onClick={() => actions.reveal(item)} /></Tooltip>
      </>}
      <Dropdown trigger={['click']} placement="bottomRight" menu={{
        items: [{ key: 'remove', icon: <DeleteOutlined />, label: 'Remove from list' }],
        onClick: () => actions.remove(item)
      }}>
        <Button type="text" shape="circle" icon={<MoreOutlined />} aria-label={`More actions for ${item.fileName}`} />
      </Dropdown>
    </div>
  </li>
}
