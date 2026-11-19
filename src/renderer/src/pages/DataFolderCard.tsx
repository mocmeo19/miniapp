import { FolderOpenOutlined } from '@ant-design/icons'
import { Button, Card, Space, message } from 'antd'
import { useEffect, useState } from 'react'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

export function DataFolderCard() {
  const [info, setInfo] = useState<DataDirectoryInfo | null>(null)
  const preferences = window.desktop?.preferences

  useEffect(() => { void preferences?.getDataDirectory().then(setInfo) }, [preferences])

  async function run(action: () => Promise<DataDirectoryInfo | void>) {
    try {
      const next = await action()
      if (next) setInfo(next)
    } catch (cause) { message.error(errorText(cause)) }
  }

  const isDefault = !!info && info.path === info.defaultPath
  return <Card className="settings-card"><div className="settings-row">
    <div className="settings-icon"><FolderOpenOutlined /></div>
    <div>
      <h3>Data folder</h3>
      <p>Everything Miniapp downloads or creates is saved here. Each module keeps its files in its own folder, for example <code>youtube/</code>, <code>mobilefarm/</code> and <code>library/</code>.</p>
      <div className="settings-path-box"><code title={info?.path}>{info?.path ?? 'Loading…'}</code>{isDefault && <span className="settings-path-note">Default</span>}</div>
    </div>
    <Space wrap>
      <Button size="small" disabled={!preferences} onClick={() => void run(() => preferences!.openDataDirectory())}>Open</Button>
      {!isDefault && info && <Button size="small" onClick={() => void run(() => preferences!.resetDataDirectory())}>Use default</Button>}
      <Button size="small" type="primary" disabled={!preferences} onClick={() => void run(() => preferences!.chooseDataDirectory())}>Change…</Button>
    </Space>
  </div></Card>
}
