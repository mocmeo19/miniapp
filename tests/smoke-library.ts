import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { app, BrowserWindow, ipcMain, nativeImage, net } from 'electron'
import { SettingsStore } from '../src/main/config/SettingsStore'
import { ModuleManager } from '../src/main/modules/ModuleManager'
import { LibraryStore } from '../src/main/library/LibraryStore'
import { startLibrary } from '../src/main/library/LibraryService'
import type { LibraryFolder, LibraryPage } from '../src/library/types'

const userData = mkdtempSync(join(tmpdir(), 'miniapp-library-test-'))
const mediaFolder = join(userData, 'photos')
const nested = join(mediaFolder, 'holiday', 'videos')
mkdirSync(nested, { recursive: true })
const imagePath = join(mediaFolder, 'sample.png')
const videoPath = join(nested, 'clip.mp4')
writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lQAAAABJRU5ErkJggg==', 'base64'))
writeFileSync(videoPath, Buffer.from('video-test-content'))
writeFileSync(join(mediaFolder, 'notes.txt'), 'not indexed')
app.setPath('userData', userData)

void app.whenReady().then(async () => {
  const settings = new SettingsStore()
  const setup = new LibraryStore(settings.path)
  const folder = setup.addFolder(mediaFolder)
  setup.close()
  settings.addBuiltInModule({ id: 'library', name: 'Library', version: '1.0.0', description: 'Legacy module row.' })
  settings.retireBuiltInModule('library')
  const manager = new ModuleManager(settings)
  const stopLibrary = startLibrary(settings.path)
  let window: BrowserWindow | null = null
  let passed = false
  try {
    assert.equal(manager.list().some((module) => module.id === 'library'), false)
    window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
    await window.loadURL('data:text/html,<html><body>library test</body></html>')
    const invoke = <T>(action: string, payload?: unknown): Promise<T> => window!.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke('library:${action}', ${JSON.stringify(payload)})`
    ) as Promise<T>

    await invoke('scan', folder.id)
    const folders = await invoke<LibraryFolder[]>('folders')
    assert.equal(folders[0].fileCount, 2)
    let page = await invoke<LibraryPage>('files')
    assert.equal(page.total, 2)
    const image = page.files.find((file) => file.name === 'sample.png')!
    assert.equal(image.kind, 'image')
    assert.equal(page.files.find((file) => file.name === 'clip.mp4')?.relativePath, join('holiday', 'videos', 'clip.mp4'))
    await invoke('set-tags', { id: image.id, tags: ['favorite', 'holiday'] })
    page = await invoke<LibraryPage>('files', { search: 'favorite' })
    assert.equal(page.total, 1)
    assert.equal(page.files[0].id, image.id)
    page = await invoke<LibraryPage>('files', { kind: 'video' })
    assert.equal(page.total, 1)
    assert.equal(page.files[0].directory, 'holiday/videos')

    page = await invoke<LibraryPage>('files', { folderId: folder.id, directory: '' })
    assert.deepEqual(page.files.map((file) => file.name), ['sample.png'], 'Folder root lists only its direct files')
    assert.deepEqual(page.subfolders, [{ name: 'holiday', path: 'holiday', fileCount: 1 }])
    page = await invoke<LibraryPage>('files', { folderId: folder.id, directory: 'holiday' })
    assert.equal(page.total, 0)
    assert.deepEqual(page.subfolders, [{ name: 'videos', path: 'holiday/videos', fileCount: 1 }])
    page = await invoke<LibraryPage>('files', { folderId: folder.id, directory: 'holiday/videos' })
    assert.deepEqual(page.files.map((file) => file.name), ['clip.mp4'])
    assert.deepEqual(page.subfolders, [])
    page = await invoke<LibraryPage>('files', { folderId: folder.id, directory: '', search: 'clip' })
    assert.equal(page.total, 1, 'Search inside a folder covers its subfolders')
    page = await invoke<LibraryPage>('files', { folderId: folder.id, directory: '', kind: 'image' })
    assert.deepEqual(page.subfolders, [], 'Subfolders without matching media are hidden')
    await assert.rejects(invoke('files', { folderId: folder.id, directory: '../secret' }))

    const response = await net.fetch(`miniapp-library://media/${image.id}`, { headers: { Range: 'bytes=0-7' } })
    assert.equal(response.status, 206)
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('hex'), '89504e470d0a1a0a')

    ipcMain.handle('module-manager:list', () => manager.list())
    ipcMain.handle('preferences:get-theme', () => null)
    ipcMain.handle('preferences:set-theme', () => undefined)
    const renderer = new BrowserWindow({ show: false, webPreferences: { preload: join(process.cwd(), 'out/preload/index.js'), sandbox: true, contextIsolation: true } })
    await renderer.loadFile(join(process.cwd(), 'out/renderer/index.html'))
    const visible = await renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const link = document.querySelector('a[href="#/library"]')
        if (link || Date.now() > deadline) resolve(Boolean(link))
        else setTimeout(check, 50)
      }
      check()
    })`) as boolean
    assert.equal(visible, true)
    const noApplications = await renderer.webContents.executeJavaScript("document.querySelector('a[href=\"#/apps\"]') === null") as boolean
    assert.equal(noApplications, true)
    const noLibraryModule = await renderer.webContents.executeJavaScript("document.querySelector('a[href=\"#/modules/library\"]') === null") as boolean
    assert.equal(noLibraryModule, true)
    const cleanSidebar = await renderer.webContents.executeJavaScript("document.querySelector('.workspace-picker, .help-card') === null") as boolean
    assert.equal(cleanSidebar, true)
    await renderer.loadURL(`${renderer.webContents.getURL()}#/library`)
    const waitFor = (expression: string) => renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000
      const check = () => {
        const value = (${expression})
        if (value || Date.now() > deadline) resolve(Boolean(value))
        else setTimeout(check, 50)
      }
      check()
    })`) as Promise<boolean>
    assert.equal(await waitFor("document.querySelector('.drive-card')"), true, 'Library cards should render')
    assert.equal(await waitFor("(() => { const image = document.querySelector('.drive-card-thumb img'); return image?.complete && image.naturalWidth })()"), true, 'Indexed image should render in Library')
    const imageLayout = await renderer.webContents.executeJavaScript(`(() => {
      const thumb = document.querySelector('.drive-card-thumb:has(.ant-image-img)')?.getBoundingClientRect()
      const image = document.querySelector('.drive-card-thumb .ant-image-img')?.getBoundingClientRect()
      return thumb && image && image.top >= thumb.top - 1 && image.bottom <= thumb.bottom + 1
    })()`) as boolean
    assert.equal(imageLayout, true, 'Thumbnail must stay inside its card image area')

    await renderer.webContents.executeJavaScript("document.querySelector('.drive-heading-actions [title=\"Justified layout\"]')?.closest('.ant-segmented-item')?.click()")
    assert.equal(await waitFor("document.querySelectorAll('.drive-justified-item').length === 2"), true, 'Justified layout shows every file')
    assert.equal(await waitFor(`(() => {
      const image = document.querySelector('.drive-justified-item:has(img)')?.getBoundingClientRect()
      return image && image.height > 0 && Math.abs(image.width - image.height) <= 2
    })()`), true, 'Justified tiles use the real image aspect ratio (1:1 sample)')
    const justified = await renderer.webContents.executeJavaScript(`(() => {
      const boxes = [...document.querySelectorAll('.drive-justified-item')].map((item) => item.getBoundingClientRect())
      const video = document.querySelector('.drive-justified-item:has(video)')?.getBoundingClientRect()
      return { sameRowHeight: new Set(boxes.map((box) => Math.round(box.height))).size === 1, videoRatio: video ? video.width / video.height : 0 }
    })()`) as { sameRowHeight: boolean; videoRatio: number }
    assert.equal(justified.sameRowHeight, true, 'Tiles in a row share one height')
    assert.ok(Math.abs(justified.videoRatio - 16 / 9) < 0.05, `Unreadable video keeps a 16:9 tile (${justified.videoRatio})`)
    await renderer.webContents.executeJavaScript("document.querySelector('.drive-heading-actions [title=\"Grid layout\"]')?.closest('.ant-segmented-item')?.click()")
    assert.equal(await waitFor("document.querySelector('.drive-card')"), true)

    const contextMenuFor = (selector: string) => renderer.webContents.executeJavaScript(`new Promise((resolve) => {
      const target = document.querySelector(${JSON.stringify(selector)})
      const box = target?.getBoundingClientRect()
      target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (box?.left ?? 0) + 5, clientY: (box?.top ?? 0) + 5 }))
      setTimeout(() => {
        const open = [...document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave) .ant-dropdown-menu-item')].map((item) => item.textContent)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        resolve(open)
      }, 400)
    })`) as Promise<string[]>
    assert.ok((await contextMenuFor('.drive-card:has(.ant-image-img)')).includes('Auto-tag'), 'Right-clicking a photo offers Auto-tag')
    assert.equal((await contextMenuFor('.drive-card:has(video)')).includes('Auto-tag'), false, 'Videos are not offered Auto-tag')
    assert.deepEqual(await contextMenuFor('.drive-tree .drive-tree-title'), ['Auto-tag photos'], 'Right-clicking a folder offers Auto-tag photos')
    await renderer.webContents.executeJavaScript("document.querySelector('.drive-card:has(.ant-image-img)')?.click()")
    assert.equal(await waitFor("document.querySelector('.ant-image-preview .ant-image-preview-img')"), true, 'Clicking an image should open the viewer')
    assert.equal(await waitFor("document.querySelector('.media-info h2')?.textContent === 'sample.png'"), true, 'The viewer shows a details sidebar for the open file')
    const details = await renderer.webContents.executeJavaScript(`(() => {
      const rows = Object.fromEntries([...document.querySelectorAll('.media-info-details > div')].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]))
      const preview = document.querySelector('.ant-image-preview')?.getBoundingClientRect()
      const panel = document.querySelector('.media-info')?.getBoundingClientRect()
      return { rows, room: preview && panel ? Math.round(preview.right) <= Math.round(panel.left) : false, path: document.querySelector('.media-info-path')?.textContent ?? '' }
    })()`) as { rows: Record<string, string>; room: boolean; path: string }
    assert.equal(details.rows.Dimensions, '1 × 1 · 0.0 MP', 'Details include the stored image size')
    assert.equal(details.rows.Type, 'Photo · PNG')
    assert.ok(details.path.endsWith('sample.png'), 'Details show the full file path')
    assert.equal(details.room, true, 'The viewer leaves room for the sidebar instead of hiding under it')
    await renderer.webContents.executeJavaScript("document.querySelector('.media-info-head .ant-btn')?.click()")
    assert.equal(await waitFor("!document.querySelector('.media-info') && !document.body.classList.contains('library-viewer-with-info')"), true, 'The details sidebar can be hidden')
    await renderer.webContents.executeJavaScript("document.querySelector('.library-viewer-actions [aria-label=\"Toggle details\"]')?.click()")
    assert.equal(await waitFor("!!document.querySelector('.media-info')"), true, 'The info button shows the sidebar again')
    await renderer.webContents.executeJavaScript("document.querySelector('.ant-image-preview-close, .ant-image-preview-operations-operation-close')?.click()")
    assert.equal(await waitFor("!document.querySelector('.media-info')"), true, 'Closing the viewer closes the sidebar')

    assert.equal(await renderer.webContents.executeJavaScript("document.querySelector('.library-page .module-header') === null") as boolean, true, 'Library has no page header')
    assert.equal(await renderer.webContents.executeJavaScript("document.querySelector('.drive-sidebar .drive-title')?.textContent") as string, 'Library', 'The Library title sits at the top of the left sidebar')
    assert.deepEqual(await renderer.webContents.executeJavaScript(`(() => {
      const toolbar = document.querySelector('.drive-toolbar')
      return [!!toolbar?.querySelector('.drive-search') && !!toolbar?.querySelector('.drive-filters'), !document.querySelector('.drive-results .drive-search'), toolbar ? getComputedStyle(toolbar).position : '']
    })()`), [true, true, 'sticky'], 'Search, breadcrumb and filters sit above the results panel and stay at the top')
    await renderer.webContents.executeJavaScript("document.querySelector('.drive-nav-caption .ant-btn')?.click()")
    assert.equal(await waitFor("document.querySelector('.library-folders-drawer .library-folders-list li')?.textContent.includes('photos')"), true, 'Folders drawer lists saved folders')
    await renderer.webContents.executeJavaScript("document.querySelector('.library-folders-drawer .ant-drawer-close')?.click()")
    assert.equal(await waitFor("!document.querySelector('.library-folders-drawer.ant-drawer-open')"), true)

    await renderer.webContents.executeJavaScript("document.querySelector('.drive-tree .ant-tree-node-content-wrapper')?.click()")
    assert.equal(await waitFor("document.querySelector('.drive-folder-tile')?.textContent.includes('holiday')"), true, 'Folder view should show subfolders')
    assert.equal(await renderer.webContents.executeJavaScript("document.querySelectorAll('.drive-card').length") as number, 1, 'Folder root should show only its direct files')
    await renderer.webContents.executeJavaScript("document.querySelector('.drive-folder-tile')?.click()")
    assert.equal(await waitFor("document.querySelector('.drive-folder-tile')?.textContent.includes('videos') && document.querySelector('.drive-breadcrumb .current')?.textContent === 'holiday'"), true, 'Opening a subfolder updates the breadcrumb')
    assert.equal(await waitFor("document.querySelector('.drive-tree .ant-tree-treenode-selected')?.textContent.startsWith('holiday')"), true, 'Tree expands to and selects the open subfolder')
    await renderer.webContents.executeJavaScript("[...document.querySelectorAll('.drive-tree .ant-tree-treenode')].find((node) => node.textContent.startsWith('holiday'))?.querySelector('.ant-tree-switcher')?.click()")
    assert.equal(await waitFor("[...document.querySelectorAll('.drive-tree .ant-tree-treenode')].some((node) => node.textContent.startsWith('videos'))"), true, 'Expanding a tree node lazily loads its subfolders')
    await renderer.webContents.executeJavaScript("[...document.querySelectorAll('.drive-tree .ant-tree-treenode')].find((node) => node.textContent.startsWith('videos'))?.querySelector('.ant-tree-node-content-wrapper')?.click()")
    assert.equal(await waitFor("document.querySelector('.drive-breadcrumb .current')?.textContent === 'videos' && document.querySelectorAll('.drive-card').length === 1"), true, 'Selecting a tree node opens that subfolder')

    await renderer.webContents.executeJavaScript("document.querySelectorAll('.drive-breadcrumb button')[1]?.click()")
    assert.equal(await waitFor("document.querySelector('.drive-card .ant-btn')"), true)
    await renderer.webContents.executeJavaScript("document.querySelector('.drive-card .ant-btn')?.click()")
    assert.equal(await waitFor("[...document.querySelectorAll('.ant-dropdown-menu-item')].find((item) => item.textContent === 'Edit tags')"), true, 'File menu should open')
    await renderer.webContents.executeJavaScript("[...document.querySelectorAll('.ant-dropdown-menu-item')].find((item) => item.textContent === 'Edit tags')?.click()")
    assert.equal(await waitFor("document.querySelector('.library-tags-drawer .library-tag-help')"), true, 'Edit tags should open the editing Drawer')
    renderer.destroy()

    await rm(videoPath)
    await invoke('scan', folder.id)
    page = await invoke<LibraryPage>('files')
    assert.equal(page.total, 1)
    assert.deepEqual(page.files[0].tags, ['favorite', 'holiday'])
    const throwaway = join(mediaFolder, 'delete-me.png')
    writeFileSync(throwaway, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lQAAAABJRU5ErkJggg==', 'base64'))
    await invoke('scan', folder.id)
    const disposable = (await invoke<LibraryPage>('files')).files.find((file) => file.name === 'delete-me.png')!
    await invoke('delete', disposable.id)
    assert.equal(existsSync(throwaway), false)
    assert.equal((await invoke<LibraryPage>('files')).total, 1)
    const secondPath = join(userData, 'other-media')
    mkdirSync(secondPath)
    writeFileSync(join(secondPath, 'other.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lQAAAABJRU5ErkJggg==', 'base64'))
    const secondStore = new LibraryStore(settings.path)
    const secondFolder = secondStore.addFolder(secondPath)
    secondStore.close()
    await invoke('scan', secondFolder.id)
    assert.equal((await invoke<LibraryFolder[]>('folders')).length, 2)
    assert.equal((await invoke<LibraryPage>('files', { folderId: secondFolder.id })).total, 1)
    const sizedPath = join(userData, 'sized-media')
    mkdirSync(sizedPath)
    writeFileSync(join(sizedPath, 'wide.png'), nativeImage.createFromBitmap(Buffer.alloc(300 * 200 * 4, 255), { width: 300, height: 200 }).toPNG())
    const ffmpeg = join(process.cwd(), 'resources', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const hasVideo = existsSync(ffmpeg) && spawnSync(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=5', '-pix_fmt', 'yuv420p', join(sizedPath, 'small.mp4')]).status === 0
    const sizedStore = new LibraryStore(settings.path)
    const sizedFolder = sizedStore.addFolder(sizedPath)
    sizedStore.close()
    await invoke('scan', sizedFolder.id)
    const sized = (await invoke<LibraryPage>('files', { folderId: sizedFolder.id })).files
    assert.deepEqual([sized.find((file) => file.name === 'wide.png')?.width, sized.find((file) => file.name === 'wide.png')?.height], [300, 200], 'Image size is stored while scanning')
    if (hasVideo) {
      const deadline = Date.now() + 20000
      let video = sized.find((file) => file.name === 'small.mp4')
      while (!video?.width && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        video = (await invoke<LibraryPage>('files', { folderId: sizedFolder.id })).files.find((file) => file.name === 'small.mp4')
      }
      assert.deepEqual([video?.width, video?.height], [160, 120], 'Video size is read in the background after scanning')
    }
    await invoke('scan', sizedFolder.id)
    assert.equal((await invoke<LibraryPage>('files', { folderId: sizedFolder.id, kind: 'image' })).files[0].width, 300, 'Rescanning keeps stored sizes')
    await invoke('remove-folder', sizedFolder.id)

    await invoke('remove-folder', folder.id)
    assert.equal((await invoke<LibraryFolder[]>('folders')).length, 1)
    assert.equal(existsSync(imagePath), true)
    await invoke('remove-folder', secondFolder.id)
    assert.equal((await invoke<LibraryFolder[]>('folders')).length, 0)
    console.log('Core Library navigation, migration, nested scan, SQLite index, tags, search, preview, Trash deletion, and UI passed')
    passed = true
  } catch (error) { console.error(error) }
  finally {
    window?.destroy()
    stopLibrary()
    settings.close()
    await rm(userData, { recursive: true, force: true })
    app.exit(passed ? 0 : 1)
  }
}).catch((error) => { console.error(error); app.exit(1) })
