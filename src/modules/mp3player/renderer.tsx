import {
  CaretRightFilled, CustomerServiceOutlined, DeleteOutlined, FolderOpenOutlined, MutedOutlined, PauseCircleFilled, PauseOutlined,
  PlayCircleFilled, PlusOutlined, RetweetOutlined, SearchOutlined, SoundOutlined, StepBackwardOutlined, StepForwardOutlined, SwapOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Popconfirm, Segmented, Select, Slider, Space, Tag, Tooltip, message } from 'antd'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ModulePage } from '../core/ModulePage'
import type { RendererModule } from '../core/renderer'
import { emptyFilter, filterOptions, filterTracks, isFiltered, type SortOrder, type SourceFilter, type TrackFilter } from './trackFilters'
import type { Track } from './types'
import { UrlImport } from './UrlImport'

type Repeat = 'off' | 'all' | 'one'
type PlayerState = {
  tracks: Track[]
  currentId: string | null
  playing: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: Repeat
  error: string
  /** Ids of the tracks currently shown (after search, filters and sorting); next/previous follow this order. */
  order: string[] | null
}

// The audio element lives outside React so playback continues while another module is open.
const audio = new Audio()
audio.preload = 'metadata'
let state: PlayerState = { tracks: [], currentId: null, playing: false, time: 0, duration: 0, volume: 0.8, muted: false, shuffle: false, repeat: 'off', error: '', order: null }
const listeners = new Set<() => void>()
audio.volume = state.volume

function update(patch: Partial<PlayerState>): void {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const snapshot = () => state

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

function currentIndex(): number {
  return state.tracks.findIndex((track) => track.id === state.currentId)
}

async function play(track: Track): Promise<void> {
  if (state.currentId !== track.id) {
    audio.src = track.url
    update({ currentId: track.id, time: 0, duration: 0, error: '' })
  }
  try { await audio.play() }
  catch (cause) { update({ playing: false, error: `Could not play “${track.title}”: ${errorMessage(cause)}` }) }
}

// The visible list when it holds the current track, otherwise the whole playlist.
function queue(): Track[] {
  if (!state.order) return state.tracks
  const byId = new Map(state.tracks.map((track) => [track.id, track]))
  const visible = state.order.map((id) => byId.get(id)).filter((track): track is Track => !!track)
  return visible.length && (!state.currentId || state.order.includes(state.currentId)) ? visible : state.tracks
}

function step(direction: 1 | -1, auto = false): void {
  const { shuffle, repeat } = state
  const tracks = queue()
  if (tracks.length === 0) return
  const index = tracks.findIndex((track) => track.id === state.currentId)
  let next: number
  if (shuffle && tracks.length > 1) {
    do { next = Math.floor(Math.random() * tracks.length) } while (next === index)
  } else {
    next = index + direction
    if (next >= tracks.length || next < 0) {
      if (auto && repeat === 'off') { audio.pause(); audio.currentTime = 0; return }
      next = (next + tracks.length) % tracks.length
    }
  }
  void play(tracks[next])
}

function togglePlay(): void {
  if (audio.paused) {
    const track = state.tracks[currentIndex()] ?? queue()[0]
    if (track) void play(track)
  } else audio.pause()
}

audio.addEventListener('play', () => update({ playing: true }))
audio.addEventListener('pause', () => update({ playing: false }))
audio.addEventListener('timeupdate', () => update({ time: audio.currentTime }))
audio.addEventListener('loadedmetadata', () => update({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }))
audio.addEventListener('error', () => {
  const track = state.tracks[currentIndex()]
  update({ playing: false, error: `Could not play${track ? ` “${track.title}”` : ' this file'}. The format may be unsupported or the file moved.` })
})
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') { audio.currentTime = 0; void audio.play() }
  else step(1, true)
})

function setTracks(tracks: Track[]): void {
  const keep = tracks.some((track) => track.id === state.currentId)
  if (!keep && state.currentId) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    update({ tracks, currentId: null, time: 0, duration: 0 })
  } else update({ tracks })
}

