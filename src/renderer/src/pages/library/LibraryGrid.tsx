import { PlayCircleFilled } from '@ant-design/icons'
import { Image } from 'antd'
import type { LibraryFile } from '../../../../library/types'
import { FileContextMenu, FileMenuButton, type FileActions } from './FileMenu'
import { FileTypeIcon } from './FileTypeIcon'
import { fileDate, fileSize, mediaUrl } from './format'

export function LibraryGrid({ files, actions }: { files: LibraryFile[]; actions: FileActions }) {
  return <div className="drive-grid">{files.map((file) => <FileContextMenu key={file.id} file={file} actions={actions}>
    <article className="drive-card" tabIndex={0} onClick={() => actions.view(file)} onKeyDown={(event) => { if (event.key === 'Enter') actions.view(file) }} aria-label={`View ${file.name}`}>
      <header className="drive-card-head">
        <FileTypeIcon kind={file.kind} />
        <strong title={file.name}>{file.name}</strong>
        <FileMenuButton file={file} actions={actions} />
      </header>
      <div className={`drive-card-thumb ${file.kind === 'video' ? 'is-video' : ''}`}>
        {file.kind === 'image'
          ? <Image src={mediaUrl(file)} alt={file.name} loading="lazy" preview={false} width="100%" height="100%" />
          : <><video src={`${mediaUrl(file)}#t=0.1`} preload="metadata" muted /><PlayCircleFilled className="drive-card-play" /></>}
      </div>
      <footer className="drive-card-foot" title={file.relativePath}>
        <span>{fileDate(file.modifiedAt)} · {fileSize(file.size)}</span>
        {file.tags.length > 0 && <span className="drive-card-tags">{file.tags.slice(0, 2).join(', ')}{file.tags.length > 2 ? ` +${file.tags.length - 2}` : ''}</span>}
      </footer>
    </article>
  </FileContextMenu>)}</div>
}
