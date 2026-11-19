import { InfoCircleOutlined } from '@ant-design/icons'
import { Button, Image, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import type { LibraryFile, LibraryFolder } from '../../../../library/types'
import { mediaUrl } from './format'
import { MediaInfoPanel, type MediaInfoActions } from './MediaInfoPanel'

type LibraryViewerProps = {
  files: LibraryFile[]
  folders: LibraryFolder[]
  allTags: string[]
  index: number | null
  onIndexChange: (index: number | null) => void
  actions: MediaInfoActions
}

const infoKey = 'library.viewerInfo'

function storedInfoOpen(): boolean {
  try { return localStorage.getItem(infoKey) !== '0' } catch { return true }
}

export function LibraryViewer({ files, folders, allTags, index, onIndexChange, actions }: LibraryViewerProps) {
  const [infoOpen, setInfoOpen] = useState(storedInfoOpen)
  const [duration, setDuration] = useState<{ id: string; seconds: number } | null>(null)
  const file = index === null ? undefined : files[index]
  const showInfo = !!file && infoOpen

  function toggleInfo(open: boolean) {
    setInfoOpen(open)
    try { localStorage.setItem(infoKey, open ? '1' : '0') } catch { /* storage unavailable */ }
  }

  // The viewer is full screen; this class makes room for the details panel on the right.
  useEffect(() => {
    document.body.classList.toggle('library-viewer-with-info', showInfo)
    return () => document.body.classList.remove('library-viewer-with-info')
  }, [showInfo])

  return <>
    <Image.PreviewGroup
      items={files.map((item) => ({ src: mediaUrl(item), alt: item.name }))}
      preview={{
        open: index !== null,
        current: index ?? 0,
        onOpenChange: (open) => { if (!open) onIndexChange(null) },
        onChange: (current) => onIndexChange(current),
        imageRender: (node, { current }) => {
          const item = files[current]
          return item?.kind === 'video'
            ? <video key={item.id} className="library-viewer-video" src={mediaUrl(item)} controls autoPlay preload="metadata"
              onLoadedMetadata={(event) => setDuration({ id: item.id, seconds: event.currentTarget.duration })} />
            : node
        },
        actionsRender: (node, { current }) => {
          const item = files[current]
          return <div className="library-viewer-actions">
            {item && !infoOpen && <span className="library-viewer-name" title={item.relativePath}>{item.name}</span>}
            {node}
            <Tooltip title={infoOpen ? 'Hide details' : 'Show details'}>
              <Button size="small" type={infoOpen ? 'primary' : 'default'} icon={<InfoCircleOutlined />} aria-label="Toggle details" onClick={() => toggleInfo(!infoOpen)} />
            </Tooltip>
          </div>
        }
      }}
    />
    {showInfo && <MediaInfoPanel file={file} folders={folders} allTags={allTags} actions={actions}
      duration={duration?.id === file.id && Number.isFinite(duration.seconds) ? duration.seconds : null} onClose={() => toggleInfo(false)} />}
  </>
}
