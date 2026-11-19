import type { Cue, Doc, ExportRow, Item } from './types'

const timestamp = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/

export function parseTimestamp(value: string): number | null {
  const match = timestamp.exec(value.trim())
  if (!match) return null
  const [, hours = '0', minutes, seconds, fraction] = match
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'))
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`
}

const cleanText = (lines: string[]) => lines.join(' ').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/\s+/g, ' ').trim()

const entity = /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi
const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeOnce = (text: string) => text.replace(entity, (_match, code: string) => {
  if (code[0] !== '#') return named[code.toLowerCase()]
  const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
  return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
})
// YouTube transcripts are often double-encoded (&amp;#39;), so decode twice.
const decodeEntities = (text: string) => decodeOnce(decodeOnce(text))

const ttmlClock = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+)|:(\d+))?$/
const ttmlOffset = /^(\d+(?:\.\d+)?)(h|ms|m|s|t|f)$/

// TTML time expressions: clock time (00:00:01.500, 00:00:01:15 frames) or offset time (1.5s, 1500ms, 15000000t).
export function parseTtmlTime(value: string, tickRate = 10_000_000): number | null {
  const text = value.trim()
  const clock = ttmlClock.exec(text)
  if (clock) {
    const base = ((Number(clock[1]) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000
    return Math.round(base + (clock[4] ? Number(`0.${clock[4]}`) * 1000 : clock[5] ? (Number(clock[5]) * 1000) / 30 : 0))
  }
  const offset = ttmlOffset.exec(text)
  if (!offset) return parseTimestamp(text)
  const amount = Number(offset[1])
  const unit = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, t: 1000 / tickRate, f: 1000 / 30 }[offset[2] as 'h' | 'm' | 's' | 'ms' | 't' | 'f']
  return Math.round(amount * unit)
}

const attribute = (attributes: string, name: string): string | null =>
  new RegExp(`(?:^|[\\s:])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes)?.slice(1).find((value) => value !== undefined) ?? null

function xmlText(inner: string): string {
  const withoutBreaks = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  return decodeEntities(withoutBreaks).replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ').trim()
}

// Parses XML subtitles: TTML/DFXP (<p begin end>), YouTube transcript (<text start dur>) and YouTube srv3 (<p t d>).
export function parseXmlSubtitles(content: string, prefix: 'en' | 'vi'): Cue[] {
  const tickValue = /tickRate\s*=\s*["'](\d+)["']/i.exec(content)?.[1]
  const tickRate = tickValue ? Number(tickValue) : 10_000_000
  const cues: Omit<Cue, 'id'>[] = []
  const element = /<(?:[\w-]+:)?(p|text)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?\1\s*>)/gi
  for (const match of content.matchAll(element)) {
    const attributes = match[2]
    const begin = attribute(attributes, 'begin')
    const finish = attribute(attributes, 'end')
    const duration = attribute(attributes, 'dur') ?? attribute(attributes, 'd')
    const startSeconds = attribute(attributes, 'start')
    const startMs = attribute(attributes, 't')
    let start: number | null = null
    let end: number | null = null
    if (begin !== null) {
      start = parseTtmlTime(begin, tickRate)
      const length = attribute(attributes, 'dur')
      end = finish !== null ? parseTtmlTime(finish, tickRate) : length !== null && start !== null ? (parseTtmlTime(length, tickRate) ?? 0) + start : null
    } else if (startSeconds !== null && duration !== null) {
      start = Math.round(Number(startSeconds) * 1000)
      end = start + Math.round(Number(duration) * 1000)
    } else if (startMs !== null && duration !== null) {
      start = Number(startMs)
      end = start + Number(duration)
    }
    const text = xmlText(match[3] ?? '')
    if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || !text) continue
    cues.push({ start, end: Math.max(start, end), text })
  }
  cues.sort((a, b) => a.start - b.start)
  return cues.map((cue, index) => ({ id: `${prefix}-${index + 1}`, ...cue }))
}

