import { itemId } from './parse'
import type { Cue, Item, Side } from './types'

const nonEmpty = (item: Item) => item.en.length > 0 || item.vi.length > 0
const clone = (items: Item[]): Item[] => items.map((item) => ({ ...item, en: [...item.en], vi: [...item.vi] }))

// Moves the first cue of an item up into the previous item, or its last cue down into the next one.
export function moveCue(items: Item[], index: number, side: Side, direction: 'up' | 'down'): Item[] {
  const target = index + (direction === 'up' ? -1 : 1)
  if (target < 0 || target >= items.length || items[index][side].length === 0) return items
  const copy = clone(items)
  if (direction === 'up') copy[target][side].push(copy[index][side].shift()!)
  else copy[target][side].unshift(copy[index][side].pop()!)
  return copy.filter(nonEmpty)
}

export function mergeWithNext(items: Item[], index: number): Item[] {
  if (index < 0 || index >= items.length - 1) return items
  const copy = clone(items)
  copy[index].en.push(...copy[index + 1].en)
  copy[index].vi.push(...copy[index + 1].vi)
  copy.splice(index + 1, 1)
  return copy
}

export const removeItem = (items: Item[], index: number): Item[] => items.filter((_, position) => position !== index)

export function addItemAfter(items: Item[], index: number): Item[] {
  const copy = clone(items)
  copy.splice(index + 1, 0, { id: itemId(), en: [], vi: [] })
  return copy
}

const nextCueId = (cues: Cue[], side: Side) =>
  `${side}-${cues.reduce((max, cue) => Math.max(max, Number(cue.id.split('-')[1]) || 0), 0) + 1}`

// Splits a cue's text at the caret into two cues kept in the same item; times are divided by text length.
export function splitCue(cues: Cue[], items: Item[], side: Side, cueId: string, caret: number): { cues: Cue[]; items: Item[] } | null {
  const at = cues.findIndex((cue) => cue.id === cueId)
  if (at < 0) return null
  const cue = cues[at]
  const first = cue.text.slice(0, caret).trimEnd()
  const second = cue.text.slice(caret).trimStart()
  if (!first || !second) return null
  const middle = cue.start + Math.round((cue.end - cue.start) * (first.length / (first.length + second.length)))
  const created: Cue = { id: nextCueId(cues, side), start: middle, end: cue.end, text: second }
  const nextCues = [...cues]
  nextCues.splice(at, 1, { ...cue, end: middle, text: first }, created)
  const nextItems = clone(items)
  const owner = nextItems.find((item) => item[side].includes(cueId))
  if (!owner) return null
  owner[side].splice(owner[side].indexOf(cueId) + 1, 0, created.id)
  return { cues: nextCues, items: nextItems }
}

export function itemsFromCues(cues: Cue[], side: Side): Item[] {
  return cues.map((cue) => ({ id: itemId(), en: side === 'en' ? [cue.id] : [], vi: side === 'vi' ? [cue.id] : [] }))
}
