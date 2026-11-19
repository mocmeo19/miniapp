export type LibraryFolder = {
  id: string
  path: string
  addedAt: string
  fileCount: number
}

export type LibraryFile = {
  id: string
  folderId: string
  name: string
  relativePath: string
  /** Parent directory relative to the Library folder, '/'-separated; '' for files at the root. */
  directory: string
  kind: 'image' | 'video'
  extension: string
  size: number
  modifiedAt: number
  /** Display size in pixels (EXIF/rotation applied); null until known or when unreadable. */
  width: number | null
  height: number | null
  tags: string[]
}

export type LibraryQuery = {
  search?: string
  folderId?: string
  kind?: 'image' | 'video'
  tag?: string
  /** Browse one level of a folder ('' = its root). Ignored while searching, which covers the whole subtree. */
  directory?: string
  offset?: number
  limit?: number
}

export type LibrarySubfolder = { name: string; path: string; fileCount: number }

export type LibraryPage = { files: LibraryFile[]; total: number; tags: string[]; subfolders: LibrarySubfolder[] }

export type AutoTagModel = {
  id: string
  name: string
  description: string
  tagExamples: string[]
  /** Download size in bytes. */
  size: number
  license: string
}

export type AutoTagModels = { models: Array<AutoTagModel & { downloaded: boolean }>; selected: string[] }

export type AutoTagStatus = {
  enabled: boolean
  phase: 'idle' | 'downloading' | 'tagging' | 'error'
  /** Bytes received while downloading, images tagged while tagging. */
  done: number
  total: number
  /** Images still waiting for auto-tags. */
  pending: number
  error?: string
}

export type LibraryScanEvent = {
  folderId: string
  state: 'started' | 'progress' | 'completed' | 'failed'
  indexed: number
  skipped: number
  error?: string
}
