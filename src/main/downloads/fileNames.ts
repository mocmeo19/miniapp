import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const maxLength = 180

/** A safe single file name: no separators, control or reserved characters, and a sensible length. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').trim()
  if (!cleaned) return 'download'
  if (cleaned.length <= maxLength) return cleaned
  const extension = extname(cleaned).slice(0, 16)
  return cleaned.slice(0, maxLength - extension.length) + extension
}

/** The last path segment of a URL, or "download". */
export function nameFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (segment) return safeFileName(decodeURIComponent(segment))
  } catch { /* fall through */ }
  return 'download'
}

/** Name from Content-Disposition when the server sends one, otherwise from the URL. */
export function nameFromResponse(headers: Headers, url: string): string {
  const disposition = headers.get('content-disposition') ?? ''
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1]
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition)?.[1]
  try { if (encoded) return safeFileName(decodeURIComponent(encoded)) } catch { /* fall through */ }
  if (plain) return safeFileName(plain)
  return nameFromUrl(url)
}

/** `folder/name`, or `folder/name (2).ext`… when the name is taken on disk or by another running download. */
export function uniquePath(folder: string, name: string, reserved: Set<string>): string {
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  let candidate = join(folder, name)
  for (let copy = 2; existsSync(candidate) || existsSync(`${candidate}.part`) || reserved.has(candidate); copy++) {
    candidate = join(folder, `${stem} (${copy})${extension}`)
  }
  return candidate
}
