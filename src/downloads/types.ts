export type DownloadStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type DownloadItem = {
  id: string
  url: string
  /** Final file name once known; the requested or URL-based name before that. */
  fileName: string
  /** Where the finished file is; null until it completes. */
  path: string | null
  /** 'app' for downloads started from the Download page, otherwise the module id. */
  owner: string
  status: DownloadStatus
  received: number
  total: number | null
  /** Bytes per second while running. */
  speed: number
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export type DownloadRequest = {
  url: string
  /** Optional file name; otherwise taken from the server response or the URL. */
  fileName?: string
}
