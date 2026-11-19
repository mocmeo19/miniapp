import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { basename } from 'node:path'
import type { DownloadItem, DownloadRequest } from '../../downloads/types'
import type { DownloadStore, StoredDownload } from './DownloadStore'
import { nameFromResponse, nameFromUrl, safeFileName, uniquePath } from './fileNames'

const publishInterval = 250

type Transfer = { controller: AbortController; speed: number; target?: string; done?: Promise<void> }
type Waiter = { resolve: (item: DownloadItem) => void; reject: (error: Error) => void }

export function downloadUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a valid link')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a valid link') }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw new Error('Only HTTP and HTTPS links can be downloaded')
  return url.toString()
}

/** Queues and runs file downloads for the app and its modules, a few at a time. */
export class DownloadManager {
  private readonly transfers = new Map<string, Transfer>()
  private readonly waiters = new Map<string, Waiter[]>()
  private readonly lastPublish = new Map<string, number>()
  private readonly watchers = new Map<string, Set<(item: DownloadItem) => void>>()
  private disposed = false

  constructor(
    private readonly store: DownloadStore,
    private readonly defaultFolder: () => string,
    private readonly publish: { item: (item: DownloadItem) => void; list: (items: DownloadItem[]) => void; finished?: (item: DownloadItem) => void },
    private readonly concurrency = 3
  ) {}

  list(): DownloadItem[] { return this.store.list().map((item) => this.view(item)) }

  get(id: string): DownloadItem | undefined {
    const item = this.store.get(id)
    return item && this.view(item)
  }

  /** Adds a download to the queue. `folder` defaults to the app's Downloads folder. */
  start(request: DownloadRequest, owner = 'app', folder?: string): DownloadItem {
    const url = downloadUrl(request.url)
    const item: StoredDownload = {
      id: randomUUID(), url, fileName: request.fileName ? safeFileName(request.fileName) : nameFromUrl(url), customName: !!request.fileName,
      path: null, folder: folder ?? this.defaultFolder(), owner, status: 'queued', received: 0, total: null, error: null, createdAt: Date.now(), finishedAt: null
    }
    this.store.insert(item)
    this.emit(item.id, true)
    this.pump()
    return this.view(item)
  }

  /** Resolves when the download completes; rejects if it fails or is cancelled. */
  wait(id: string): Promise<DownloadItem> {
    const item = this.get(id)
    if (!item) return Promise.reject(new Error('Download not found'))
    if (item.status === 'completed') return Promise.resolve(item)
    if (item.status === 'failed' || item.status === 'cancelled') return Promise.reject(new Error(item.error ?? `Download ${item.status}`))
    return new Promise((resolve, reject) => this.waiters.set(id, [...(this.waiters.get(id) ?? []), { resolve, reject }]))
  }

  /** Calls `listener` with every update of one download until the returned function is called. */
  watch(id: string, listener: (item: DownloadItem) => void): () => void {
    const listeners = this.watchers.get(id) ?? new Set()
    listeners.add(listener)
    this.watchers.set(id, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.watchers.delete(id)
    }
  }

  /** Queues a download into `folder`, reports progress, cancels when `signal` aborts, and resolves when it completes. */
  async downloadTo(options: DownloadRequest & { folder: string; owner: string; signal?: AbortSignal; onProgress?: (item: DownloadItem) => void }): Promise<DownloadItem> {
    const { folder, owner, signal, onProgress, ...request } = options
    if (signal?.aborted) throw new Error('Download cancelled')
    const item = this.start(request, owner, folder)
    const unwatch = onProgress ? this.watch(item.id, onProgress) : () => undefined
    const abort = () => this.cancel(item.id)
    signal?.addEventListener('abort', abort, { once: true })
    try { return await this.wait(item.id) }
    finally {
      unwatch()
      signal?.removeEventListener('abort', abort)
    }
  }

  cancel(id: string): void {
    const item = this.store.get(id)
    if (!item || (item.status !== 'queued' && item.status !== 'running')) return
    const transfer = this.transfers.get(id)
    if (transfer) { transfer.controller.abort(); return }
    this.finish(id, { status: 'cancelled', error: 'Cancelled' })
  }

  retry(id: string): DownloadItem {
    const item = this.store.get(id)
    if (!item) throw new Error('Download not found')
    if (item.status !== 'failed' && item.status !== 'cancelled') throw new Error('Only failed or cancelled downloads can be retried')
    this.store.update(id, { status: 'queued', received: 0, total: null, error: null, finishedAt: null, path: null })
    this.emit(id, true)
    this.pump()
    return this.get(id)!
  }

