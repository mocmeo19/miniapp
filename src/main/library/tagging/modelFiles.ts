import { net } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import { basename, dirname, join } from 'node:path'
import { moveIntoFolder } from '../../../modules/core/files'

export type ModelFile = { id: string; url: string; sha256: string; size: number }

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function verified(model: ModelFile, path: string): Promise<boolean> {
  try { return (await stat(path)).size === model.size && await fileHash(path) === model.sha256 }
  catch { return false }
}

export function modelPath(model: ModelFile, directory: string): string {
  return join(directory, `${model.id}.onnx`)
}

export function isModelReady(model: ModelFile, directory: string): Promise<boolean> {
  return verified(model, modelPath(model, directory))
}

/** Moves a verified model left in an earlier location into `target`, instead of downloading it again. */
async function adoptLegacyModel(model: ModelFile, target: string, legacyDirectories: string[]): Promise<boolean> {
  for (const directory of legacyDirectories) {
    const legacy = modelPath(model, directory)
    if (legacy === target || !(await verified(model, legacy))) continue
    await rm(target, { force: true })
    await moveIntoFolder(legacy, dirname(target))
    return verified(model, target)
  }
  return false
}

/** Downloads `url` into `folder` as `fileName` (or a free variant of it) and resolves with the file's path. */
export type ModelFetcher = (request: { url: string; folder: string; fileName: string; signal: AbortSignal; onProgress: (received: number) => void }) => Promise<string>

// Used when no Download manager is available (tests and tools that start Library on their own).
const directFetch: ModelFetcher = async ({ url, folder, fileName, signal, onProgress }) => {
  const target = join(folder, fileName)
  const temporary = `${target}.download`
  const response = await net.fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status})`)
  const output = createWriteStream(temporary)
  let received = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length
      if (!output.write(chunk)) await once(output, 'drain')
      onProgress(received)
    }
    await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()))
    await rename(temporary, target)
    return target
  } catch (error) {
    output.destroy()
    await rm(temporary, { force: true })
    throw error
  }
}

export async function ensureModel(model: ModelFile, directory: string, onProgress: (received: number) => void, signal: AbortSignal,
  legacyDirectories: string[] = [], fetch: ModelFetcher = directFetch): Promise<string> {
  const target = modelPath(model, directory)
  if (await verified(model, target)) return target
  await mkdir(directory, { recursive: true })
  if (await adoptLegacyModel(model, target, legacyDirectories).catch(() => false)) return target
  await rm(target, { force: true })
  const downloaded = await fetch({ url: model.url, folder: directory, fileName: basename(target), signal, onProgress })
  if (downloaded !== target) await rename(downloaded, target)
  if (!(await verified(model, target))) {
    await rm(target, { force: true })
    throw new Error('Downloaded model failed verification')
  }
  return target
}
