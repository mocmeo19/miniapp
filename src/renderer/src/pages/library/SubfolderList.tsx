import { FolderFilled } from '@ant-design/icons'
import type { LibrarySubfolder } from '../../../../library/types'
import { FolderContextMenu } from './FolderMenu'

type SubfolderListProps = {
  subfolders: LibrarySubfolder[]
  layout: 'grid' | 'list'
  onOpen: (path: string) => void
  onAutoTag: (path: string) => void
}

export function SubfolderList({ subfolders, layout, onOpen, onAutoTag }: SubfolderListProps) {
  return <div className={layout === 'grid' ? 'drive-folder-grid' : 'drive-folder-list'}>
    {subfolders.map((folder) => <FolderContextMenu key={folder.path} onAutoTag={() => onAutoTag(folder.path)}>
      <button type="button" className="drive-folder-tile" title={folder.path} onClick={() => onOpen(folder.path)}>
        <FolderFilled /><strong>{folder.name}</strong><small>{folder.fileCount.toLocaleString()}</small>
      </button>
    </FolderContextMenu>)}
  </div>
}
