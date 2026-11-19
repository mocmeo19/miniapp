import { CloudDownloadOutlined, DownloadOutlined, FolderOpenOutlined, LinkOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Card, Empty, Input, Popconfirm, Segmented, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { ModulePage } from '../../../modules/core/ModulePage'
import { getModules } from '../../../modules/core/renderer'
import type { DownloadItem } from '../../../downloads/types'
import { errorText } from '../errorText'
import { DownloadRow, type DownloadActions } from './downloads/DownloadRow'

type Filter = 'all' | 'active' | 'completed' | 'failed'

const matches: Record<Filter, (item: DownloadItem) => boolean> = {
  all: () => true,
  active: (item) => item.status === 'running' || item.status === 'queued',
  completed: (item) => item.status === 'completed',
  failed: (item) => item.status === 'failed' || item.status === 'cancelled'
}

export function DownloadsPage() {
  const api = window.desktop?.downloads
  const [items, setItems] = useState<DownloadItem[]>([])
  const [url, setUrl] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const owners = useMemo(() => new Map([['library', 'Library'], ...getModules().map((module) => [module.id, module.label] as [string, string])]), [])

  useEffect(() => {
    if (!api) return
    void api.list().then(setItems)
    const stopItem = api.onItem((item) => setItems((current) => current.some((entry) => entry.id === item.id)
      ? current.map((entry) => entry.id === item.id ? item : entry)
      : [item, ...current]))
    const stopList = api.onList(setItems)
    return () => { stopItem(); stopList() }
  }, [api])

  const run = (action: () => Promise<unknown>) => { void action().catch((cause: unknown) => message.error(errorText(cause))) }
  const actions: DownloadActions = {
    cancel: (item) => run(() => api!.cancel(item.id)),
    retry: (item) => run(() => api!.retry(item.id)),
    remove: (item) => run(async () => setItems(await api!.remove(item.id))),
    open: (item) => run(() => api!.open(item.id)),
    reveal: (item) => run(() => api!.reveal(item.id))
  }

  async function start() {
    if (!api || !url.trim()) return
    try {
      await api.start(url.trim())
      setUrl('')
    } catch (cause) { message.error(errorText(cause)) }
  }

  const counts = Object.fromEntries((Object.keys(matches) as Filter[]).map((key) => [key, items.filter(matches[key]).length])) as Record<Filter, number>
  const query = search.trim().toLowerCase()
  const visible = items.filter(matches[filter]).filter((item) => !query || `${item.fileName} ${item.url}`.toLowerCase().includes(query))
  const finished = items.length - counts.active

  return <ModulePage title="Downloads" description="Download files from the web. Modules use the same queue, so everything you download shows up here." icon={<DownloadOutlined />}>
    <Card className="downloads-card downloads-new">
      <div className="downloads-new-row">
        <Input size="large" prefix={<LinkOutlined />} placeholder="Paste a link to download (https://…)" value={url} disabled={!api}
          onChange={(event) => setUrl(event.target.value)} onPressEnter={() => void start()} allowClear />
        <Button size="large" type="primary" icon={<CloudDownloadOutlined />} disabled={!api || !url.trim()} onClick={() => void start()}>Download</Button>
      </div>
      <small>Files are saved to the Downloads folder inside your data folder (Settings → Data folder).</small>
    </Card>

    <Card className="downloads-card">
      <div className="downloads-toolbar">
        <Segmented<Filter> value={filter} onChange={setFilter} options={[
          { value: 'all', label: `All ${counts.all}` },
          { value: 'active', label: `Active ${counts.active}` },
          { value: 'completed', label: `Completed ${counts.completed}` },
          { value: 'failed', label: `Failed ${counts.failed}` }
        ]} />
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search downloads" value={search} onChange={(event) => setSearch(event.target.value)} />
        <span className="downloads-toolbar-actions">
          <Button icon={<FolderOpenOutlined />} disabled={!api} onClick={() => run(() => api!.openFolder())}>Open folder</Button>
          <Popconfirm title="Clear finished downloads?" description="Downloaded files stay on disk." okText="Clear" onConfirm={() => run(async () => setItems(await api!.clear()))} disabled={finished === 0}>
            <Button disabled={finished === 0}>Clear finished</Button>
          </Popconfirm>
        </span>
      </div>
      {visible.length > 0
        ? <ul className="downloads-list">{visible.map((item) => <DownloadRow key={item.id} item={item} ownerName={owners.get(item.owner)} actions={actions} />)}</ul>
        : <Empty className="downloads-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={items.length === 0 ? 'Nothing downloaded yet' : 'No downloads match'} />}
    </Card>
  </ModulePage>
}
