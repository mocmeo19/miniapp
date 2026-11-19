import { CheckCircleFilled, CloseOutlined, HistoryOutlined, SearchOutlined, YoutubeOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Popconfirm, Tooltip } from 'antd'
import { useState } from 'react'
import { formatDuration, timeAgo } from './format'
import type { HistoryItem } from './types'

type HistoryPanelProps = {
  items: HistoryItem[]
  error?: string
  activeId?: string
  disabled: boolean
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}

export function HistoryPanel({ items, error, activeId, disabled, onOpen, onRemove, onClear }: HistoryPanelProps) {
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()
  const visible = query ? items.filter((item) => `${item.title} ${item.channel}`.toLowerCase().includes(query)) : items

  return <Card className="youtube-card youtube-history">
    <div className="youtube-history-head">
      <div className="youtube-step"><span><HistoryOutlined /></span><div><h3>History</h3><p>Videos you looked up. Open one to download it again without searching.</p></div></div>
      {items.length > 0 && <Popconfirm title="Clear search history?" description="Downloaded files are not affected." okText="Clear" okButtonProps={{ danger: true }} onConfirm={onClear}>
        <Button size="small" type="text" danger>Clear all</Button>
      </Popconfirm>}
    </div>
    {error && <Alert type="warning" showIcon className="youtube-history-error" title="History could not be loaded" description={`${error} If you just updated the app, restart it.`} />}
    {items.length > 5 && <Input className="youtube-history-filter" allowClear prefix={<SearchOutlined />} placeholder="Filter history" value={filter} onChange={(event) => setFilter(event.target.value)} />}
    {items.length === 0
      ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Videos you look up will appear here" />
      : <ul className="youtube-history-list">
        {visible.map((item) => <li key={item.id}>
          <button type="button" className={`youtube-history-item ${item.id === activeId ? 'active' : ''}`} disabled={disabled} onClick={() => onOpen(item.id)} title={item.url}>
            <span className="youtube-history-thumb">{item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <YoutubeOutlined />}</span>
            <span className="youtube-history-copy">
              <strong>{item.title}</strong>
              <small>{item.channel} · {formatDuration(item.duration)} · {timeAgo(item.inspectedAt)}</small>
            </span>
            {item.download && <Tooltip title={`${item.download.label} · ${item.download.path}`}><span className="youtube-history-done"><CheckCircleFilled /> Downloaded</span></Tooltip>}
          </button>
          <Tooltip title="Remove from history"><Button type="text" size="small" shape="circle" icon={<CloseOutlined />} aria-label={`Remove ${item.title} from history`} onClick={() => onRemove(item.id)} /></Tooltip>
        </li>)}
        {visible.length === 0 && <li className="youtube-history-none">No videos match “{filter}”.</li>}
      </ul>}
  </Card>
}
