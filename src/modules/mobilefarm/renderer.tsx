import { DisconnectOutlined, InfoCircleOutlined, MobileOutlined, PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, WifiOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Descriptions, Empty, Input, InputNumber, Modal, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { ModulePage } from '../core/ModulePage'
import type { RendererModule } from '../core/renderer'
import { wallCapacity, wallColumns, wallRows, type DeviceInfo, type FarmStatus, type MirrorOptions } from './types'

const { Text } = Typography

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

function infoValue(info: DeviceInfo | undefined, label: string): string {
  for (const section of info?.sections ?? []) for (const [name, value] of section.rows) if (name === label) return value
  return ''
}

// The few facts worth showing on every row; the full list stays in the dialog.
function highlights(info: DeviceInfo | undefined): { key: string; text: string; color?: string }[] {
  if (!info) return []
  const battery = infoValue(info, 'Level')
  const level = Number.parseInt(battery, 10)
  const charging = infoValue(info, 'Status') === 'charging'
  const android = infoValue(info, 'Android')
  const ram = infoValue(info, 'RAM available')
  const free = infoValue(info, 'Data free')
  const ip = infoValue(info, 'Wi-Fi IP')
  return [
    battery && { key: 'battery', text: `${charging ? '⚡ ' : ''}${battery}`, color: level <= 20 && !charging ? 'red' : level <= 40 && !charging ? 'orange' : 'green' },
    android && { key: 'android', text: `Android ${android}${infoValue(info, 'API level') ? ` (API ${infoValue(info, 'API level')})` : ''}` },
    infoValue(info, 'Resolution') && { key: 'screen', text: infoValue(info, 'Resolution') },
    ram && { key: 'ram', text: `RAM ${ram} free` },
    free && { key: 'storage', text: `Storage ${free} free` },
    infoValue(info, 'Temperature') && { key: 'temp', text: infoValue(info, 'Temperature') },
    ip && { key: 'ip', text: ip }
  ].filter((item): item is { key: string; text: string; color?: string } => Boolean(item))
}

function MobileFarm() {
  const [status, setStatus] = useState<FarmStatus | null>(null)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (action: string, payload?: unknown, quiet = false) => {
    if (!window.desktop) return
    try { setStatus(await window.desktop.modules.invoke<FarmStatus>('mobilefarm', action, payload)) }
    catch (cause) { if (!quiet) message.error(errorMessage(cause)) }
  }, [])

  useEffect(() => {
    void call('status', undefined, true)
    const timer = window.setInterval(() => void call('status', undefined, true), 3000)
    return () => window.clearInterval(timer)
  }, [call])

  // Thumbnails refresh one device at a time so adb is never flooded with screencaps.
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const readySerials = (status?.devices ?? []).filter((device) => device.state === 'device').map((device) => device.serial).join(',')
  useEffect(() => {
    if (!window.desktop || !readySerials) return
    let cancelled = false
    let timer = 0
    const cycle = async () => {
      for (const serial of readySerials.split(',')) {
        if (cancelled) return
        try {
          const image = await window.desktop!.modules.invoke<string>('mobilefarm', 'thumbnail', serial)
          if (!cancelled) setThumbs((current) => ({ ...current, [serial]: image }))
        } catch { /* device busy or locked; keep the previous thumbnail */ }
      }
      if (!cancelled) timer = window.setTimeout(() => void cycle(), 4000)
    }
    void cycle()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [readySerials])

  const [infoFor, setInfoFor] = useState<{ serial: string; title: string } | null>(null)
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [infoError, setInfoError] = useState('')
  // Highlights refresh slowly (battery and memory drift); one device at a time like thumbnails.
  const [infos, setInfos] = useState<Record<string, DeviceInfo>>({})
  useEffect(() => {
    if (!window.desktop || !readySerials) return
    let cancelled = false
    let timer = 0
    const cycle = async () => {
      for (const serial of readySerials.split(',')) {
        if (cancelled) return
        try {
          const next = await window.desktop!.modules.invoke<DeviceInfo>('mobilefarm', 'info', serial)
          if (!cancelled) setInfos((current) => ({ ...current, [serial]: next }))
        } catch { /* keep the last known values */ }
      }
      if (!cancelled) timer = window.setTimeout(() => void cycle(), 30000)
    }
    void cycle()
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [readySerials])

  const showInfo = async (serial: string, title: string) => {
    setInfoFor({ serial, title })
    setInfo(null)
    setInfoError('')
    try { setInfo(await window.desktop!.modules.invoke<DeviceInfo>('mobilefarm', 'info', serial)) }
    catch (cause) { setInfoError(errorMessage(cause)) }
  }

  const options = status?.options
  const setOption = <K extends keyof MirrorOptions>(key: K, value: MirrorOptions[K]) => {
    if (!options) return
    const next = { ...options, [key]: value }
    setStatus((current) => current && { ...current, options: next })
    void window.desktop?.modules.invoke('mobilefarm', 'set-options', next)
  }
  const ready = status?.devices.filter((device) => device.state === 'device') ?? []
  const mirroring = status?.devices.filter((device) => device.mirroring).length ?? 0

  return <ModulePage title="Mobile Farm" description={`Mirror and control up to ${wallCapacity} Android devices in one window, powered by scrcpy.`} icon={<MobileOutlined />}
    actions={<Space>
      <Button icon={<PlayCircleOutlined />} type="primary" disabled={ready.length === 0} onClick={() => void call('start-all')}>{mirroring > 0 ? 'Show mirror wall' : `Mirror all (${wallColumns} × ${wallRows} wall)`}</Button>
      <Button icon={<PoweroffOutlined />} danger disabled={mirroring === 0} onClick={() => void call('stop-all')}>Stop all</Button>
    </Space>}>
    {!window.desktop && <Alert type="warning" showIcon title="Open this page in the Electron app to manage devices." className="video-alert" />}
    {status && !status.adb && <Alert type="error" showIcon className="video-alert" title="adb not found" description="Install Android platform-tools (macOS: brew install android-platform-tools) and restart the app." />}
    {status && status.adb && !status.server && <Alert type="error" showIcon className="video-alert" title="scrcpy-server not found" description="Run npm run setup:media to bundle scrcpy, then restart the app." />}
    <div className="video-layout">
      <Card className="video-card">
        <div className="video-list-head">
          <div><h3>Devices</h3><p>{ready.length} ready · {mirroring} mirroring</p></div>
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} aria-label="Refresh devices" loading={busy} onClick={async () => { setBusy(true); await call('status'); setBusy(false) }} /></Tooltip>
        </div>
        {!status || status.devices.length === 0
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No devices. Plug in via USB with debugging enabled, or connect over Wi-Fi." />
          : <ul className="video-list">{status.devices.map((device) => <li key={device.serial}>
            <div className="video-row">
              <span className="farm-thumb">{thumbs[device.serial] ? <img src={thumbs[device.serial]} alt={`Screen of ${device.model || device.serial}`} /> : <MobileOutlined />}</span>
              <span className="farm-device">
                <span className="video-row-title" title={device.serial}>{infoValue(infos[device.serial], 'Manufacturer') ? `${infoValue(infos[device.serial], 'Manufacturer')} ` : ''}{device.model || device.serial}</span>
                <Text type="secondary" style={{ fontSize: 11 }} ellipsis>{device.serial}</Text>
                <span className="farm-chips">{highlights(infos[device.serial]).map((item) => <Tag key={item.key} color={item.color} variant="filled">{item.text}</Tag>)}</span>
              </span>
              <Tag color={device.state === 'device' ? (device.mirroring ? 'green' : 'blue') : 'orange'}>{device.mirroring ? 'mirroring' : device.state}</Tag>
            </div>
            <Space size={4}>
              {device.mirroring
                ? <Button size="small" danger onClick={() => void call('stop', device.serial)}>Stop</Button>
                : <Button size="small" type="primary" disabled={device.state !== 'device'} onClick={() => void call('start', device.serial)}>Mirror</Button>}
              <Tooltip title="Device information"><Button size="small" type="text" aria-label={`Information for ${device.serial}`} icon={<InfoCircleOutlined />} disabled={device.state !== 'device'} onClick={() => void showInfo(device.serial, device.model || device.serial)} /></Tooltip>
              {device.serial.includes(':') && <Tooltip title="Disconnect"><Button size="small" type="text" aria-label={`Disconnect ${device.serial}`} icon={<DisconnectOutlined />} onClick={() => void call('disconnect', device.serial)} /></Tooltip>}
            </Space>
          </li>)}</ul>}
      </Card>

      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Card className="video-card" title="Connect over Wi-Fi">
          <Space.Compact style={{ width: '100%' }}>
            <Input prefix={<WifiOutlined />} placeholder="192.168.1.20:5555" value={address} onChange={(event) => setAddress(event.target.value)} onPressEnter={() => void call('connect', address)} />
            <Button type="primary" disabled={!address.trim()} onClick={async () => { await call('connect', address); setAddress('') }}>Connect</Button>
          </Space.Compact>
        </Card>
        {options && <Card className="video-card" title="Mirror options">
          <Space orientation="vertical" size="small">
            <Space>Max size <InputNumber min={240} max={2048} step={80} value={options.maxSize} onChange={(value) => setOption('maxSize', value ?? 640)} /></Space>
            <Space>Bitrate <InputNumber min={1} max={50} value={options.bitrate} suffix="Mbps" onChange={(value) => setOption('bitrate', value ?? 2)} /></Space>
            <Space>Max FPS <InputNumber min={1} max={60} value={options.maxFps} onChange={(value) => setOption('maxFps', value ?? 30)} /></Space>
            <Checkbox checked={options.viewOnly} onChange={(event) => setOption('viewOnly', event.target.checked)}>View only (no touch control)</Checkbox>
            <Checkbox checked={options.stayAwake} disabled={options.viewOnly} onChange={(event) => setOption('stayAwake', event.target.checked)}>Keep device awake</Checkbox>
            <Text type="secondary">Options apply the next time a tile connects.</Text>
          </Space>
        </Card>}
      </Space>
    </div>
    <Modal open={infoFor !== null} title={infoFor ? `${infoFor.title} — information` : ''} footer={null} width={560} onCancel={() => setInfoFor(null)}>
      {infoError ? <Alert type="error" showIcon title={infoError} /> : !info ? <Spin /> : info.sections.map((section) =>
        <Descriptions key={section.title} title={section.title} size="small" column={1} bordered style={{ marginBottom: 16 }}
          items={section.rows.map(([label, value]) => ({ key: label, label, children: value }))} />)}
    </Modal>
  </ModulePage>
}

export const mobileFarmRendererModule: RendererModule = {
  id: 'mobilefarm',
  label: 'Mobile Farm',
  icon: <MobileOutlined />,
  element: <MobileFarm />
}
