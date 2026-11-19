import { randomUUID } from 'node:crypto'
import type { AppNotification, NotificationInput, NotificationKind } from '../../notifications/types'
import type { NotificationStore } from './NotificationStore'

const kinds: NotificationKind[] = ['info', 'success', 'warning', 'error']

/** Collects notifications from the app and its modules and shows them in the header. */
export class NotificationCenter {
  constructor(
    private readonly store: NotificationStore,
    private readonly publish: { added: (item: AppNotification) => void; list: (items: AppNotification[]) => void }
  ) {}

  list(): AppNotification[] { return this.store.list() }

  notify(source: string, input: NotificationInput): AppNotification {
    if (typeof input?.title !== 'string' || !input.title.trim()) throw new Error('A notification needs a title')
    const item: AppNotification = {
      id: randomUUID(),
      title: input.title.trim().slice(0, 140),
      body: typeof input.body === 'string' && input.body.trim() ? input.body.trim().slice(0, 500) : null,
      kind: input.kind && kinds.includes(input.kind) ? input.kind : 'info',
      source,
      // Only in-app routes, never external URLs.
      link: typeof input.link === 'string' && /^\/[\w\-/]*$/.test(input.link) ? input.link : null,
      createdAt: Date.now(),
      read: false
    }
    this.store.insert(item)
    this.publish.added(item)
    return item
  }

  markRead(id: string): AppNotification[] { this.store.markRead(id); return this.emitList() }
  markAllRead(): AppNotification[] { this.store.markAllRead(); return this.emitList() }
  clear(): AppNotification[] { this.store.clear(); return this.emitList() }

  private emitList(): AppNotification[] {
    const items = this.list()
    this.publish.list(items)
    return items
  }
}
