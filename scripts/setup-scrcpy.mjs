import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

// scrcpy releases ship adb and scrcpy-server next to the binary, so the whole folder is bundled.
const platformAssets = {
  darwin: { x64: 'macos-x86_64', arm64: 'macos-aarch64' },
  win32: { x64: 'win64', arm64: 'winarm64' },
  linux: { x64: 'linux-x86_64' }
}

const platform = platformAssets[process.platform]?.[process.arch]
if (!platform) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)

const root = fileURLToPath(new URL('..', import.meta.url))
const bin = join(root, 'resources', 'bin')
const target = join(bin, 'scrcpy')
const temp = join(bin, '.scrcpy-download')

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'user-agent': 'miniapp-setup' } })
  if (!response.ok) throw new Error(`Request failed: ${url} (HTTP ${response.status})`)
  return response
}

await mkdir(bin, { recursive: true })
await rm(temp, { recursive: true, force: true })
await mkdir(temp)
try {
  const release = await (await json('https://api.github.com/repos/Genymobile/scrcpy/releases/latest')).json()
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const name = `scrcpy-${platform}-${release.tag_name}.${ext}`
  const asset = release.assets.find((item) => item.name === name)
  const sums = release.assets.find((item) => item.name === 'SHA256SUMS.txt')
  if (!asset || !sums) throw new Error(`Release ${release.tag_name} has no ${name}`)

  const checksums = await (await json(sums.browser_download_url)).text()
  const expected = checksums.split('\n').map((line) => line.trim().match(/^([a-f\d]{64})\s+\*?(.+)$/i)).find((match) => match?.[2] === name)
  if (!expected) throw new Error(`Checksum for ${name} was not found`)

  console.log(`Downloading ${name}...`)
  const archive = join(temp, name)
  await pipeline(Readable.fromWeb((await json(asset.browser_download_url)).body), createWriteStream(archive))
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (actual.toLowerCase() !== expected[1].toLowerCase()) throw new Error('scrcpy checksum mismatch')

  // bsdtar (macOS, Windows 10+) and GNU tar both read these archives.
  const extracted = join(temp, 'out')
  await mkdir(extracted)
  execFileSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'inherit' })
  const [top] = await readdir(extracted)
  if (!top) throw new Error('scrcpy archive was empty')
  await rm(target, { recursive: true, force: true })
  await rename(join(extracted, top), target)
  // The app streams from scrcpy-server itself and must pass the exact release version to it.
  await writeFile(join(target, 'VERSION'), `${release.tag_name.replace(/^v/, '')}\n`)
  if (process.platform !== 'win32') {
    for (const file of ['scrcpy', 'adb']) await chmod(join(target, file), 0o755).catch(() => undefined)
  }
  console.log(`scrcpy ${release.tag_name} ready: ${target}`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
