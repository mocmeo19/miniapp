import { CloseOutlined, DisconnectOutlined, MobileOutlined, ReloadOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { deviceActions } from './actions'
import { wallCapacity, wallColumns, wallRows, type VideoMessage, type WallDevice } from './types'

const invoke = <T,>(action: string, payload?: unknown) => window.desktop!.modules.invoke<T>('mobilefarm', action, payload)

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

// "avc1.PPCCLL" from the SPS NAL (profile, constraint flags, level) found in the Annex B config packet.
function codecFromConfig(config: Uint8Array): string {
  for (let i = 0; i + 4 < config.length; i++) {
    const start = config[i] === 0 && config[i + 1] === 0 && (config[i + 2] === 1 || (config[i + 2] === 0 && config[i + 3] === 1))
    if (!start) continue
    const nal = i + (config[i + 2] === 1 ? 3 : 4)
    if ((config[nal] & 0x1f) === 7 && nal + 3 < config.length) return `avc1.${[config[nal + 1], config[nal + 2], config[nal + 3]].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return 'avc1.42e01f'
}

// Decodes one device's H.264 stream (Annex B) onto a canvas.
class StreamDecoder {
  private decoder: VideoDecoder | null = null
  private config: Uint8Array | null = null
  private waitingForKey = true
  private disposed = false

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onSize: (width: number, height: number) => void) {}

  handle(message: VideoMessage): void {
    if (message.kind === 'session') {
      this.canvas.width = message.width
      this.canvas.height = message.height
      this.onSize(message.width, message.height)
    } else if (message.kind === 'config') {
      this.config = message.data
      this.configure(message.data)
    } else if (message.kind === 'frame') this.decode(message)
  }

  private configure(config: Uint8Array): void {
    this.decoder?.close()
    const context = this.canvas.getContext('2d')
    const decoder = new VideoDecoder({
      output: (frame) => { if (!this.disposed) context?.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height); frame.close() },
      error: () => { if (this.decoder === decoder) this.decoder = null }
    })
    decoder.configure({ codec: codecFromConfig(config), optimizeForLatency: true, avc: { format: 'annexb' } } as VideoDecoderConfig)
    this.decoder = decoder
    this.waitingForKey = true
  }

  private decode(message: Extract<VideoMessage, { kind: 'frame' }>): void {
    const decoder = this.decoder
    if (!decoder || decoder.state !== 'configured' || (this.waitingForKey && !message.key)) return
    const data = this.waitingForKey && this.config ? concat(this.config, message.data) : message.data
    this.waitingForKey = false
    decoder.decode(new EncodedVideoChunk({ type: message.key ? 'key' : 'delta', timestamp: message.pts, data }))
  }

  dispose(): void {
    this.disposed = true
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close()
    this.decoder = null
  }
}

type Registered = { decoder: StreamDecoder; closed: (reason: string) => void }
const registry = new Map<string, Registered>()

function Tile({ device, onRemove }: { device: WallDevice; onRemove: (serial: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [error, setError] = useState('')
  const [wasLive, setWasLive] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setError('')
    const decoder = new StreamDecoder(canvas, (width, height) => { setSize({ width, height }); setWasLive(true) })
    registry.set(device.serial, { decoder, closed: (reason) => setError(reason || 'Stream ended') })
    void invoke(attempt > 0 ? 'wall-reconnect' : 'wall-attach', device.serial).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => { if (registry.get(device.serial)?.decoder === decoder) registry.delete(device.serial); decoder.dispose() }
  }, [device.serial, attempt])

  useLayoutEffect(() => {
    const element = boxRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Fit the canvas inside the tile so its on-screen rectangle maps 1:1 onto device coordinates.
  const scale = size ? Math.min(box.width / size.width, box.height / size.height) : 0
  const pending = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef(0)
  const dragging = useRef(false)

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * (size?.width ?? 0), y: ((event.clientY - rect.top) / rect.height) * (size?.height ?? 0) }
  }
  const touch = (action: 0 | 1 | 2, position: { x: number; y: number }) => { void invoke('wall-touch', { serial: device.serial, action, ...position }) }
  const flushMove = () => {
    frame.current = 0
    if (pending.current && dragging.current) touch(2, pending.current)
    pending.current = null
  }

  return <div className="wall-tile">
    <div className="wall-tile-head">
      <span className={`wall-dot${error ? ' error' : size ? ' live' : ''}`} />
      <span className="wall-tile-title" title={device.serial}>{device.model || device.serial}</span>
      <button className="wall-icon" aria-label={`Remove ${device.model || device.serial} from wall`} title="Remove from wall" onClick={() => onRemove(device.serial)}><CloseOutlined /></button>
    </div>
    <div className="wall-tile-main">
      <div className="wall-actions" role="toolbar" aria-label={`Actions for ${device.model || device.serial}`}>
        {deviceActions.map((item) => <button key={item.action} className="wall-icon" title={item.label} aria-label={item.label} onClick={() => void invoke('action', { serial: device.serial, action: item.action })}>{item.icon}</button>)}
      </div>
      <div className="wall-tile-body" ref={boxRef}>
        <canvas ref={canvasRef} className="wall-canvas" style={size ? { width: size.width * scale, height: size.height * scale } : { display: 'none' }}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; touch(0, point(event)) }}
          onPointerMove={(event) => { if (!dragging.current) return; pending.current = point(event); if (!frame.current) frame.current = requestAnimationFrame(flushMove) }}
          onPointerUp={(event) => { if (!dragging.current) return; dragging.current = false; pending.current = null; touch(1, point(event)) }}
          onPointerCancel={(event) => { if (!dragging.current) return; dragging.current = false; touch(1, point(event)) }} />
        {!size && !error && <div className="wall-note"><MobileOutlined /> Connecting…</div>}
        {error && <div className="wall-note lost">
        <DisconnectOutlined className="wall-lost-icon" />
        <strong>{wasLive ? 'Connection lost' : 'Could not connect'}</strong>
        <span className="wall-lost-reason" title={error}>{error}</span>
        <button className="wall-reconnect" onClick={() => { setError(''); setSize(null); setAttempt((value) => value + 1) }}><ReloadOutlined /> Reconnect</button>
      </div>}
      </div>
    </div>
  </div>
}

export function MirrorWall() {
  const [devices, setDevices] = useState<WallDevice[]>([])
  const remove = useCallback((serial: string) => { void invoke('wall-remove', serial) }, [])

  useEffect(() => {
    document.title = 'Mobile Farm — Mirror wall'
    const offVideo = window.desktop!.modules.on<VideoMessage>('mobilefarm', 'video', (message) => {
      const entry = registry.get(message.serial)
      if (!entry) return
      if (message.kind === 'closed') entry.closed(message.reason)
      else entry.decoder.handle(message)
    })
    const offDevices = window.desktop!.modules.on<WallDevice[]>('mobilefarm', 'devices', setDevices)
    void invoke<WallDevice[]>('wall-devices').then(setDevices)
    return () => { offVideo(); offDevices() }
  }, [])

  return <div className="wall" style={{ gridTemplateColumns: `repeat(${wallColumns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${wallRows}, minmax(0, 1fr))` }}>
    {Array.from({ length: wallCapacity }, (_, index) => devices[index]
      ? <Tile key={devices[index].serial} device={devices[index]} onRemove={remove} />
      : <div key={`empty-${index}`} className="wall-tile wall-empty"><MobileOutlined /><span>Empty slot</span></div>)}
  </div>
}