// Parses SRT, WebVTT or XML (TTML / YouTube) content. Cue ids are `${prefix}-${n}` in time order.
export function parseSubtitles(content: string, prefix: 'en' | 'vi'): Cue[] {
  if (content.replace(/^\uFEFF/, '').trimStart().startsWith('<')) return parseXmlSubtitles(content, prefix)
  const blocks = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: Omit<Cue, 'id'>[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const at = lines.findIndex((line) => line.includes('-->'))
    if (at < 0) continue
    const match = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[at])
    const start = match ? parseTimestamp(match[1]) : null
    const end = match ? parseTimestamp(match[2]) : null
    if (start === null || end === null) continue
    const text = cleanText(lines.slice(at + 1))
    if (text) cues.push({ start, end: Math.max(start, end), text })
  }
  cues.sort((a, b) => a.start - b.start)
  return cues.map((cue, index) => ({ id: `${prefix}-${index + 1}`, ...cue }))
}

const overlap = (a: Cue, b: Cue) => Math.min(a.end, b.end) - Math.max(a.start, b.start)

export function cueMap(cues: Cue[]): Map<string, Cue> {
  return new Map(cues.map((cue) => [cue.id, cue]))
}

export function itemId(): string {
  return `it-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

// One item per English cue; every Vietnamese cue joins the English cue it overlaps most (or the nearest within 1.5s).
export function autoAlign(en: Cue[], vi: Cue[]): Item[] {
  const assigned = new Map<number, string[]>()
  const orphans: Cue[] = []
  for (const cue of vi) {
    let best = -1
    let bestOverlap = 0
    en.forEach((candidate, index) => {
      const value = overlap(cue, candidate)
      if (value > bestOverlap) { bestOverlap = value; best = index }
    })
    if (best < 0) {
      const middle = (cue.start + cue.end) / 2
      let distance = 1500
      en.forEach((candidate, index) => {
        const gap = Math.abs((candidate.start + candidate.end) / 2 - middle)
        if (gap < distance) { distance = gap; best = index }
      })
    }
    if (best >= 0) assigned.set(best, [...(assigned.get(best) ?? []), cue.id])
    else orphans.push(cue)
  }
  const entries = en.map((cue, index) => ({ key: cue.start, item: { id: itemId(), en: [cue.id], vi: assigned.get(index) ?? [] } }))
  for (const cue of orphans) entries.push({ key: cue.start, item: { id: itemId(), en: [], vi: [cue.id] } })
  return entries.sort((a, b) => a.key - b.key).map((entry) => entry.item)
}

// Timing follows the English cues (the audio's source) and falls back to Vietnamese when an item has none.
export function itemTiming(item: Item, en: Map<string, Cue>, vi: Map<string, Cue>): { start: number; end: number } | null {
  const pick = (ids: string[], cues: Map<string, Cue>) => ids.map((id) => cues.get(id)).filter((cue): cue is Cue => !!cue)
  const english = pick(item.en, en)
  const pool = english.length ? english : pick(item.vi, vi)
  if (pool.length === 0) return null
  return { start: Math.min(...pool.map((cue) => cue.start)), end: Math.max(...pool.map((cue) => cue.end)) }
}

export const joinText = (ids: string[], cues: Map<string, Cue>) => ids.map((id) => cues.get(id)?.text ?? '').filter(Boolean).join(' ')

export function normalizeEnglish(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function buildRows(doc: Doc): ExportRow[] {
  const en = cueMap(doc.enCues)
  const vi = cueMap(doc.viCues)
  const rows: ExportRow[] = []
  for (const item of doc.items) {
    const english = joinText(item.en, en)
    const vietnamese = joinText(item.vi, vi)
    const timing = itemTiming(item, en, vi)
    if (!timing || (!english && !vietnamese)) continue
    const normalized = normalizeEnglish(english)
    rows.push({
      index: rows.length + 1, id: item.id, start_ms: timing.start, end_ms: timing.end,
      start: formatTime(timing.start), end: formatTime(timing.end), vietnamese, english,
      english_normalized: normalized, word_count: normalized ? normalized.split(' ').length : 0,
      en_cue_ids: item.en, vi_cue_ids: item.vi
    })
  }
  return rows
}

export function toJson(doc: Doc): string {
  const items = buildRows(doc)
  return JSON.stringify({ name: doc.name, source: { english: doc.enFile, vietnamese: doc.viFile }, count: items.length, items }, null, 2)
}

export function toCsv(doc: Doc): string {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const header = ['index', 'start', 'end', 'vietnamese', 'english', 'english_normalized', 'word_count']
  const lines = buildRows(doc).map((row) => [row.index, row.start, row.end, row.vietnamese, row.english, row.english_normalized, row.word_count].map(quote).join(','))
  return [header.join(','), ...lines].join('\r\n')
}
