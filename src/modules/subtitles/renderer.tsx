import {
  ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, DownloadOutlined, FileTextOutlined, FolderOpenOutlined,
  MergeCellsOutlined, PauseCircleFilled, PlayCircleFilled, PlusOutlined, SaveOutlined, ScissorOutlined, SoundOutlined, TranslationOutlined, UndoOutlined, UploadOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Tag, Tooltip, message } from 'antd'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ModulePage } from '../core/ModulePage'
import type { RendererModule } from '../core/renderer'
import { addItemAfter, itemsFromCues, mergeWithNext, moveCue, removeItem, splitCue } from './edit'
import { autoAlign, cueMap, formatTime, itemTiming, parseSubtitles, toCsv, toJson } from './parse'
import type { AudioInfo, Cue, Doc, Item, OpenedFile, Side } from './types'

const subtitleHint = 'Kéo file .srt / .vtt / .xml vào đây hoặc bấm để chọn'
const maxFileBytes = 10 * 1024 * 1024
const audioPattern = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|mp4|webm)$/i
const emptyDoc: Doc = { name: '', enFile: '', viFile: '', enCues: [], viCues: [], items: [] }
type Filter = 'all' | 'missing' | 'complete'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)
}

type CueBoxProps = {
  cue: Cue
  side: Side
  canUp: boolean
  canDown: boolean
  onText: (text: string) => void
  onMove: (direction: 'up' | 'down') => void
  onSplit: () => void
  onCaret: (position: number) => void
}

function CueBox({ cue, side, canUp, canDown, onText, onMove, onSplit, onCaret }: CueBoxProps) {
  return <div className={`sub-cue sub-cue-${side}`}>
    <Input.TextArea value={cue.text} autoSize={{ minRows: 1, maxRows: 6 }} aria-label={side === 'en' ? 'Tiếng Anh' : 'Tiếng Việt'}
      onChange={(event) => onText(event.target.value)}
      onSelect={(event) => onCaret(event.currentTarget.selectionStart)} />
    <div className="sub-cue-tools">
      <Tooltip title="Đẩy lên dòng trên"><Button size="small" type="text" aria-label="Đẩy lên dòng trên" icon={<ArrowUpOutlined />} disabled={!canUp} onClick={() => onMove('up')} /></Tooltip>
      <Tooltip title="Đẩy xuống dòng dưới"><Button size="small" type="text" aria-label="Đẩy xuống dòng dưới" icon={<ArrowDownOutlined />} disabled={!canDown} onClick={() => onMove('down')} /></Tooltip>
      <Tooltip title="Tách tại vị trí con trỏ"><Button size="small" type="text" aria-label="Tách tại vị trí con trỏ" icon={<ScissorOutlined />} onClick={onSplit} /></Tooltip>
    </div>
  </div>
}

type DropSlotProps = {
  label: string
  fileName: string
  detail: string
  hint: string
  onPick: () => void
  onDropFile: (file: File) => void
}

// A click target that also accepts a dragged subtitle file.
function DropSlot({ label, fileName, detail, hint, onPick, onDropFile }: DropSlotProps) {
  const [over, setOver] = useState(false)
  return <div className={`sub-slot${over ? ' over' : ''}${fileName ? ' filled' : ''}`} role="button" tabIndex={0}
    aria-label={`${label}: bấm để chọn file hoặc kéo thả file vào đây`}
    onClick={onPick}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick() } }}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setOver(true) }}
    onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); const file = event.dataTransfer.files[0]; if (file) onDropFile(file) }}>
    {fileName ? <FileTextOutlined /> : <UploadOutlined />}
    <div className="sub-slot-copy">
      <strong>{label}</strong>
      <span>{fileName ? detail : hint}</span>
    </div>
  </div>
}

