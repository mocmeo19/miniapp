import type { AutoTagModels, AutoTagStatus } from '../../../library/types'
import type { AutoTagStore, PendingImage } from './AutoTagStore'
import { ImageClassifier } from './ImageClassifier'
import { loadImage } from './imageTensor'
import { ensureModel, isModelReady, type ModelFetcher } from './modelFiles'
import { defaultModelIds, modelSpecs, modelVersion, specsFor, type ModelSpec } from './models'

const batchSize = 16
const concurrency = 3
const publishInterval = 250

type ResolvePath = (path: string, folderPath: string) => Promise<string>

async function forEachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => { while (next < items.length) await task(items[next++]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export class AutoTagger {
  private status: Omit<AutoTagStatus, 'pending'>
  private running: Promise<void> | null = null
  private controller: AbortController | null = null
  private readonly classifiers = new Map<string, ImageClassifier>()
  private specs: ModelSpec[]
  private again = false
  private lastPublish = 0
  // Images asked for from a context menu; tagged first, even while automatic tagging is off.
  private requested: PendingImage[] = []

  constructor(
    private readonly store: AutoTagStore,
    private readonly modelDirectory: () => string,
    private readonly resolvePath: ResolvePath,
    private readonly publish: (status: AutoTagStatus) => void,
    private readonly legacyModelDirectories: () => string[] = () => [],
    private readonly fetchModel?: ModelFetcher
  ) {
    this.status = { enabled: store.enabled(), phase: 'idle', done: 0, total: 0 }
    this.specs = specsFor(store.selectedModels() ?? defaultModelIds)
  }

  private get version(): string { return modelVersion(this.specs) }

  current(): AutoTagStatus {
    return { ...this.status, pending: this.store.pendingCount(this.version) }
  }

  async models(): Promise<AutoTagModels> {
    const directory = this.modelDirectory()
    const models = await Promise.all(modelSpecs.map(async ({ id, name, description, tagExamples, size, license, ...spec }) => ({
      id, name, description, tagExamples, size, license, downloaded: await isModelReady({ id, size, ...spec }, directory)
    })))
    return { models, selected: this.specs.map((spec) => spec.id) }
  }

  async setModels(ids: string[]): Promise<AutoTagModels> {
    const chosen = modelSpecs.filter((spec) => ids.includes(spec.id))
    if (chosen.length === 0) throw new Error('Choose at least one model')
    this.store.setSelectedModels(chosen.map((spec) => spec.id))
    this.stop()
    await this.running
    this.specs = chosen
    for (const [id, classifier] of this.classifiers) {
      if (chosen.some((spec) => spec.id === id)) continue
      await classifier.dispose()
      this.classifiers.delete(id)
    }
    this.start()
    this.emit(true)
    return this.models()
  }

  setEnabled(enabled: boolean): AutoTagStatus {
    this.store.setEnabled(enabled)
    this.status.enabled = enabled
    if (enabled) this.start()
    else if (this.requested.length === 0) this.stop()
    this.emit(true)
    return this.current()
  }

  async clear(): Promise<AutoTagStatus> {
    this.store.setEnabled(false)
    this.status.enabled = false
    this.requested = []
    this.stop()
    await this.running
    this.store.clear()
    this.emit(true)
    return this.current()
  }

  /** Tags these images now, whether or not automatic tagging is on. */
  tagNow(images: PendingImage[]): AutoTagStatus {
    const queued = new Set(this.requested.map((image) => image.id))
    this.requested.push(...images.filter((image) => !queued.has(image.id)))
    this.start()
    return this.current()
  }

  start(): void {
    if (!this.status.enabled && this.requested.length === 0) return
    if (this.running) { this.again = true; return }
    this.running = this.run().finally(() => {
      this.running = null
      if (this.again) { this.again = false; this.start() }
    })
  }

  async dispose(): Promise<void> {
    this.stop()
    await this.running
    for (const classifier of this.classifiers.values()) await classifier.dispose()
    this.classifiers.clear()
  }

  private stop(): void {
    this.again = false
    this.controller?.abort()
  }

  private update(changes: Partial<AutoTagStatus>, force = false): void {
    Object.assign(this.status, changes)
    this.emit(force)
  }

  private emit(force: boolean): void {
    const now = Date.now()
    if (!force && now - this.lastPublish < publishInterval) return
    this.lastPublish = now
    this.publish(this.current())
  }

  /** Downloads and loads every chosen model that is not loaded yet; progress covers all of them. */
  private async loadModels(signal: AbortSignal): Promise<void> {
    const missing = this.specs.filter((spec) => !this.classifiers.has(spec.id))
    if (missing.length === 0) return
    let finished = 0
    this.update({ phase: 'downloading', done: 0, total: missing.reduce((sum, spec) => sum + spec.size, 0), error: undefined }, true)
    for (const spec of missing) {
      const path = await ensureModel(spec, this.modelDirectory(), (received) => this.update({ done: finished + received }), signal, this.legacyModelDirectories(), this.fetchModel)
      this.classifiers.set(spec.id, await ImageClassifier.load(path, spec.preprocess))
      finished += spec.size
      this.update({ done: finished })
    }
  }

  private async run(): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    try {
      await this.loadModels(controller.signal)
      const version = this.version
      let done = 0
      const remaining = () => this.requested.length + (this.status.enabled ? this.store.pendingCount(version) : 0)
      this.update({ phase: 'tagging', done, total: remaining(), error: undefined }, true)
      while (!controller.signal.aborted) {
        const batch = this.requested.length > 0
          ? this.requested.splice(0, batchSize)
          : this.status.enabled ? this.store.pending(version, batchSize) : []
        if (batch.length === 0) break
        await forEachLimited(batch, concurrency, async (item) => {
          if (controller.signal.aborted) return
          const tags = await this.tagsFor(item)
          if (controller.signal.aborted) return
          this.store.apply(item.id, version, tags)
          done++
        })
        this.update({ done, total: done + remaining() })
      }
      this.update({ phase: 'idle' }, true)
    } catch (error) {
      if (controller.signal.aborted) this.update({ phase: 'idle' }, true)
      else this.update({ phase: 'error', error: error instanceof Error ? error.message : String(error) }, true)
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }

  private async tagsFor(item: PendingImage): Promise<string[]> {
    try {
      const image = await loadImage(await this.resolvePath(item.path, item.folderPath))
      const tags = new Set<string>()
      for (const spec of this.specs) {
        const classifier = this.classifiers.get(spec.id)
        if (classifier) for (const tag of spec.tags(await classifier.probabilities(image))) tags.add(tag)
      }
      return [...tags]
    } catch {
      // Unreadable or unsupported images are marked as processed without tags.
      return []
    }
  }
}
