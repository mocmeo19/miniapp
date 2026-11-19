import { createRequire } from 'node:module'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const source = require('ffmpeg-static')
if (!source) throw new Error('ffmpeg-static did not provide a binary for this platform')

const root = fileURLToPath(new URL('..', import.meta.url))
const bin = join(root, 'resources', 'bin')
const target = join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
await mkdir(bin, { recursive: true })
await copyFile(source, target)
if (process.platform !== 'win32') await chmod(target, 0o755)
console.log(`ffmpeg ready: ${target}`)
