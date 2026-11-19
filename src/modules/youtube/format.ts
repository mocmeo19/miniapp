export function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return 'Size unknown'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]

export function timeAgo(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  return relative.format(0, 'minute')
}
