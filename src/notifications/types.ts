export type NotificationKind = 'info' | 'success' | 'warning' | 'error'

export type AppNotification = {
  id: string
  title: string
  body: string | null
  kind: NotificationKind
  /** Who sent it: 'downloads', 'library', or a module id. */
  source: string
  /** App route to open when the notification is clicked, e.g. '/downloads'. */
  link: string | null
  createdAt: number
  read: boolean
}

export type NotificationInput = {
  title: string
  body?: string
  kind?: NotificationKind
  link?: string
}
