import { AppstoreOutlined, PictureOutlined, ReloadOutlined, RightOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Alert, Button, Drawer, Empty, Input, Pagination, Segmented, Select, Spin, Tooltip, message } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutoTagStatus, LibraryFile, LibraryFolder, LibraryPage, LibraryScanEvent } from '../../../library/types'
import type { FileActions } from './library/FileMenu'
import { FilterChip } from './library/FilterChip'
import { errorText, folderName } from './library/format'
import { LibraryGrid } from './library/LibraryGrid'
import { LibraryJustified } from './library/LibraryJustified'
import { LibraryFoldersDrawer } from './library/LibraryFoldersDrawer'
import { LibraryList } from './library/LibraryList'
import { LibrarySidebar } from './library/LibrarySidebar'
import { LibraryViewer } from './library/LibraryViewer'
import { SubfolderList } from './library/SubfolderList'

const pageSize = 48
const viewModeKey = 'library.viewMode'
const viewModes = ['list', 'grid', 'justified'] as const
type ViewMode = typeof viewModes[number]

function storedViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(viewModeKey)
    return viewModes.find((mode) => mode === stored) ?? 'grid'
  } catch { return 'grid' }
}

function storeViewMode(mode: ViewMode) {
  try { localStorage.setItem(viewModeKey, mode) } catch { /* storage unavailable */ }
}

