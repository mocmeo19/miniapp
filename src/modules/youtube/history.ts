import { readModuleJson, writeModuleJson } from '../core/moduleData'
import type { HistoryDownload, HistoryEntry, HistoryItem, VideoInfo } from './types'

const maxEntries = 50

function isEntry(value: unknown): value is HistoryEntry {
  const entry = value as HistoryEntry | null
  return !!entry && typeof entry.url === 'string' && typeof entry.inspectedAt === 'number'
    && typeof entry.info?.id === 'string' && typeof entry.info.title === 'string' && Array.isArray(entry.info.options)
}

export class SearchHistory {
  private entries: HistoryEntry[]

  constructor(private readonly moduleId: string) {
    const stored = readModuleJson<unknown>(moduleId, 'history', [])
    this.entries = Array.isArray(stored) ? stored.filter(isEntry).slice(0, maxEntries) : []
  }

  list(): HistoryItem[] {
    return this.entries.map(({ url, info, inspectedAt, download }) => ({
      id: info.id, title: info.title, channel: info.channel, duration: info.duration, thumbnail: info.thumbnail,
      url, inspectedAt, download
    }))
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((entry) => entry.info.id === id)
  }

  add(url: string, info: VideoInfo): Promise<void> {
    const previous = this.get(info.id)
    this.entries = [{ url, info, inspectedAt: Date.now(), download: previous?.download },
      ...this.entries.filter((entry) => entry.info.id !== info.id)].slice(0, maxEntries)
    return this.save()
  }

  markDownloaded(id: string, download: HistoryDownload): Promise<void> {
    const entry = this.get(id)
    if (!entry) return Promise.resolve()
    entry.download = download
    return this.save()
  }

  /** Points saved downloads at files that were moved. */
  relocate(moves: Array<{ from: string; to: string }>): Promise<void> {
    const targets = new Map(moves.map((move) => [move.from, move.to]))
    let changed = false
    for (const entry of this.entries) {
      const to = entry.download && targets.get(entry.download.path)
      if (to) { entry.download!.path = to; changed = true }
    }
    return changed ? this.save() : Promise.resolve()
  }

  remove(id: string): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.info.id !== id)
    return this.save()
  }

  clear(): Promise<void> {
    this.entries = []
    return this.save()
  }

  private save(): Promise<void> {
    return writeModuleJson(this.moduleId, 'history', this.entries)
  }
}
