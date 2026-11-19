import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const platformAssets = {
  darwin: { x64: 'yt-dlp_macos', arm64: 'yt-dlp_macos' },
  win32: { x64: 'yt-dlp.exe', arm64: 'yt-dlp_arm64.exe' },
  linux: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' }
}

const asset = platformAssets[process.platform]?.[process.arch]
if (!asset) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)

const root = fileURLToPath(new URL('..', import.meta.url))
const bin = join(root, 'resources', 'bin')
const target = join(bin, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
const temp = `${target}.download`
const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

async function request(name) {
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(120000) })
  if (!response.ok || !response.body) throw new Error(`Download failed: ${name} (HTTP ${response.status})`)
  return response
}

await mkdir(bin, { recursive: true })
try {
  const checksums = await (await request('SHA2-256SUMS')).text()
  const line = checksums.split('\n').find((entry) => entry.trim().endsWith(asset))
  const expected = line?.match(/^([a-f\d]{64})\s+\*?(.+)$/i)
  if (!expected || expected[2] !== asset) throw new Error(`Checksum for ${asset} was not found`)

  console.log(`Downloading ${asset}...`)
  const response = await request(asset)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temp))
  const actual = createHash('sha256').update(await readFile(temp)).digest('hex')
  if (actual.toLowerCase() !== expected[1].toLowerCase()) throw new Error('yt-dlp checksum mismatch')
  if (process.platform !== 'win32') await chmod(temp, 0o755)
  if (process.platform === 'win32') await rm(target, { force: true })
  await rename(temp, target)
  console.log(`yt-dlp ready: ${target}`)
} catch (error) {
  await rm(temp, { force: true })
  throw error
}