  /** Forgets a download; the downloaded file itself stays on disk. */
  remove(id: string): DownloadItem[] {
    this.cancel(id)
    this.store.remove(id)
    return this.emitList()
  }

  clearFinished(): DownloadItem[] {
    this.store.clearFinished()
    return this.emitList()
  }

  /** Stops every transfer and resolves once they have finished writing, so the store can be closed afterwards. */
  async dispose(): Promise<void> {
    this.disposed = true
    const running = [...this.transfers.values()]
    running.forEach((transfer) => transfer.controller.abort())
    await Promise.allSettled(running.map((transfer) => transfer.done))
  }

  private view(item: StoredDownload): DownloadItem {
    const { folder: _folder, customName: _customName, ...rest } = item
    return { ...rest, speed: this.transfers.get(item.id)?.speed ?? 0 }
  }

  private emit(id: string, force = false): void {
    const now = Date.now()
    if (!force && now - (this.lastPublish.get(id) ?? 0) < publishInterval) return
    this.lastPublish.set(id, now)
    const item = this.get(id)
    if (!item) return
    this.publish.item(item)
    for (const listener of this.watchers.get(id) ?? []) listener(item)
  }

  private emitList(): DownloadItem[] {
    const items = this.list()
    this.publish.list(items)
    return items
  }

  private finish(id: string, patch: Parameters<DownloadStore['update']>[1]): void {
    this.store.update(id, { ...patch, finishedAt: Date.now() })
    this.lastPublish.delete(id)
    this.emit(id, true)
    const item = this.get(id)
    if (item) this.publish.finished?.(item)
    for (const waiter of this.waiters.get(id) ?? []) {
      if (item?.status === 'completed') waiter.resolve(item)
      else waiter.reject(new Error(item?.error ?? 'Download did not complete'))
    }
    this.waiters.delete(id)
  }

  private pump(): void {
    while (!this.disposed && this.transfers.size < this.concurrency) {
      const next = this.store.nextQueued()
      if (!next) return
      const transfer: Transfer = { controller: new AbortController(), speed: 0 }
      this.transfers.set(next.id, transfer)
      this.store.update(next.id, { status: 'running' })
      transfer.done = this.run(next, transfer).finally(() => {
        this.transfers.delete(next.id)
        this.pump()
      })
    }
  }

  private reserved(): Set<string> {
    return new Set([...this.transfers.values()].map((transfer) => transfer.target).filter((target): target is string => !!target))
  }

  private async run(item: StoredDownload, transfer: Transfer): Promise<void> {
    let temporary: string | null = null
    try {
      this.emit(item.id, true)
      const response = await net.fetch(item.url, { signal: transfer.controller.signal })
      if (!response.ok || !response.body) throw new Error(`The server answered HTTP ${response.status}`)
      const length = Number(response.headers.get('content-length'))
      const total = Number.isFinite(length) && length > 0 ? length : null
      const fileName = item.customName ? item.fileName : nameFromResponse(response.headers, response.url || item.url)
      await mkdir(item.folder, { recursive: true })
      const target = uniquePath(item.folder, fileName, this.reserved())
      transfer.target = target
      temporary = `${target}.part`
      this.store.update(item.id, { fileName: basename(target), total })
      const output = createWriteStream(temporary, { flags: 'wx' })
      let received = 0
      let windowStart = Date.now()
      let windowBytes = 0
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.length
          windowBytes += chunk.length
          if (!output.write(chunk)) await once(output, 'drain')
          const now = Date.now()
          if (now - windowStart >= 500) { transfer.speed = windowBytes / ((now - windowStart) / 1000); windowStart = now; windowBytes = 0 }
          this.store.update(item.id, { received })
          this.emit(item.id)
        }
      } finally {
        await new Promise<void>((resolve) => output.end(() => resolve()))
      }
      await rename(temporary, target)
      temporary = null
      transfer.speed = 0
      this.finish(item.id, { status: 'completed', path: target, received, total: total ?? received, error: null })
    } catch (error) {
      if (temporary) await rm(temporary, { force: true }).catch(() => undefined)
      transfer.speed = 0
      if (transfer.controller.signal.aborted) this.finish(item.id, { status: 'cancelled', error: 'Cancelled' })
      else this.finish(item.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
}
