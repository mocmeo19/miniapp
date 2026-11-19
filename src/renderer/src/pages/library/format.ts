import type { LibraryFile } from '../../../../library/types'

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function fileDate(timestamp: number): string {
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function mediaUrl(file: LibraryFile): string {
  return `miniapp-library://media/${file.id}?v=${file.modifiedAt}`
}
