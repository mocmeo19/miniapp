import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

// Recursively lists files accepted by `accept`, in natural name order, up to `max` files.
export async function scanFolder(folder: string, accept: (path: string) => boolean, max: number, maxDepth = 6, depth = 0, found: string[] = []): Promise<string[]> {
  if (depth > maxDepth || found.length >= max) return found
  let entries
  try { entries = await readdir(folder, { withFileTypes: true }) } catch { return found }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  for (const entry of entries) {
    if (found.length >= max) break
    const path = join(folder, entry.name)
    if (entry.isDirectory()) await scanFolder(path, accept, max, maxDepth, depth + 1, found)
    else if (entry.isFile() && accept(path)) found.push(path)
  }
  return found
}

// Serves a local file for <audio>/<video>, honouring HTTP Range requests so seeking works.
export async function serveFile(request: Request, path: string, mimeType: string): Promise<Response> {
  try {
    const size = (await stat(path)).size
    let start = 0
    let end = Math.max(0, size - 1)
    let status = 200
    const range = request.headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
      else { start = Math.max(0, size - Number(match[2])); end = size - 1 }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      status = 206
    }
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType,
      'Content-Length': String(size === 0 ? 0 : end - start + 1)
    })
    if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status, headers })
  } catch { return new Response(null, { status: 404 }) }
}
