import { DownOutlined, FolderFilled, FolderOpenFilled, PictureOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Tooltip, Tree, type TreeDataNode } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryFolder, LibrarySubfolder } from '../../../../library/types'
import { FolderContextMenu } from './FolderMenu'
import { folderName } from './format'

type LibrarySidebarProps = {
  folders: LibraryFolder[]
  folderId: string
  directory: string
  revision: number
  loadSubfolders: (folderId: string, directory: string) => Promise<LibrarySubfolder[]>
  onSelect: (folderId: string, directory: string) => void
  onManage: () => void
  onAutoTag: (folderId: string, directory: string) => void
}

type NodeInfo = { folderId: string; directory: string }

const idLength = 36

function nodeKey(folderId: string, directory: string): string {
  return directory ? `${folderId}/${directory}` : folderId
}

function parseKey(key: string): NodeInfo {
  return { folderId: key.slice(0, idLength), directory: key.slice(idLength + 1) }
}

function ancestorKeys(folderId: string, directory: string): string[] {
  const parts = directory ? directory.split('/') : []
  return [folderId, ...parts.slice(0, -1).map((_, index) => nodeKey(folderId, parts.slice(0, index + 1).join('/')))]
}

function nodeTitle(name: string, count: number, tooltip: string, onAutoTag: () => void) {
  return <FolderContextMenu onAutoTag={onAutoTag}>
    <span className="drive-tree-title" title={tooltip}><span>{name}</span><small>{count.toLocaleString()}</small></span>
  </FolderContextMenu>
}

export function LibrarySidebar({ folders, folderId, directory, revision, loadSubfolders, onSelect, onManage, onAutoTag }: LibrarySidebarProps) {
  const [children, setChildren] = useState<Record<string, LibrarySubfolder[]>>({})
  const [expanded, setExpanded] = useState<string[]>([])
  const pending = useRef(new Map<string, Promise<void>>())
  const total = folders.reduce((sum, folder) => sum + folder.fileCount, 0)

  const load = useCallback((key: string): Promise<void> => {
    const running = pending.current.get(key)
    if (running) return running
    const { folderId: id, directory: path } = parseKey(key)
    const task = loadSubfolders(id, path)
      .then((items) => setChildren((current) => ({ ...current, [key]: items })))
      .catch(() => setChildren((current) => ({ ...current, [key]: [] })))
      .finally(() => pending.current.delete(key))
    pending.current.set(key, task)
    return task
  }, [loadSubfolders])

  useEffect(() => {
    pending.current.clear()
    setChildren({})
  }, [revision])

  useEffect(() => {
    if (folderId === 'all') return
    const needed = ancestorKeys(folderId, directory)
    setExpanded((current) => needed.every((key) => current.includes(key)) ? current : [...new Set([...current, ...needed])])
  }, [folderId, directory])

  useEffect(() => {
    for (const key of expanded) if (!children[key]) void load(key)
  }, [expanded, children, load])

  const build = (id: string, items: LibrarySubfolder[] | undefined): TreeDataNode[] | undefined => items?.map((item) => {
    const key = nodeKey(id, item.path)
    const loaded = children[key]
    return { key, title: nodeTitle(item.name, item.fileCount, item.path, () => onAutoTag(id, item.path)), isLeaf: loaded ? loaded.length === 0 : false, children: build(id, loaded) }
  })

  const treeData: TreeDataNode[] = folders.map((folder) => {
    const loaded = children[folder.id]
    return { key: folder.id, title: nodeTitle(folderName(folder.path), folder.fileCount, folder.path, () => onAutoTag(folder.id, '')), isLeaf: loaded ? loaded.length === 0 : false, children: build(folder.id, loaded) }
  })

  const selectedKey = folderId === 'all' ? undefined : nodeKey(folderId, directory)

  return <aside className="drive-sidebar">
    <h1 className="drive-title">Library</h1>
    <nav className="drive-nav">
      <button type="button" className={`drive-nav-item ${folderId === 'all' ? 'selected' : ''}`} onClick={() => onSelect('all', '')}>
        <PictureOutlined /><span>All media</span><small>{total}</small>
      </button>
      <div className="drive-nav-caption"><span>Folders</span>
        <Tooltip title="Manage folders"><Button type="text" shape="circle" size="small" icon={<SettingOutlined />} onClick={onManage} aria-label="Manage folders" /></Tooltip>
      </div>
      {folders.length > 0 && <Tree className="drive-tree" blockNode showIcon treeData={treeData}
        icon={(props) => (props as { expanded?: boolean }).expanded ? <FolderOpenFilled /> : <FolderFilled />}
        switcherIcon={<DownOutlined />}
        expandedKeys={expanded}
        onExpand={(keys) => setExpanded(keys.map(String))}
        loadData={(node) => load(String(node.key))}
        loadedKeys={Object.keys(children)}
        selectedKeys={selectedKey ? [selectedKey] : []}
        onSelect={(_keys, { node }) => { const info = parseKey(String(node.key)); onSelect(info.folderId, info.directory) }} />}
      {folders.length === 0 && <p className="drive-nav-hint">Add a folder to index its images and videos, including nested folders.</p>}
    </nav>
  </aside>
}
