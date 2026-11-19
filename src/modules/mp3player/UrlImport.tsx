import { CloudDownloadOutlined, LinkOutlined } from '@ant-design/icons'
import { Alert, Button, Input, Progress, message } from 'antd'
import { useEffect, useState } from 'react'
import type { UrlDownloadEvent } from './types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

/** Downloads music from a link into the module's data folder and adds it to the playlist. */
export function UrlImport({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [job, setJob] = useState<UrlDownloadEvent | null>(null)
  const [starting, setStarting] = useState(false)
  const running = starting || job?.state === 'running'
  const valid = url.trim().startsWith('https://')

  useEffect(() => window.desktop?.modules.on<UrlDownloadEvent>('mp3player', 'download', (event) => {
    setJob(event)
    if (event.state === 'completed') {
      message.success(`Added “${event.title ?? 'track'}” to the playlist`)
      setUrl('')
      onAdded()
    }
  }), [onAdded])

  async function start() {
    if (!valid || running || !window.desktop) return
    setStarting(true)
    try {
      const { jobId } = await window.desktop.modules.invoke<{ jobId: string }>('mp3player', 'download-url', url.trim())
      setJob((current) => current?.jobId === jobId ? current : { jobId, state: 'running', percent: 0, url: url.trim() })
    } catch (cause) { message.error(errorMessage(cause)) }
    finally { setStarting(false) }
  }

  async function cancel() {
    if (job?.state === 'running') await window.desktop?.modules.invoke('mp3player', 'cancel-download', job.jobId).catch(() => undefined)
  }

  return <div className="mp3-import">
    <div className="mp3-import-row">
      <Input prefix={<LinkOutlined />} placeholder="Paste a link to a song or audio file (https://…)" value={url} disabled={running || !window.desktop}
        onChange={(event) => setUrl(event.target.value)} onPressEnter={() => void start()} allowClear />
      {running
        ? <Button onClick={() => void cancel()} disabled={!job?.jobId}>Cancel</Button>
        : <Button type="primary" icon={<CloudDownloadOutlined />} disabled={!valid || !window.desktop} loading={starting} onClick={() => void start()}>Download</Button>}
    </div>
    {job?.state === 'running' && <Progress percent={Math.round(job.percent)} size="small" status="active" />}
    {job?.state === 'failed' && <Alert type="error" showIcon closable title="Could not download this link" description={job.error} onClose={() => setJob(null)} />}
  </div>
}
