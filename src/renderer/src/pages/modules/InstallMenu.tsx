import { CloudDownloadOutlined, DownOutlined, FileZipOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Dropdown, Input, Modal, message } from 'antd'
import { useState } from 'react'
import type { InstalledModule } from '../../../../modules/core/types'
import { errorText } from '../../errorText'

function installedMessage(module: InstalledModule) {
  message.success(`${module.name} installed. Enable it to start using it.`)
}

export function InstallMenu({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')

  async function installFile() {
    setBusy(true)
    try {
      const module = await window.desktop!.moduleManager.installFile()
      if (module) installedMessage(module)
    } catch (cause) { message.error(errorText(cause)) }
    finally { setBusy(false) }
  }

  async function installUrl() {
    setBusy(true)
    try {
      installedMessage(await window.desktop!.moduleManager.installUrl(url.trim()))
      setUrlOpen(false)
      setUrl('')
    } catch (cause) { message.error(errorText(cause)) }
    finally { setBusy(false) }
  }

  return <>
    <Dropdown disabled={disabled || busy} trigger={['click']} menu={{
      items: [
        { key: 'file', icon: <FileZipOutlined />, label: 'From file…' },
        { key: 'url', icon: <LinkOutlined />, label: 'From URL…' }
      ],
      onClick: ({ key }) => { if (key === 'file') void installFile(); else setUrlOpen(true) }
    }}>
      <Button type="primary" icon={<PlusOutlined />} loading={busy}>Install <DownOutlined /></Button>
    </Dropdown>
    <Modal open={urlOpen} title="Install from URL" okText="Install" okButtonProps={{ icon: <CloudDownloadOutlined />, disabled: !url.trim().startsWith('https://') }}
      confirmLoading={busy} onOk={() => void installUrl()} onCancel={() => setUrlOpen(false)} destroyOnHidden>
      <p className="modules-modal-help">Paste an HTTPS link to a <code>.miniapp</code> package. Installed modules stay disabled until you enable them.</p>
      <Input autoFocus prefix={<LinkOutlined />} placeholder="https://example.com/module.miniapp" value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={() => { if (url.trim().startsWith('https://')) void installUrl() }} />
    </Modal>
  </>
}
