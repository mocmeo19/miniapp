import { Tag } from 'antd'
import type { LibraryFile, LibraryFolder } from '../../../../library/types'
import { FileContextMenu, FileMenuButton, type FileActions } from './FileMenu'
import { FileTypeIcon } from './FileTypeIcon'
import { fileDate, fileSize, folderName } from './format'

type LibraryListProps = {
  files: LibraryFile[]
  folders: LibraryFolder[]
  actions: FileActions
}

export function LibraryList({ files, folders, actions }: LibraryListProps) {
  const locations = new Map(folders.map((folder) => [folder.id, folderName(folder.path)]))
  return <div className="drive-list" role="table">
    <div className="drive-list-row drive-list-head" role="row">
      <span role="columnheader">Name</span><span role="columnheader">Tags</span><span role="columnheader">Location</span>
      <span role="columnheader">Modified</span><span role="columnheader">Size</span><span />
    </div>
    {files.map((file) => <FileContextMenu key={file.id} file={file} actions={actions}>
      <div className="drive-list-row" role="row" tabIndex={0} onClick={() => actions.view(file)} onKeyDown={(event) => { if (event.key === 'Enter') actions.view(file) }}>
        <span className="drive-list-name" role="cell"><FileTypeIcon kind={file.kind} /><strong title={file.name}>{file.name}</strong></span>
        <span className="drive-list-tags" role="cell">{file.tags.slice(0, 2).map((item) => <Tag key={item}>{item}</Tag>)}{file.tags.length > 2 && <Tag>+{file.tags.length - 2}</Tag>}</span>
        <span className="drive-list-muted" role="cell" title={file.relativePath}>{[locations.get(file.folderId) ?? '—', ...(file.directory ? file.directory.split('/') : [])].join(' / ')}</span>
        <span className="drive-list-muted" role="cell">{fileDate(file.modifiedAt)}</span>
        <span className="drive-list-muted" role="cell">{fileSize(file.size)}</span>
        <span role="cell"><FileMenuButton file={file} actions={actions} /></span>
      </div>
    </FileContextMenu>)}
  </div>
}
