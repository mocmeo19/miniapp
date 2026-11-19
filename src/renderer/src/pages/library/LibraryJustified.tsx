import { PlayCircleFilled } from '@ant-design/icons'
import justifiedLayout from 'justified-layout'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryFile } from '../../../../library/types'
import { FileContextMenu, FileMenuButton, type FileActions } from './FileMenu'
import { mediaUrl } from './format'

const targetRowHeight = 220
const spacing = 8

// Sizes come from the index (read while scanning). Files not measured yet fall back to the ratio
// learned when their thumbnail loads, then to a typical ratio.
const ratios = new Map<string, number>()
const ratioKey = (file: LibraryFile) => `${file.id}:${file.modifiedAt}`
const ratioOf = (file: LibraryFile) => file.width && file.height
  ? file.width / file.height
  : ratios.get(ratioKey(file)) ?? (file.kind === 'video' ? 16 / 9 : 4 / 3)

export function LibraryJustified({ files, actions }: { files: LibraryFile[]; actions: FileActions }) {
  const container = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const [width, setWidth] = useState(0)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current) }
  }, [])

  function learn(file: LibraryFile, mediaWidth: number, mediaHeight: number) {
    if (file.width && file.height) return
    if (!mediaWidth || !mediaHeight) return
    const ratio = mediaWidth / mediaHeight
    if (Math.abs(ratioOf(file) - ratio) < 0.01) return
    ratios.set(ratioKey(file), ratio)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setRevision((value) => value + 1))
  }

  const layout = useMemo(() => width > 0
    ? justifiedLayout(files.map(ratioOf), { containerWidth: width, containerPadding: 0, boxSpacing: spacing, targetRowHeight })
    : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [files, width, revision])

  return <div ref={container} className="drive-justified" style={{ height: layout?.containerHeight }}>
    {layout && files.map((file, index) => {
      const box = layout.boxes[index]
      return <FileContextMenu key={file.id} file={file} actions={actions}>
        <div className="drive-justified-item" role="button" tabIndex={0} aria-label={`View ${file.name}`}
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
          onClick={() => actions.view(file)} onKeyDown={(event) => { if (event.key === 'Enter') actions.view(file) }}>
          {file.kind === 'image'
            ? <img src={mediaUrl(file)} alt={file.name} loading="lazy" draggable={false} onLoad={(event) => learn(file, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
            : <><video src={`${mediaUrl(file)}#t=0.1`} preload="metadata" muted onLoadedMetadata={(event) => learn(file, event.currentTarget.videoWidth, event.currentTarget.videoHeight)} /><PlayCircleFilled className="drive-justified-play" /></>}
          <div className="drive-justified-overlay"><span title={file.name}>{file.name}</span><FileMenuButton file={file} actions={actions} /></div>
        </div>
      </FileContextMenu>
    })}
  </div>
}