async function call(action: string, payload?: unknown): Promise<void> {
  try { setTracks(await window.desktop!.modules.invoke<Track[]>('mp3player', action, payload)) }
  catch (cause) { message.error(errorMessage(cause)) }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function setVolume(volume: number): void {
  audio.volume = volume
  audio.muted = false
  update({ volume, muted: false })
}

function toggleMute(): void {
  audio.muted = !state.muted
  update({ muted: !state.muted })
}

function playAll(shuffle: boolean): void {
  const tracks = queue()
  if (tracks.length === 0) return
  update({ shuffle })
  void play(shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[0])
}

const coverUrl = (track: Track) => `miniapp-audio://cover/${track.id}`

function Cover({ track, className = 'mp3-cover' }: { track?: Track; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!track || failed === track.id) return <div className={className}><CustomerServiceOutlined /></div>
  return <div className={className}><img src={coverUrl(track)} alt={`Album cover for ${track.title}`} onError={() => setFailed(track.id)} /></div>
}

// Lazy loading means artwork is only read for rows that scroll into view.
function Thumb({ track }: { track: Track }) {
  const [failed, setFailed] = useState(false)
  return <span className="mp3-thumb">{failed ? <CustomerServiceOutlined /> : <img src={coverUrl(track)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}</span>
}

function Equalizer() {
  return <span className="mp3-eq" aria-label="Playing"><i /><i /><i /></span>
}

function NowPlaying({ player, current }: { player: PlayerState; current?: Track }) {
  const downloaded = player.tracks.filter((track) => track.source === 'download').length
  return <section className="mp3-hero">
    {current && <div className="mp3-hero-bg" style={{ backgroundImage: `url("${coverUrl(current)}")` }} aria-hidden />}
    <Cover track={current} className="mp3-cover mp3-hero-cover" />
    <div className="mp3-hero-copy">
      <span className="mp3-now-label">{player.playing ? <><Equalizer /> NOW PLAYING</> : current ? 'PAUSED' : 'YOUR LIBRARY'}</span>
      <h2 title={current?.title}>{current?.title ?? 'Pick something to play'}</h2>
      <p>{current ? current.artist ?? 'Unknown artist' : 'Add music from your device or paste a link below.'}</p>
      {current && <div className="mp3-hero-tags">
        <Tag>{current.extension.toUpperCase()}</Tag><Tag>{formatSize(current.size)}</Tag>
        {current.source === 'download' && <Tag color="purple">Downloaded</Tag>}
      </div>}
      <Space className="mp3-hero-actions">
        <Button type="primary" size="large" shape="round" icon={player.playing ? <PauseOutlined /> : <CaretRightFilled />} disabled={player.tracks.length === 0} onClick={() => current || player.playing ? togglePlay() : playAll(false)}>
          {player.playing ? 'Pause' : current ? 'Resume' : 'Play all'}
        </Button>
        <Button size="large" shape="round" icon={<SwapOutlined />} disabled={player.tracks.length === 0} onClick={() => playAll(true)}>Shuffle all</Button>
      </Space>
    </div>
    <dl className="mp3-stats">
      <div><dt>Tracks</dt><dd>{player.tracks.length}</dd></div>
      <div><dt>Downloaded</dt><dd>{downloaded}</dd></div>
      <div><dt>Local</dt><dd>{player.tracks.length - downloaded}</dd></div>
    </dl>
  </section>
}

// Stays pinned to the bottom of the window while the playlist scrolls.
function PlayerBar({ player, current }: { player: PlayerState; current?: Track }) {
  const repeatNext: Record<Repeat, Repeat> = { off: 'all', all: 'one', one: 'off' }
  const repeatLabel = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: one' }[player.repeat]
  const empty = player.tracks.length === 0
  const volume = player.muted ? 0 : player.volume
  return <div className="mp3-bar" role="region" aria-label="Player">
    <div className="mp3-bar-track">
      <Cover track={current} className="mp3-cover mp3-bar-cover" />
      <div className="mp3-bar-copy">
        <strong title={current?.title}>{current?.title ?? 'Nothing playing'}</strong>
        <span>{current ? current.artist ?? 'Unknown artist' : empty ? 'Your playlist is empty' : 'Choose a track'}</span>
      </div>
    </div>
    <div className="mp3-bar-center">
      <div className="mp3-controls">
        <Tooltip title={player.shuffle ? 'Shuffle: on' : 'Shuffle: off'}><Button type="text" shape="circle" className={`mp3-toggle${player.shuffle ? ' on' : ''}`} aria-label="Toggle shuffle" aria-pressed={player.shuffle} icon={<SwapOutlined />} onClick={() => update({ shuffle: !player.shuffle })} /></Tooltip>
        <Tooltip title="Previous"><Button type="text" shape="circle" className="mp3-skip" aria-label="Previous track" icon={<StepBackwardOutlined />} disabled={empty} onClick={() => step(-1)} /></Tooltip>
        <Button type="text" shape="circle" className="mp3-play" aria-label={player.playing ? 'Pause' : 'Play'} icon={player.playing ? <PauseCircleFilled /> : <PlayCircleFilled />} disabled={empty} onClick={togglePlay} />
        <Tooltip title="Next"><Button type="text" shape="circle" className="mp3-skip" aria-label="Next track" icon={<StepForwardOutlined />} disabled={empty} onClick={() => step(1)} /></Tooltip>
        <Tooltip title={repeatLabel}><Button type="text" shape="circle" className={`mp3-toggle${player.repeat !== 'off' ? ' on' : ''}`} aria-label={repeatLabel} icon={<RetweetOutlined />} onClick={() => update({ repeat: repeatNext[player.repeat] })}>{player.repeat === 'one' ? <sup>1</sup> : null}</Button></Tooltip>
      </div>
      <div className="mp3-seek">
        <span>{formatTime(player.time)}</span>
        <Slider min={0} max={Math.max(player.duration, 1)} step={0.1} value={Math.min(player.time, Math.max(player.duration, 1))} disabled={!current || player.duration === 0} tooltip={{ formatter: (value) => formatTime(value ?? 0) }} onChange={(value) => { audio.currentTime = value; update({ time: value }) }} />
        <span>{formatTime(player.duration)}</span>
      </div>
    </div>
    <div className="mp3-volume">
      <Tooltip title={player.muted ? 'Unmute' : 'Mute'}><Button type="text" shape="circle" aria-label={player.muted ? 'Unmute' : 'Mute'} icon={volume === 0 ? <MutedOutlined /> : <SoundOutlined />} onClick={toggleMute} /></Tooltip>
      <Slider min={0} max={1} step={0.01} value={volume} tooltip={{ formatter: (value) => `${Math.round((value ?? 0) * 100)}%` }} onChange={setVolume} aria-label="Volume" />
    </div>
  </div>
}

function Mp3Player() {
  const player = useSyncExternalStore(subscribe, snapshot)
  const [filter, setFilter] = useState<TrackFilter>(emptyFilter)
  useEffect(() => { void call('list') }, [])
  const reload = useCallback(() => { void call('list') }, [])
  const visible = useMemo(() => filterTracks(player.tracks, filter), [player.tracks, filter])
  const options = useMemo(() => filterOptions(player.tracks), [player.tracks])
  const filtered = isFiltered(filter)
  useEffect(() => {
    const order = filtered || filter.sort !== 'added' ? visible.map((track) => track.id) : null
    if ((order?.join() ?? null) !== (state.order?.join() ?? null)) update({ order })
  }, [visible, filtered, filter.sort])
  // Space plays or pauses, unless the user is typing or a button has focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"]')) return
      event.preventDefault()
      togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const change = (patch: Partial<TrackFilter>) => setFilter((current) => ({ ...current, ...patch }))
  const current = player.tracks.find((track) => track.id === player.currentId)

  return <ModulePage title="MP3 Player" description="Play music from your device or download it from a link. Search and filter your playlist." icon={<CustomerServiceOutlined />}>
    <div className="mp3-page">
      {!window.desktop && <Alert type="warning" showIcon title="Open this page in the Electron app to play local files." className="mp3-alert" />}
      {player.error && <Alert type="error" showIcon title={player.error} closable onClose={() => update({ error: '' })} className="mp3-alert" />}

      <NowPlaying player={player} current={current} />

      <Card className="mp3-card">
        <div className="mp3-list-head">
          <div><h3>Playlist</h3><p>{filtered ? `${visible.length} of ${player.tracks.length}` : player.tracks.length} {player.tracks.length === 1 ? 'track' : 'tracks'}</p></div>
          <Space wrap>
            <Button icon={<PlusOutlined />} disabled={!window.desktop} onClick={() => void call('add-files')}>Add files</Button>
            <Button icon={<FolderOpenOutlined />} disabled={!window.desktop} onClick={() => void call('add-folder')}>Add folder</Button>
            <Popconfirm title="Clear the playlist?" description="Downloaded files stay in the data folder." okText="Clear" okButtonProps={{ danger: true }} onConfirm={() => void call('clear')} disabled={player.tracks.length === 0}>
              <Button danger disabled={player.tracks.length === 0}>Clear</Button>
            </Popconfirm>
          </Space>
        </div>
        <UrlImport onAdded={reload} />
        {player.tracks.length > 0 && <div className="mp3-filters">
          <Input allowClear prefix={<SearchOutlined />} placeholder="Search title, artist or format" value={filter.search} onChange={(event) => change({ search: event.target.value })} />
          <Segmented<SourceFilter> value={filter.source} onChange={(source) => change({ source })} options={[{ value: 'all', label: 'All' }, { value: 'download', label: 'Downloaded' }, { value: 'local', label: 'Local files' }]} />
          <Select allowClear showSearch placeholder="Artist" value={filter.artist ?? undefined} onChange={(artist) => change({ artist: artist ?? null })} options={options.artists.map((artist) => ({ value: artist, label: artist }))} disabled={options.artists.length === 0} />
          <Select allowClear placeholder="Format" value={filter.format ?? undefined} onChange={(format) => change({ format: format ?? null })} options={options.formats.map((format) => ({ value: format, label: format.toUpperCase() }))} />
          <Select<SortOrder> value={filter.sort} onChange={(sort) => change({ sort })} options={[{ value: 'added', label: 'Recently added order' }, { value: 'title', label: 'Title A–Z' }, { value: 'artist', label: 'Artist A–Z' }]} />
        </div>}
        {player.tracks.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No music yet. Paste a link, or add files or a folder to start." />
          : visible.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tracks match your search"><Button onClick={() => setFilter({ ...emptyFilter, sort: filter.sort })}>Clear filters</Button></Empty>
          : <>
            <div className="mp3-list-columns" aria-hidden><span>#</span><span>Title</span><span>Artist</span><span>Format</span><span /></div>
            <ul className="mp3-list">
              {visible.map((track, index) => {
                const active = track.id === player.currentId
                return <li key={track.id} className={active ? 'active' : ''}>
                  <button className="mp3-row" onClick={() => active ? togglePlay() : void play(track)} aria-current={active ? 'true' : undefined}>
                    <span className="mp3-index">
                      {active && player.playing ? <Equalizer /> : <span className="mp3-index-number">{index + 1}</span>}
                      <span className="mp3-index-play">{active && player.playing ? <PauseOutlined /> : <CaretRightFilled />}</span>
                    </span>
                    <span className="mp3-row-title">
                      <Thumb track={track} />
                      <span className="mp3-title" title={track.title}>{track.title}</span>
                    </span>
                    <span className="mp3-artist" title={track.artist ?? undefined}>{track.artist ?? '—'}</span>
                    <span className="mp3-meta">{track.source === 'download' && <Tag color="purple">Downloaded</Tag>}{track.extension.toUpperCase()} · {formatSize(track.size)}</span>
                  </button>
                  <Tooltip title="Remove from playlist"><Button type="text" size="small" className="mp3-remove" aria-label={`Remove ${track.title}`} icon={<DeleteOutlined />} onClick={() => void call('remove', track.id)} /></Tooltip>
                </li>
              })}
            </ul>
          </>}
      </Card>
    </div>

    <PlayerBar player={player} current={current} />
  </ModulePage>
}

export const mp3PlayerRendererModule: RendererModule = {
  id: 'mp3player',
  label: 'MP3 Player',
  icon: <CustomerServiceOutlined />,
  element: <Mp3Player />
}