export function LibraryPage() {
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [data, setData] = useState<LibraryPage>({ files: [], total: 0, tags: [], subfolders: [] })
  const [folderId, setFolderId] = useState('all')
  const [directory, setDirectory] = useState('')
  const [kind, setKind] = useState<'all' | 'image' | 'video'>('all')
  const [tag, setTag] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<LibraryScanEvent | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<LibraryFile | null>(null)
  const [managingFolders, setManagingFolders] = useState(false)
  const [editingTags, setEditingTags] = useState<string[]>([])
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(storedViewMode)
  const [autoTag, setAutoTag] = useState<AutoTagStatus | null>(null)
  const autoTagPhase = useRef<AutoTagStatus['phase']>('idle')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => { setPage(1) }, [folderId, directory, kind, tag, debouncedSearch])

  useEffect(() => {
    const api = window.desktop?.library
    if (!api) return
    let active = true
    void api.folders().then((items) => { if (active) setFolders(items) }).catch((cause) => { if (active) setError(errorText(cause)) })
    return () => { active = false }
  }, [revision])

  useEffect(() => {
    const api = window.desktop?.library
    if (!api) return
    let active = true
    setLoading(true)
    void api.files({
      search: debouncedSearch, folderId: folderId === 'all' ? undefined : folderId, directory: folderId === 'all' ? undefined : directory,
      kind: kind === 'all' ? undefined : kind, tag: tag === 'all' ? undefined : tag,
      offset: (page - 1) * pageSize, limit: pageSize
    }).then((result) => { if (active) { setData(result); setError('') } })
      .catch((cause) => { if (active) setError(errorText(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [folderId, directory, kind, tag, debouncedSearch, page, revision])

  useEffect(() => {
    const api = window.desktop?.library
    if (!api) return
    const stopScan = api.onScan((event) => {
      setScan(event)
      if (event.state === 'completed' || event.state === 'failed') setRevision((value) => value + 1)
    })
    const stopDimensions = api.onDimensions(() => setRevision((value) => value + 1))
    return () => { stopScan(); stopDimensions() }
  }, [])

  useEffect(() => {
    const api = window.desktop?.library
    if (!api) return
    const receive = (status: AutoTagStatus) => {
      if (autoTagPhase.current === 'tagging' && status.phase !== 'tagging') setRevision((value) => value + 1)
      autoTagPhase.current = status.phase
      setAutoTag(status)
    }
    void api.autoTagStatus().then(receive).catch(() => undefined)
    return api.onAutoTag(receive)
  }, [])

  async function toggleAutoTag(enabled: boolean) {
    try { setAutoTag(await window.desktop!.library.setAutoTag(enabled)) }
    catch (cause) { message.error(errorText(cause)) }
  }

  async function requestAutoTag(run: () => Promise<AutoTagStatus>, what: string) {
    try {
      setAutoTag(await run())
      message.info(`Auto-tagging ${what}…`)
    } catch (cause) { message.error(errorText(cause)) }
  }

  function autoTagFolder(id: string, path: string) {
    const name = path ? path.split('/').pop() : folderName(folders.find((folder) => folder.id === id)?.path ?? '')
    void requestAutoTag(() => window.desktop!.library.autoTagFolder(id, path), `photos in “${name}”`)
  }

  async function clearAutoTags() {
    try {
      setAutoTag(await window.desktop!.library.clearAutoTags())
      setRevision((value) => value + 1)
      message.success('Auto tags removed')
    } catch (cause) { message.error(errorText(cause)) }
  }

  async function addFolders() {
    if (!window.desktop) return
    setBusy(true)
    try {
      const added = await window.desktop.library.addFolders()
      if (added.length === 0) return
      setRevision((value) => value + 1)
      for (const folder of added) await window.desktop.library.scan(folder.id)
      message.success(`Added ${added.length} folder${added.length === 1 ? '' : 's'}`)
    } catch (cause) { message.error(errorText(cause)) }
    finally { setBusy(false); setRevision((value) => value + 1) }
  }

  async function rescan(value: string) {
    if (!window.desktop) return
    setBusy(true)
    try {
      await window.desktop.library.scan(value)
      message.success('Library index updated')
    } catch (cause) { message.error(errorText(cause)) }
    finally { setBusy(false); setRevision((current) => current + 1) }
  }

  async function removeFolder(id: string) {
    try {
      await window.desktop?.library.removeFolder(id)
      if (folderId === id) selectFolder('all')
      setRevision((value) => value + 1)
      message.success('Folder removed from Library; files remain on disk')
    } catch (cause) { message.error(errorText(cause)) }
  }

  async function deleteFile(file: LibraryFile) {
    try {
      await window.desktop?.library.delete(file.id)
      setRevision((value) => value + 1)
      message.success('File moved to Trash')
    } catch (cause) { message.error(errorText(cause)) }
  }

  async function saveTags() {
    if (!editing) return
    try {
      await window.desktop?.library.setTags(editing.id, editingTags)
      setEditing(null)
      setRevision((value) => value + 1)
      message.success('Tags saved')
    } catch (cause) { message.error(errorText(cause)) }
  }

  function selectFolder(id: string, path = '') {
    setFolderId(id)
    setDirectory(id === 'all' ? '' : path)
  }

  const loadSubfolders = useCallback((id: string, path: string) =>
    window.desktop?.library.subfolders(id, path) ?? Promise.resolve([]), [])

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode)
    storeViewMode(mode)
  }

  const actions: FileActions = {
    view: (file) => setViewerIndex(data.files.findIndex((item) => item.id === file.id)),
    openExternal: (file) => { void window.desktop?.library.open(file.id).catch((cause: unknown) => message.error(errorText(cause))) },
    editTags: (file) => { setEditing(file); setEditingTags(file.tags) },
    autoTag: (file) => { void requestAutoTag(() => window.desktop!.library.autoTagFiles([file.id]), `“${file.name}”`) },
    remove: (file) => deleteFile(file)
  }

  const currentFolder = folders.find((folder) => folder.id === folderId)
  const segments = directory ? directory.split('/') : []
  const subfolders = page === 1 ? data.subfolders : []
  const empty = data.files.length === 0 && subfolders.length === 0
  const scanFolder = scan ? folders.find((folder) => folder.id === scan.folderId) : undefined
  const scanning = scan?.state === 'started' || scan?.state === 'progress'

  return <div className="module-page library-page">
    {!window.desktop && <Alert type="warning" showIcon title="Open the Electron app to use Library." className="library-alert" />}
    {error && <Alert type="error" showIcon title="Library error" description={error} closable onClose={() => setError('')} className="library-alert" />}
    {scan?.state === 'completed' && scan.skipped > 0 && <Alert type="warning" showIcon title="Index updated with unreadable items skipped" description={`${scan.skipped} items could not be read. Existing records were kept.`} className="library-alert" />}

    <div className="drive-layout">
      <LibrarySidebar folders={folders} folderId={folderId} directory={directory} revision={revision} loadSubfolders={loadSubfolders} onSelect={selectFolder} onManage={() => setManagingFolders(true)} onAutoTag={autoTagFolder} />

      <section className="drive-main">
        <div className="drive-toolbar">
        <div className="drive-search">
          <Input size="large" variant="filled" prefix={<SearchOutlined />} allowClear placeholder="Search in Library" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        <div className="drive-heading">
          <div className="drive-breadcrumb">
            <button type="button" onClick={() => selectFolder('all')} className={currentFolder ? '' : 'current'}>All media</button>
            {currentFolder && <><RightOutlined /><button type="button" className={segments.length ? '' : 'current'} title={currentFolder.path} onClick={() => setDirectory('')}>{folderName(currentFolder.path)}</button></>}
            {segments.map((segment, index) => <span key={index} className="drive-breadcrumb-part"><RightOutlined />
              <button type="button" className={index === segments.length - 1 ? 'current' : ''} onClick={() => setDirectory(segments.slice(0, index + 1).join('/'))}>{segment}</button>
            </span>)}
          </div>
          <div className="drive-heading-actions">
            <Tooltip title={folderId === 'all' ? 'Rescan all folders' : 'Rescan this folder'}>
              <Button type="text" shape="circle" icon={<ReloadOutlined spin={busy} />} disabled={busy || folders.length === 0} onClick={() => void rescan(folderId)} aria-label="Rescan" />
            </Tooltip>
            <Segmented<ViewMode> value={viewMode} onChange={changeViewMode} options={[
              { value: 'list', icon: <UnorderedListOutlined />, title: 'List layout' },
              { value: 'grid', icon: <AppstoreOutlined />, title: 'Grid layout' },
              { value: 'justified', icon: <PictureOutlined />, title: 'Justified layout' }
            ]} />
          </div>
        </div>

        <div className="drive-filters">
          <FilterChip label="Type" value={kind} onChange={(value) => setKind(value as typeof kind)} options={[{ value: 'image', label: 'Photos' }, { value: 'video', label: 'Videos' }]} />
          <FilterChip label="Tags" value={tag} onChange={setTag} options={data.tags.map((item) => ({ value: item, label: item }))} />
          <span className="drive-count">{data.total.toLocaleString()} files</span>
        </div>
        </div>

        <div className="drive-results">

        {scanning && scan && <div className="drive-scan"><Spin size="small" /><span>Indexing {scanFolder ? folderName(scanFolder.path) : 'folder'}… {scan.indexed.toLocaleString()} found{scan.skipped ? ` · ${scan.skipped} skipped` : ''}</span></div>}
        {autoTag?.phase === 'tagging' && <div className="drive-scan"><Spin size="small" /><span>Auto-tagging photos… {autoTag.done.toLocaleString()} / {autoTag.total.toLocaleString()}</span></div>}
        {autoTag?.phase === 'downloading' && <div className="drive-scan"><Spin size="small" /><span>Downloading auto-tag model… {Math.floor((autoTag.done / Math.max(1, autoTag.total)) * 100)}%</span></div>}

        <Spin spinning={loading}>
          {subfolders.length > 0 && <><h3 className="drive-section-title">Folders</h3><SubfolderList subfolders={subfolders} layout={viewMode === 'list' ? 'list' : 'grid'} onOpen={setDirectory} onAutoTag={(path) => autoTagFolder(folderId, path)} /></>}
          {subfolders.length > 0 && data.files.length > 0 && <h3 className="drive-section-title">Files</h3>}
          {data.files.length > 0 && viewMode === 'grid' && <LibraryGrid files={data.files} actions={actions} />}
          {data.files.length > 0 && viewMode === 'justified' && <LibraryJustified files={data.files} actions={actions} />}
          {data.files.length > 0 && viewMode === 'list' && <LibraryList files={data.files} folders={folders} actions={actions} />}
          {!loading && empty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={folders.length === 0 ? 'Add a folder to start your Library' : debouncedSearch || kind !== 'all' || tag !== 'all' ? 'No files match your search' : 'This folder is empty'} className="library-empty">
            {folders.length === 0 && <Button type="primary" onClick={() => void addFolders()} loading={busy}>Add folders</Button>}
          </Empty>}
        </Spin>
        {data.total > pageSize && <Pagination current={page} pageSize={pageSize} total={data.total} onChange={setPage} showSizeChanger={false} className="library-pagination" />}
        </div>
      </section>
    </div>

    <LibraryFoldersDrawer open={managingFolders} folders={folders} busy={busy} scanningId={scanning ? scan?.folderId : undefined} onClose={() => setManagingFolders(false)}
      onAdd={() => void addFolders()} onRescan={(id) => void rescan(id)} onRemove={(id) => void removeFolder(id)}
      autoTag={autoTag} onToggleAutoTag={(enabled) => void toggleAutoTag(enabled)} onClearAutoTags={() => void clearAutoTags()} />
    <LibraryViewer files={data.files} folders={folders} allTags={data.tags} index={viewerIndex} onIndexChange={setViewerIndex} actions={{
      openExternal: actions.openExternal,
      autoTag: actions.autoTag,
      reveal: (file) => { void window.desktop?.library.reveal(file.id).catch((cause: unknown) => message.error(errorText(cause))) },
      saveTags: async (file, tags) => {
        try {
          await window.desktop?.library.setTags(file.id, tags)
          setRevision((value) => value + 1)
          message.success('Tags saved')
        } catch (cause) { message.error(errorText(cause)) }
      }
    }} />
    <Drawer className="library-tags-drawer" open={!!editing} title={`Tags · ${editing?.name ?? ''}`} onClose={() => setEditing(null)} width={420} destroyOnHidden footer={<Button type="primary" onClick={() => void saveTags()}>Save tags</Button>}>
      <p className="library-tag-help">Type a label and press Enter. Use up to 20 labels.</p><Select mode="tags" style={{ width: '100%' }} value={editingTags} onChange={setEditingTags} tokenSeparators={[',']} maxCount={20} placeholder="Add tags" options={data.tags.map((item) => ({ value: item, label: item }))} />
    </Drawer>
  </div>
}
