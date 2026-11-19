import type { Track } from './types'

export type SourceFilter = 'all' | 'download' | 'local'
export type SortOrder = 'added' | 'title' | 'artist'

export type TrackFilter = {
  search: string
  source: SourceFilter
  artist: string | null
  format: string | null
  sort: SortOrder
}

export const emptyFilter: TrackFilter = { search: '', source: 'all', artist: null, format: null, sort: 'added' }

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export function filterTracks(tracks: Track[], filter: TrackFilter): Track[] {
  const query = filter.search.trim().toLowerCase()
  const visible = tracks.filter((track) =>
    (filter.source === 'all' || track.source === filter.source) &&
    (!filter.artist || track.artist === filter.artist) &&
    (!filter.format || track.extension === filter.format) &&
    (!query || `${track.title} ${track.artist ?? ''} ${track.extension}`.toLowerCase().includes(query)))
  if (filter.sort === 'title') return [...visible].sort((a, b) => compare(a.title, b.title))
  if (filter.sort === 'artist') return [...visible].sort((a, b) => compare(a.artist ?? '￿', b.artist ?? '￿') || compare(a.title, b.title))
  return visible
}

export function isFiltered(filter: TrackFilter): boolean {
  return !!filter.search.trim() || filter.source !== 'all' || !!filter.artist || !!filter.format
}

/** Distinct, sorted values for the artist and format pickers. */
export function filterOptions(tracks: Track[]): { artists: string[]; formats: string[] } {
  const artists = [...new Set(tracks.map((track) => track.artist).filter((artist): artist is string => !!artist))].sort(compare)
  const formats = [...new Set(tracks.map((track) => track.extension))].sort(compare)
  return { artists, formats }
}
