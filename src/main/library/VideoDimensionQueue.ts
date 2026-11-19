import type { Dimensions } from './mediaDimensions'

type PendingVideo = { id: string; path: string; folderPath: string }

type VideoDimensionSource = {
  pendingVideoDimensions: (limit: number) => PendingVideo[]
  setDimensions: (id: string, dimensions: Dimensions) => void
}

// Each item spawns ffmpeg, so a small batch keeps the machine responsive.
const batchSize = 4

/** Reads missing video sizes in the background after scans, then reports once that sizes changed. */
export class VideoDimensionQueue {
  private running: Promise<void> | null = null
  private again = false
  private stopped = false

  constructor(
    private readonly store: VideoDimensionSource,
    private readonly read: (path: string, folderPath: string) => Promise<Dimensions>,
    private readonly onUpdated: () => void
  ) {}

  start(): void {
    if (this.stopped) return
    if (this.running) { this.again = true; return }
    this.running = this.run().finally(() => {
      this.running = null
      if (this.again && !this.stopped) { this.again = false; this.start() }
    })
  }

  async dispose(): Promise<void> {
    this.stopped = true
    await this.running
  }

  private async run(): Promise<void> {
    let updated = 0
    while (!this.stopped) {
      const batch = this.store.pendingVideoDimensions(batchSize)
      if (batch.length === 0) break
      const sizes = await Promise.all(batch.map((video) => this.read(video.path, video.folderPath)))
      if (this.stopped) break
      batch.forEach((video, index) => this.store.setDimensions(video.id, sizes[index]))
      updated += batch.length
    }
    if (updated > 0 && !this.stopped) this.onUpdated()
  }
}
