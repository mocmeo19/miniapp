import { BellOutlined, CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons'
import { Badge, Button, Empty, Popover, notification } from 'antd'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppNotification, NotificationKind } from '../../../notifications/types'

const icons: Record<NotificationKind, ReactNode> = {
  info: <InfoCircleFilled className="bell-icon is-info" />,
  success: <CheckCircleFilled className="bell-icon is-success" />,
  warning: <ExclamationCircleFilled className="bell-icon is-warning" />,
  error: <CloseCircleFilled className="bell-icon is-error" />
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
function timeAgo(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/** The header bell: unread badge, a list of recent notifications and a toast for new ones. */
export function NotificationBell() {
  const api = window.desktop?.notifications
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const unread = items.filter((item) => !item.read).length

  function openItem(item: AppNotification) {
    if (!item.read) void api?.markRead(item.id).then(setItems)
    setOpen(false)
    if (item.link) navigate(item.link)
  }

  useEffect(() => {
    if (!api) return
    void api.list().then(setItems)
    const stopAdded = api.onAdded((item) => {
      setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)])
      notification.open({
        key: item.id,
        message: item.title,
        description: item.body,
        icon: icons[item.kind],
        placement: 'bottomRight',
        duration: item.kind === 'error' ? 8 : 4,
        onClick: () => { notification.destroy(item.id); openItem(item) }
      })
    })
    const stopList = api.onList(setItems)
    return () => { stopAdded(); stopList() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const panel = <div className="bell-panel">
    <header>
      <strong>Notifications</strong>
      <Button type="link" size="small" disabled={unread === 0} onClick={() => void api?.markAllRead().then(setItems)}>Mark all as read</Button>
    </header>
    {items.length === 0
      ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="You’re all caught up" />
      : <ul>{items.map((item) => <li key={item.id}>
        <button type="button" className={`bell-item ${item.read ? '' : 'is-unread'}`} onClick={() => openItem(item)}>
          {icons[item.kind]}
          <span className="bell-copy">
            <strong>{item.title}</strong>
            {item.body && <span title={item.body}>{item.body}</span>}
            <small>{timeAgo(item.createdAt)}</small>
          </span>
          {!item.read && <span className="bell-dot" aria-label="Unread" />}
        </button>
      </li>)}</ul>}
    {items.length > 0 && <footer><Button type="text" size="small" onClick={() => void api?.clear().then(setItems)}>Clear all</Button></footer>}
  </div>

  return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={panel} arrow={false} getPopupContainer={(trigger) => trigger.closest<HTMLElement>('.topbar') ?? document.body} classNames={{ root: 'bell-popover' }}>
    <button type="button" className="icon-button bell-button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
      <Badge count={unread} size="small" overflowCount={99}><BellOutlined /></Badge>
    </button>
  </Popover>
}
