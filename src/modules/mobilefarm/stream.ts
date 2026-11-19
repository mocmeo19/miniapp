import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomInt } from 'node:crypto'
import net from 'node:net'
import type { MirrorOptions } from './types'

// scrcpy-server speaks a small binary protocol over adb-forwarded sockets (video first, then control).
const deviceNameBytes = 64
const packetHeaderBytes = 12
const sessionFlag = 0x80000000
const configFlag = 0x40000000
const keyFrameFlag = 0x20000000
const maxPacketBytes = 8 * 1024 * 1024
const serverPath = '/data/local/tmp/scrcpy-server.jar'

export type StreamEvents = {
  session: (width: number, height: number) => void
  config: (data: Buffer) => void
  frame: (data: Buffer, key: boolean, ptsMicros: number) => void
  closed: (reason: string) => void
}

function adb(adbPath: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(adbPath, args, { timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).toString().trim()))
      else resolve(stdout.toString())
    })
  })
}

function connectOnce(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

// adb accepts the TCP connection even before the device socket exists, then closes it; the first byte proves it is live.
async function connectLive(port: number, expectByte: boolean, deadline: number): Promise<{ socket: net.Socket; rest: Buffer }> {
  let lastError = 'server did not start'
  while (Date.now() < deadline) {
    try {
      const socket = await connectOnce(port)
      if (!expectByte) {
        const alive = await new Promise<boolean>((resolve) => {
          const done = (value: boolean) => { socket.off('close', onClose); clearTimeout(timer); resolve(value) }
          const onClose = () => done(false)
          const timer = setTimeout(() => done(true), 250)
          socket.once('close', onClose)
        })
        if (alive) return { socket, rest: Buffer.alloc(0) }
      } else {
        const first = await new Promise<Buffer | null>((resolve) => {
          const done = (value: Buffer | null) => { socket.off('data', onData); socket.off('close', onClose); clearTimeout(timer); resolve(value) }
          const onData = (chunk: Buffer) => { socket.pause(); done(chunk) } // keep later bytes queued until the parser attaches
          const onClose = () => done(null)
          const timer = setTimeout(() => done(null), 1500)
          socket.once('data', onData)
          socket.once('close', onClose)
        })
        if (first && first.length > 0) return { socket, rest: first.subarray(1) }
      }
      socket.destroy()
    } catch (error) { lastError = error instanceof Error ? error.message : String(error) }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(lastError)
}

export class ScrcpySession {
  private video: net.Socket | null = null
  private control: net.Socket | null = null
  private shell: ChildProcess | null = null
  private port = 0
  private stopped = false
  private buffer: Buffer = Buffer.alloc(0)
  private headerRead = false
  private serverOutput = ''

  constructor(
    private readonly adbPath: string,
    private readonly jarPath: string,
    private readonly version: string,
    readonly serial: string,
    private readonly options: MirrorOptions,
    private readonly events: StreamEvents
  ) {}

  async start(): Promise<void> {
    const scid = randomInt(1, 0x7fffffff).toString(16).padStart(8, '0')
    try {
      await adb(this.adbPath, ['-s', this.serial, 'push', this.jarPath, serverPath])
      this.port = Number((await adb(this.adbPath, ['-s', this.serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`])).trim())
      if (!Number.isInteger(this.port) || this.port <= 0) throw new Error('adb forward failed')
      const args = [`scid=${scid}`, 'log_level=info', 'tunnel_forward=true', 'audio=false', `control=${!this.options.viewOnly}`, 'video_codec=h264',
        `max_size=${this.options.maxSize}`, `video_bit_rate=${this.options.bitrate * 1_000_000}`, `max_fps=${this.options.maxFps}`, 'send_frame_meta=true',
        `stay_awake=${this.options.stayAwake && !this.options.viewOnly}`]
      this.shell = spawn(this.adbPath, ['-s', this.serial, 'shell', `CLASSPATH=${serverPath} app_process / com.genymobile.scrcpy.Server ${this.version} ${args.join(' ')}`], { stdio: ['ignore', 'pipe', 'pipe'] })
      const collect = (chunk: Buffer) => { this.serverOutput = (this.serverOutput + chunk.toString()).slice(-2000) }
      this.shell.stdout?.on('data', collect)
      this.shell.stderr?.on('data', collect)
      const serverExit = new Promise<never>((_resolve, reject) => {
        this.shell!.once('exit', () => reject(new Error(this.serverOutput.trim().split('\n').slice(-5).join('\n') || 'scrcpy-server exited')))
        this.shell!.once('error', reject)
      })
      const deadline = Date.now() + 8000
      const connect = async () => {
        const video = await connectLive(this.port, true, deadline)
        this.video = video.socket
        if (!this.options.viewOnly) this.control = (await connectLive(this.port, false, deadline)).socket
        this.attach(video.rest)
      }
      await Promise.race([connect(), serverExit])
      this.shell.once('exit', () => this.close(this.serverOutput.trim().split('\n').slice(-3).join('\n') || 'Device stream ended'))
    } catch (error) {
      this.stop()
      throw error
    }
  }

  private attach(initial: Buffer): void {
    const video = this.video!
    video.on('data', (chunk: Buffer) => this.consume(chunk))
    video.on('close', () => this.close('Device stream ended'))
    video.on('error', () => video.destroy())
    this.control?.on('data', () => undefined) // The server may send clipboard events; they are not needed.
    this.control?.on('error', () => this.control?.destroy())
    if (initial.length) this.consume(initial)
    video.resume()
  }

  private consume(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    if (!this.headerRead) {
      if (this.buffer.length < deviceNameBytes + 4) return
      this.buffer = this.buffer.subarray(deviceNameBytes + 4) // device name + codec id (h264)
      this.headerRead = true
    }
    while (this.buffer.length >= packetHeaderBytes) {
      const high = this.buffer.readUInt32BE(0)
      if (high & sessionFlag) {
        this.events.session(this.buffer.readUInt32BE(4), this.buffer.readUInt32BE(8))
        this.buffer = this.buffer.subarray(packetHeaderBytes)
        continue
      }
      const size = this.buffer.readUInt32BE(8)
      if (size > maxPacketBytes) { this.close('Invalid video packet'); return }
      if (this.buffer.length < packetHeaderBytes + size) return
      const payload = Buffer.from(this.buffer.subarray(packetHeaderBytes, packetHeaderBytes + size))
      const pts = (high & 0x1fffffff) * 4294967296 + this.buffer.readUInt32BE(4)
      this.buffer = this.buffer.subarray(packetHeaderBytes + size)
      if (high & configFlag) this.events.config(payload)
      else this.events.frame(payload, (high & keyFrameFlag) !== 0, pts)
    }
  }

  touch(action: 0 | 1 | 2, x: number, y: number, width: number, height: number): void {
    if (!this.control || this.control.destroyed) return
    const message = Buffer.alloc(32)
    message.writeUInt8(2, 0) // inject touch event
    message.writeUInt8(action, 1)
    message.writeBigUInt64BE(0xffffffffffffffffn, 2) // generic finger pointer id
    message.writeInt32BE(x, 10)
    message.writeInt32BE(y, 14)
    message.writeUInt16BE(width, 18)
    message.writeUInt16BE(height, 20)
    message.writeUInt16BE(action === 1 ? 0 : 0xffff, 22)
    message.writeUInt32BE(action === 1 ? 0 : 1, 24) // action button
    message.writeUInt32BE(action === 1 ? 0 : 1, 28) // buttons
    this.control.write(message)
  }

  key(keycode: number): void {
    if (!this.control || this.control.destroyed) return
    for (const action of [0, 1]) {
      const message = Buffer.alloc(14)
      message.writeUInt8(0, 0) // inject keycode
      message.writeUInt8(action, 1)
      message.writeUInt32BE(keycode, 2)
      this.control.write(message)
    }
  }

  get running(): boolean { return !this.stopped }

  private close(reason: string): void {
    if (this.stopped) return
    this.stop()
    this.events.closed(reason)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.video?.destroy()
    this.control?.destroy()
    this.shell?.kill()
    if (this.port) void adb(this.adbPath, ['-s', this.serial, 'forward', '--remove', `tcp:${this.port}`]).catch(() => undefined)
  }
}