function SubtitleEditor() {
  const [doc, setDoc] = useState<Doc>(emptyDoc)
  const [history, setHistory] = useState<Doc[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const [audio, setAudio] = useState<AudioInfo | null>(null)
  const [audioVersion, setAudioVersion] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [rate, setRate] = useState(1)
  const [padding, setPadding] = useState(0.25)
  const [loop, setLoop] = useState(false)
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const caret = useRef<Record<string, number>>({})
  const audioRef = useRef<HTMLAudioElement>(null)
  const segment = useRef<{ start: number; end: number } | null>(null)
  const draftReady = useRef(false)
  const desktop = window.desktop?.modules

  useEffect(() => {
    if (!desktop) return
    void desktop.invoke<Doc | null>('subtitles', 'load-draft')
      .then((draft) => { if (draft) setDoc(draft) })
      .catch(() => undefined)
      .finally(() => { draftReady.current = true })
  }, [desktop])

  // The overlay stays up until the opened project's rows have actually rendered.
  useEffect(() => {
    if (!openingRef.current) return
    openingRef.current = false
    setOpening(false)
  }, [doc])

  // Work is autosaved so closing the app never loses edits.
  useEffect(() => {
    if (!desktop || !draftReady.current) return
    const timer = setTimeout(() => { void desktop.invoke('subtitles', 'save-draft', doc).catch(() => undefined) }, 1000)
    return () => clearTimeout(timer)
  }, [desktop, doc])

  useEffect(() => {
    if (!desktop) return
    void desktop.invoke<AudioInfo | null>('subtitles', 'get-audio').then(setAudio).catch(() => undefined)
  }, [desktop])

  // Stops a previewed segment at its end (or loops it); polled each frame because timeupdate is too coarse.
  useEffect(() => {
    const element = audioRef.current
    if (!playingId || !element) return
    let frame = 0
    const tick = () => {
      const range = segment.current
      if (!range) return
      if (element.currentTime >= range.end || element.ended) {
        if (loop) element.currentTime = range.start
        else { element.pause(); return }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playingId, loop])

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate }, [rate, audio])

  const enMap = useMemo(() => cueMap(doc.enCues), [doc.enCues])
  const viMap = useMemo(() => cueMap(doc.viCues), [doc.viCues])
  const stats = useMemo(() => ({
    total: doc.items.length,
    complete: doc.items.filter((item) => item.en.length > 0 && item.vi.length > 0).length,
    missingVi: doc.items.filter((item) => item.en.length > 0 && item.vi.length === 0).length,
    missingEn: doc.items.filter((item) => item.en.length === 0).length
  }), [doc.items])
  const rows = useMemo(() => doc.items.map((item, index) => ({ item, index })).filter(({ item }) => {
    const complete = item.en.length > 0 && item.vi.length > 0
    return filter === 'all' || (filter === 'complete' ? complete : !complete)
  }), [doc.items, filter])

  const listRef = useRef<HTMLDivElement>(null)
  const [listOffset, setListOffset] = useState(0)
  // The window scrolls, so the virtualizer needs the list's distance from the top of the page; it shifts when content above changes.
  useLayoutEffect(() => {
    const top = listRef.current ? listRef.current.getBoundingClientRect().top + window.scrollY : 0
    setListOffset((current) => (Math.abs(current - top) > 1 ? top : current))
  })
  const virtualizer = useWindowVirtualizer({ count: rows.length, estimateSize: () => 92, overscan: 6, scrollMargin: listOffset, getItemKey: (index) => rows[index]?.item.id ?? index })
  const flagged = useMemo(() => {
    const positions: number[] = []
    rows.forEach(({ item }, position) => { if (item.en.length === 0 || item.vi.length === 0) positions.push(position) })
    return positions
  }, [rows])

  // Structural edits are undoable; typing in a cue is not recorded one keystroke at a time.
  const change = (update: (current: Doc) => Doc | null) => {
    setDoc((current) => {
      const next = update(current)
      if (!next) return current
      setHistory((past) => [...past.slice(-49), current])
      return next
    })
  }
  const setItems = (update: (items: Item[]) => Item[]) => change((current) => ({ ...current, items: update(current.items) }))
  const undo = () => {
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory(history.slice(0, -1))
    setDoc(previous)
  }
  const editText = (side: Side, id: string, text: string) => setDoc((current) => {
    const key = side === 'en' ? 'enCues' : 'viCues'
    return { ...current, [key]: current[key].map((cue) => (cue.id === id ? { ...cue, text } : cue)) }
  })

  function ingest(side: Side, opened: { name: string; content: string }) {
    const cues = parseSubtitles(opened.content, side)
    if (cues.length === 0) { message.error('Không đọc được dòng phụ đề nào. Kiểm tra lại định dạng SRT, VTT hoặc XML.'); return }
    const apply = () => {
      change((current) => {
        const next: Doc = {
          ...current,
          name: current.name || opened.name.replace(/\.[^.]+$/, ''),
          ...(side === 'en' ? { enFile: opened.name, enCues: cues } : { viFile: opened.name, viCues: cues })
        }
        next.items = next.enCues.length && next.viCues.length ? autoAlign(next.enCues, next.viCues) : itemsFromCues(cues, side)
        return next
      })
      message.success(`Đã nạp ${cues.length} dòng ${side === 'en' ? 'tiếng Anh' : 'tiếng Việt'}`)
    }
    const hasLinks = doc.items.some((item) => item.en.length > 0 && item.vi.length > 0)
    if (hasLinks) Modal.confirm({ title: 'Nạp lại file phụ đề?', content: 'Các liên kết hiện có sẽ được ghép lại tự động. Bạn vẫn có thể hoàn tác.', okText: 'Nạp lại', cancelText: 'Huỷ', onOk: apply })
    else apply()
  }

  async function pickSubtitle(side: Side) {
    if (!desktop) { message.warning('Hãy mở trong ứng dụng Electron để chọn file, hoặc kéo file vào ô.'); return }
    try {
      const file = await desktop.invoke<OpenedFile | null>('subtitles', 'open-file', 'subtitle')
      if (file) ingest(side, file)
    } catch (cause) { message.error(errorMessage(cause)) }
  }

  async function dropSubtitle(side: Side, file: File) {
    if (!/\.(srt|vtt|xml|ttml|dfxp|srv3)$/i.test(file.name)) { message.error('Chỉ nhận file phụ đề .srt, .vtt hoặc .xml (TTML/DFXP, YouTube).'); return }
    if (file.size > maxFileBytes) { message.error('File lớn hơn 10 MB.'); return }
    try { ingest(side, { name: file.name, content: (await file.text()).replace(/^\uFEFF/, '') }) }
    catch (cause) { message.error(errorMessage(cause)) }
  }

  function adoptAudio(info: AudioInfo | null) {
    if (!info) return
    setPlayingId(null)
    setAudio(info)
    setAudioVersion((version) => version + 1)
    message.success(`Đã đính kèm âm thanh: ${info.name}`)
  }

  async function pickAudio() {
    if (!desktop) { message.warning('Hãy mở trong ứng dụng Electron để chọn file, hoặc kéo file vào ô.'); return }
    try { adoptAudio(await desktop.invoke<AudioInfo | null>('subtitles', 'pick-audio')) }
    catch (cause) { message.error(errorMessage(cause)) }
  }

  async function dropAudio(file: File) {
    if (!audioPattern.test(file.name)) { message.error('Chỉ nhận âm thanh mp3, m4a, aac, wav, flac, ogg, opus hoặc mp4/webm.'); return }
    const path = window.desktop?.files.pathFor(file)
    if (!desktop || !path) { message.warning('Hãy mở trong ứng dụng Electron để đính kèm âm thanh.'); return }
    try { adoptAudio(await desktop.invoke<AudioInfo | null>('subtitles', 'set-audio', path)) }
    catch (cause) { message.error(errorMessage(cause)) }
  }

  async function removeAudio() {
    audioRef.current?.pause()
    setPlayingId(null)
    setAudio(null)
    try { await desktop?.invoke('subtitles', 'clear-audio') } catch (cause) { message.error(errorMessage(cause)) }
  }

  async function playSegment(item: Item) {
    const element = audioRef.current
    const timing = itemTiming(item, enMap, viMap)
    if (!element || !audio || !timing) return
    if (playingId === item.id) { element.pause(); return }
    const start = Math.max(0, timing.start - padding * 1000) / 1000
    const end = (timing.end + padding * 1000) / 1000
    try {
      if (element.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          element.addEventListener('loadedmetadata', () => resolve(), { once: true })
          element.addEventListener('error', () => reject(new Error('Không đọc được file âm thanh.')), { once: true })
        })
      }
      if (Number.isFinite(element.duration) && start >= element.duration) { message.warning('Mốc thời gian của dòng này vượt quá độ dài file âm thanh.'); return }
      segment.current = { start, end }
      element.currentTime = start
      element.playbackRate = rate
      await element.play()
      setPlayingId(item.id)
    } catch (cause) { message.error(errorMessage(cause)) }
  }

  // Scrolls to the next/previous row that still needs checking (missing an English or Vietnamese side), wrapping around.
  function jumpToCheck(direction: 'next' | 'previous') {
    if (flagged.length === 0) return
    const middle = window.scrollY + window.innerHeight / 2
    const current = virtualizer.getVirtualItems().reduce((found, row) => (row.start <= middle ? row.index : found), -1)
    const target = direction === 'next' ? flagged.find((position) => position > current) : [...flagged].reverse().find((position) => position < current)
    const destination = target ?? (direction === 'next' ? flagged[0] : flagged[flagged.length - 1])
    if (target === undefined && flagged.length > 1) message.info(direction === 'next' ? 'Đã hết dòng cần kiểm tra, quay lại dòng đầu tiên.' : 'Đã tới dòng đầu tiên, quay lại dòng cuối cùng.')
    virtualizer.scrollToIndex(destination, { align: 'center' })
    setFocusId(rows[destination].item.id)
    clearTimeout(focusTimer.current)
    focusTimer.current = setTimeout(() => setFocusId(null), 1600)
  }

  function realign() {
    if (!doc.enCues.length || !doc.viCues.length) { message.warning('Cần nạp cả hai file phụ đề trước.'); return }
    change((current) => ({ ...current, items: autoAlign(current.enCues, current.viCues) }))
    message.success('Đã ghép lại theo thời gian')
  }

  function split(side: Side, cueId: string) {
    const position = caret.current[cueId]
    const text = (side === 'en' ? enMap : viMap).get(cueId)?.text ?? ''
    if (!position || position >= text.length) { message.warning('Đặt con trỏ vào giữa câu, tại chỗ cần tách.'); return }
    change((current) => {
      const key = side === 'en' ? 'enCues' : 'viCues'
      const result = splitCue(current[key], current.items, side, cueId, position)
      if (!result) { message.warning('Không tách được tại vị trí này.'); return null }
      return { ...current, [key]: result.cues, items: result.items }
    })
  }

  async function exportAs(ext: 'json' | 'csv') {
    if (!desktop) return
    if (stats.total === 0) { message.warning('Chưa có dữ liệu để xuất.'); return }
    setBusy(true)
    try {
      const path = await desktop.invoke<string | null>('subtitles', 'save-file', { name: doc.name, ext, content: ext === 'json' ? toJson(doc) : toCsv(doc) })
      if (path) message.success(`Đã xuất: ${path}`)
    } catch (cause) { message.error(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function saveProject() {
    if (!desktop) return
    setBusy(true)
    try {
      const path = await desktop.invoke<string | null>('subtitles', 'save-file', { name: `${doc.name || 'subtitles'}.project`, ext: 'json', content: JSON.stringify({ kind: 'subtitle-project', version: 1, ...doc }) })
      if (path) message.success(`Đã lưu dự án: ${path}`)
    } catch (cause) { message.error(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function openProject() {
    if (!desktop) return
    setOpening(true)
    try {
      const file = await desktop.invoke<OpenedFile | null>('subtitles', 'open-file', 'project')
      if (!file) { setOpening(false); return }
      // Let the overlay paint before the heavy parse and render below.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const data = JSON.parse(file.content) as Partial<Doc> & { kind?: string }
      if (data.kind !== 'subtitle-project' || !Array.isArray(data.enCues) || !Array.isArray(data.viCues) || !Array.isArray(data.items)) throw new Error('Đây không phải file dự án phụ đề.')
      const { enCues, viCues, items } = data
      openingRef.current = true
      change(() => ({ name: data.name ?? '', enFile: data.enFile ?? '', viFile: data.viFile ?? '', enCues, viCues, items }))
      message.success('Đã mở dự án')
    } catch (cause) {
      openingRef.current = false
      setOpening(false)
      message.error(errorMessage(cause))
    }
  }

  function startOver() {
    setHistory([])
    setDoc(emptyDoc)
    void desktop?.invoke('subtitles', 'clear-draft').catch(() => undefined)
  }

  // Only rows near the viewport are mounted; see the virtualizer below.
  const renderRow = ({ item, index }: { item: Item; index: number }) => {
      const timing = itemTiming(item, enMap, viMap)
      const incomplete = item.en.length === 0 || item.vi.length === 0
      const renderSide = (side: Side) => {
        const ids = side === 'en' ? item.en : item.vi
        const cues = side === 'en' ? enMap : viMap
        if (ids.length === 0) return <div className="sub-cue-empty">{side === 'en' ? 'Chưa có tiếng Anh' : 'Chưa có tiếng Việt'}</div>
        return ids.map((id, position) => {
          const cue = cues.get(id)
          if (!cue) return null
          return <CueBox key={id} cue={cue} side={side}
            canUp={position === 0 && index > 0} canDown={position === ids.length - 1 && index < doc.items.length - 1}
            onText={(text) => editText(side, id, text)}
            onMove={(direction) => setItems((items) => moveCue(items, index, side, direction))}
            onSplit={() => split(side, id)}
            onCaret={(value) => { caret.current[id] = value }} />
        })
      }
      return <div key={item.id} data-item-id={item.id} className={`sub-grid sub-row${incomplete ? ' incomplete' : ''}${playingId === item.id ? ' playing' : ''}${focusId === item.id ? ' focus' : ''}`}>
        <span className="sub-index">{index + 1}</span>
        <span className="sub-time">{timing ? <>{formatTime(timing.start)}<br />{formatTime(timing.end)}</> : '—'}
          <Tooltip title={audio ? (playingId === item.id ? 'Dừng' : 'Nghe thử đoạn này') : 'Đính kèm file âm thanh để nghe thử'}>
            <Button className="sub-play" type="text" shape="circle" aria-label={playingId === item.id ? 'Dừng' : 'Nghe thử đoạn này'} disabled={!audio || !timing}
              icon={playingId === item.id ? <PauseCircleFilled /> : <PlayCircleFilled />} onClick={() => void playSegment(item)} />
          </Tooltip>
        </span>
        <div className="sub-side">{renderSide('en')}</div>
        <div className="sub-side">{renderSide('vi')}</div>
        <div className="sub-row-tools">
          <Tooltip title="Gộp với dòng dưới"><Button size="small" type="text" aria-label="Gộp với dòng dưới" icon={<MergeCellsOutlined />} disabled={index >= doc.items.length - 1} onClick={() => setItems((items) => mergeWithNext(items, index))} /></Tooltip>
          <Tooltip title="Thêm dòng trống bên dưới"><Button size="small" type="text" aria-label="Thêm dòng trống bên dưới" icon={<PlusOutlined />} onClick={() => setItems((items) => addItemAfter(items, index))} /></Tooltip>
          <Tooltip title="Xoá dòng"><Button size="small" type="text" danger aria-label="Xoá dòng" icon={<DeleteOutlined />} onClick={() => setItems((items) => removeItem(items, index))} /></Tooltip>
        </div>
      </div>
  }

  return <ModulePage title="Biên soạn phụ đề" description="Liên kết phụ đề tiếng Anh và tiếng Việt thành dữ liệu đáp án cho bài nghe và viết tiếng Anh." icon={<TranslationOutlined />}>
    {!desktop && <Alert type="warning" showIcon title="Hãy mở trong ứng dụng Electron để nạp và xuất tệp." className="sub-alert" />}
    {opening && <div className="sub-loading" role="status" aria-live="polite"><Spin size="large" /><span>Đang mở dự án…</span></div>}
    {audio && <audio ref={audioRef} src={`miniapp-subaudio://media/current?v=${audioVersion}`} preload="auto"
      onPause={() => setPlayingId(null)}
      onError={() => { setPlayingId(null); message.error('Không phát được file âm thanh này. Định dạng hoặc codec có thể chưa được hỗ trợ.') }} />}

    <Card className="sub-card">
      <div className="sub-toolbar">
        <div className="sub-files">
          <DropSlot label="Phụ đề tiếng Anh" fileName={doc.enFile} detail={`${doc.enFile} · ${doc.enCues.length} dòng`} hint={subtitleHint} onPick={() => void pickSubtitle('en')} onDropFile={(file) => void dropSubtitle('en', file)} />
          <DropSlot label="Phụ đề tiếng Việt" fileName={doc.viFile} detail={`${doc.viFile} · ${doc.viCues.length} dòng`} hint={subtitleHint} onPick={() => void pickSubtitle('vi')} onDropFile={(file) => void dropSubtitle('vi', file)} />
        </div>
        <Space wrap>
          <Tooltip title="Ghép lại tự động theo thời gian (bỏ các liên kết thủ công)"><Button onClick={realign} disabled={!doc.enCues.length || !doc.viCues.length}>Tự động ghép</Button></Tooltip>
          <Button icon={<UndoOutlined />} onClick={undo} disabled={history.length === 0}>Hoàn tác</Button>
          <Popconfirm title="Bắt đầu lại?" description="Xoá toàn bộ dữ liệu đang soạn." okText="Xoá" cancelText="Huỷ" okButtonProps={{ danger: true }} onConfirm={startOver}><Button danger icon={<DeleteOutlined />} disabled={stats.total === 0}>Làm mới</Button></Popconfirm>
        </Space>
      </div>
      <div className="sub-toolbar sub-toolbar-second">
        <DropSlot label="File âm thanh" fileName={audio?.name ?? ''} detail={audio?.name ?? ''} hint="Kéo file âm thanh vào đây hoặc bấm để chọn (mp3, m4a, wav, …)" onPick={() => void pickAudio()} onDropFile={(file) => void dropAudio(file)} />
        {audio && <Space wrap size="middle" className="sub-audio-options">
          <Space size="small"><SoundOutlined /><Select aria-label="Tốc độ phát" value={rate} style={{ width: 84 }} onChange={setRate} options={[0.5, 0.75, 1, 1.25, 1.5].map((value) => ({ value, label: `${value}×` }))} /></Space>
          <Tooltip title="Phát thêm một chút trước và sau mỗi đoạn để không bị cụt chữ"><Select aria-label="Đệm đầu cuối đoạn" value={padding} style={{ width: 120 }} onChange={setPadding} options={[0, 0.25, 0.5, 1].map((value) => ({ value, label: value ? `Đệm ${value}s` : 'Không đệm' }))} /></Tooltip>
          <Space size="small"><Switch size="small" checked={loop} onChange={setLoop} aria-label="Lặp đoạn" /><span className="sub-file-hint">Lặp đoạn</span></Space>
          <Button size="small" onClick={() => void removeAudio()}>Gỡ âm thanh</Button>
        </Space>}
      </div>
      <div className="sub-toolbar sub-toolbar-second">
        <Input className="sub-name" placeholder="Tên bài (dùng làm tên tệp xuất)" maxLength={100} value={doc.name} onChange={(event) => setDoc((current) => ({ ...current, name: event.target.value }))} />
        <Space wrap>
          <Button icon={<FolderOpenOutlined />} disabled={!desktop || opening} loading={opening} onClick={() => void openProject()}>Mở dự án</Button>
          <Button icon={<SaveOutlined />} disabled={!desktop || stats.total === 0} loading={busy} onClick={() => void saveProject()}>Lưu dự án</Button>
          <Button type="primary" icon={<DownloadOutlined />} disabled={!desktop || stats.total === 0} loading={busy} onClick={() => void exportAs('json')}>Xuất JSON</Button>
          <Button icon={<DownloadOutlined />} disabled={!desktop || stats.total === 0} loading={busy} onClick={() => void exportAs('csv')}>Xuất CSV</Button>
        </Space>
      </div>
    </Card>

    <Card className="sub-card">
      <div className="sub-summary">
        <Space wrap size={[8, 8]}>
          <Tag>{stats.total} dòng</Tag>
          <Tag color="green">{stats.complete} đã ghép đủ</Tag>
          <Tag color={stats.missingVi ? 'orange' : undefined}>{stats.missingVi} thiếu tiếng Việt</Tag>
          <Tag color={stats.missingEn ? 'orange' : undefined}>{stats.missingEn} thiếu tiếng Anh</Tag>
        </Space>
        <Space size="small" className="sub-check">
          <span className="sub-file-hint">Dòng cần kiểm tra ({stats.missingVi + stats.missingEn})</span>
          <Tooltip title="Cuộn lên dòng cần kiểm tra phía trên"><Button size="small" icon={<ArrowUpOutlined />} disabled={stats.missingVi + stats.missingEn === 0} onClick={() => jumpToCheck('previous')}>Trước</Button></Tooltip>
          <Tooltip title="Cuộn xuống dòng cần kiểm tra kế tiếp"><Button size="small" type="primary" icon={<ArrowDownOutlined />} disabled={stats.missingVi + stats.missingEn === 0} onClick={() => jumpToCheck('next')}>Tiếp</Button></Tooltip>
        </Space>
        <Select aria-label="Lọc dòng" value={filter} style={{ width: 190 }} onChange={setFilter}
          options={[{ value: 'all', label: 'Tất cả các dòng' }, { value: 'missing', label: 'Chỉ dòng chưa đủ cặp' }, { value: 'complete', label: 'Chỉ dòng đã ghép đủ' }]} />
      </div>

      {stats.total === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nạp file phụ đề tiếng Anh và tiếng Việt để bắt đầu." /> : <>
        <div className="sub-grid sub-grid-head"><span>#</span><span>Thời gian</span><span>Tiếng Anh (đáp án)</span><span>Tiếng Việt (đề)</span><span /></div>
        {rows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dòng nào khớp bộ lọc." /> : <div ref={listRef} className="sub-virtual" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => <div key={virtualRow.key} data-index={virtualRow.index} ref={virtualizer.measureElement} className="sub-virtual-row" style={{ transform: `translateY(${virtualRow.start - listOffset}px)` }}>
            {renderRow(rows[virtualRow.index])}
          </div>)}
        </div>}
      </>}
    </Card>
  </ModulePage>
}

export const subtitlesRendererModule: RendererModule = {
  id: 'subtitles',
  label: 'Biên soạn phụ đề',
  icon: <TranslationOutlined />,
  element: <SubtitleEditor />
}
