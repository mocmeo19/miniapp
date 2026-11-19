export type Side = 'en' | 'vi'

export type Cue = { id: string; start: number; end: number; text: string }

// An item links English and Vietnamese cues (in order) that together form one exercise answer.
export type Item = { id: string; en: string[]; vi: string[] }

export type Doc = {
  name: string
  enFile: string
  viFile: string
  enCues: Cue[]
  viCues: Cue[]
  items: Item[]
}

export type OpenedFile = { path: string; name: string; content: string }

export type ExportRow = {
  index: number
  id: string
  start_ms: number
  end_ms: number
  start: string
  end: string
  vietnamese: string
  english: string
  english_normalized: string
  word_count: number
  en_cue_ids: string[]
  vi_cue_ids: string[]
}

export type AudioInfo = { name: string }
