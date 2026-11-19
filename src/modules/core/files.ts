import { constants } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export type MovedFile = { from: string; to: string }

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

/** Moves a file into `folder`, keeping its name (adding " (2)", " (3)"… on a clash). Never overwrites; works across drives. */
export async function moveIntoFolder(source: string, folder: string): Promise<string> {
  await mkdir(folder, { recursive: true })
  const extension = extname(source)
  const stem = basename(source, extension)
  let target = join(folder, basename(source))
  for (let copy = 2; await exists(target); copy++) target = join(folder, `${stem} (${copy})${extension}`)
  try {
    await rename(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(source, target, constants.COPYFILE_EXCL)
    await rm(source)
  }
  return target
}

/** Moves the files directly inside `directory` whose names match into the folder chosen for each one. */
export async function moveMatchingFiles(
  directory: string,
  matches: (name: string) => boolean,
  destinationFor: (path: string) => string | Promise<string>
): Promise<{ moved: MovedFile[]; failed: number }> {
  const moved: MovedFile[] = []
  let failed = 0
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return { moved, failed } }
  for (const entry of entries) {
    if (!entry.isFile() || !matches(entry.name)) continue
    const from = join(directory, entry.name)
    try {
      moved.push({ from, to: await moveIntoFolder(from, await destinationFor(from)) })
    } catch (error) {
      failed++
      console.error(`Could not move ${from}`, error)
    }
  }
  return { moved, failed }
}
