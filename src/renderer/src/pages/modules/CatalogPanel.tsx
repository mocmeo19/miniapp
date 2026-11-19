import { AppstoreOutlined, CheckOutlined, CloudDownloadOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Spin, Tag, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { CatalogEntry, InstalledModule } from '../../../../modules/core/types'
import { errorText } from '../../errorText'

export function CatalogPanel({ installed }: { installed: InstalledModule[] }) {
  const api = window.desktop?.moduleManager
  const [catalogUrl, setCatalogUrl] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [installingId, setInstallingId] = useState('')

  const load = useCallback(async () => {
    if (!api) return
    setLoading(true)
    setError('')
    try { setEntries(await api.catalog()) }
    catch (cause) { setEntries([]); setError(errorText(cause)) }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => {
    if (!api) return
    void api.getCatalogUrl().then((url) => {
      setCatalogUrl(url)
      setDraftUrl(url)
      if (url) void load()
    })
  }, [api, load])

  async function saveUrl() {
    if (!api) return
    try {
      await api.setCatalogUrl(draftUrl.trim())
      setCatalogUrl(draftUrl.trim())
      if (draftUrl.trim()) await load()
      else setEntries([])
    } catch (cause) { message.error(errorText(cause)) }
  }

  async function install(entry: CatalogEntry) {
    if (!api) return
    setInstallingId(entry.id)
    try {
      const module = await api.installUrl(entry.downloadUrl)
      message.success(`${module.name} installed. Enable it to start using it.`)
    } catch (cause) { message.error(errorText(cause)) }
    finally { setInstallingId('') }
  }

  const changed = draftUrl.trim() !== catalogUrl
  return <div className="modules-catalog">
    <div className="modules-catalog-source">
      <Input prefix={<LinkOutlined />} placeholder="https://example.com/miniapp-catalog.json" value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} onPressEnter={() => void saveUrl()} allowClear />
      <Button type={changed ? 'primary' : 'default'} disabled={!changed} onClick={() => void saveUrl()}>Save</Button>
      <Button icon={<ReloadOutlined />} disabled={!catalogUrl || loading} onClick={() => void load()} aria-label="Refresh catalog" />
    </div>
    {error && <Alert type="error" showIcon title="Could not load the catalog" description={error} className="modules-alert" />}
    <Spin spinning={loading}>
      {!catalogUrl
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Add a catalog URL to browse modules you can install." />
        : entries.length === 0 && !loading && !error
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This catalog has no modules." />
          : <div className="modules-grid">{entries.map((entry) => {
            const current = installed.find((module) => module.id === entry.id)
            const update = current && current.version !== entry.version
            return <Card key={entry.id} className="modules-card">
              <div className="modules-card-head">
                <span className="modules-card-icon"><AppstoreOutlined /></span>
                <div className="modules-card-title"><h3 title={entry.name}>{entry.name}</h3><span><Tag>v{entry.version}</Tag>{update && <Tag color="orange">Installed v{current.version}</Tag>}</span></div>
              </div>
              <p className="modules-card-description">{entry.description || 'No description provided.'}</p>
              <div className="modules-card-foot">
                <code>{entry.id}</code>
                {current && !update
                  ? <Tag icon={<CheckOutlined />} color="success">Installed</Tag>
                  : <Button size="small" type="primary" icon={<CloudDownloadOutlined />} loading={installingId === entry.id} disabled={!!installingId || (!!current && current.source === 'built-in')}
                    onClick={() => void install(entry)}>{update ? 'Update' : 'Install'}</Button>}
              </div>
            </Card>
          })}</div>}
    </Spin>
  </div>
}
