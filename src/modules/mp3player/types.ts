export type Track = {
  id: string
  title: string
  artist: string | null
  extension: string
  size: number
  url: string
  /** 'download' for music fetched from a link into the module's data folder; 'local' for files added from disk. */
  source: 'download' | 'local'
}

export type UrlDownloadEvent = {
  jobId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  percent: number
  url: string
  title?: string
  error?: string
}
