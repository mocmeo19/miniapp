export type DownloadOption = {
  id: string
  kind: 'video' | 'audio'
  label: string
  extension: string
  size: number | null
  requiresFfmpeg: boolean
  /** Structured details for the format table; missing on history saved before they existed. */
  height?: number | null
  fps?: number | null
  bitrate?: number | null
  hasAudio?: boolean
}

export type VideoInfo = {
  id: string
  title: string
  channel: string
  duration: number | null
  thumbnail: string | null
  options: DownloadOption[]
  ffmpegAvailable: boolean
}

export type DownloadEvent = {
  jobId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  percent: number
  path?: string
  error?: string
}

export type HistoryDownload = { path: string; label: string; at: number }

export type HistoryEntry = { url: string; info: VideoInfo; inspectedAt: number; download?: HistoryDownload }

export type HistoryItem = Omit<VideoInfo, 'options' | 'ffmpegAvailable'> & { url: string; inspectedAt: number; download?: HistoryDownload }

export type YoutubeStatus = {
  cookieProfileId: string | null
  available: boolean
  version: string | null
  ffmpegAvailable: boolean
  folder: string
}
