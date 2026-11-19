import { TagsOutlined } from '@ant-design/icons'
import { Alert, Button, Popconfirm, Progress, Switch } from 'antd'
import type { AutoTagStatus } from '../../../../library/types'

type AutoTagPanelProps = {
  status: AutoTagStatus | null
  onToggle: (enabled: boolean) => void
  onClear: () => void
}

function progressText(status: AutoTagStatus): string {
  if (status.phase === 'downloading') return `Downloading model… ${(status.done / 1024 / 1024).toFixed(1)} / ${(status.total / 1024 / 1024).toFixed(1)} MB`
  if (status.phase === 'tagging') return `Tagging photos… ${status.done.toLocaleString()} / ${status.total.toLocaleString()}`
  if (!status.enabled) return status.pending > 0 ? `${status.pending.toLocaleString()} photos not tagged yet` : 'All photos have auto-tags'
  return status.pending > 0 ? `${status.pending.toLocaleString()} photos waiting` : 'All photos are tagged'
}

export function AutoTagPanel({ status, onToggle, onClear }: AutoTagPanelProps) {
  const working = status?.phase === 'downloading' || status?.phase === 'tagging'
  return <section className="library-autotag">
    <div className="library-autotag-head">
      <TagsOutlined className="library-autotag-icon" />
      <div>
        <strong>Auto-tag photos</strong>
        <p>Adds tags to photos on this device using the models chosen in Settings → Auto-tag models (objects and scenes, and optionally sensitive content). Photos never leave your computer.</p>
      </div>
      <Switch checked={status?.enabled ?? false} disabled={!status} onChange={onToggle} aria-label="Auto-tag photos" />
    </div>
    {status && <>
      {working && <Progress percent={status.total ? Math.floor((status.done / status.total) * 100) : 0} size="small" status="active" />}
      {status.phase === 'error'
        ? <Alert type="error" showIcon title="Auto-tagging stopped" description={status.error} action={<Button size="small" onClick={() => onToggle(true)}>Retry</Button>} />
        : <p className="library-autotag-status">{progressText(status)}</p>}
      <Popconfirm title="Remove all auto tags?" description="Tags you added yourself are kept. Auto-tagging will be turned off." okText="Remove" okButtonProps={{ danger: true }} onConfirm={onClear}>
        <Button size="small" type="link" danger className="library-autotag-clear">Remove auto tags</Button>
      </Popconfirm>
    </>}
  </section>
}
