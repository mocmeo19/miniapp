import { StyleProvider } from '@ant-design/cssinjs'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './theme/ThemeProvider'
import './styles.css'
import { loadModule } from '../../modules/core/renderer'
import { youtubeRendererModule } from '../../modules/youtube/renderer'
import { webviewRendererModule } from '../../modules/webview/renderer'
import { mp3PlayerRendererModule } from '../../modules/mp3player/renderer'
import { videoPlayerRendererModule } from '../../modules/videoplayer/renderer'
import { subtitlesRendererModule } from '../../modules/subtitles/renderer'
import { mobileFarmRendererModule } from '../../modules/mobilefarm/renderer'
import { notesRendererModule } from '../../modules/notes/renderer'
import { expensesRendererModule } from '../../modules/expenses/renderer'
import { MirrorWall } from '../../modules/mobilefarm/wall'
import type { InstalledModule } from '../../modules/core/types'

loadModule(youtubeRendererModule)
loadModule(webviewRendererModule)
loadModule(mp3PlayerRendererModule)
loadModule(videoPlayerRendererModule)
loadModule(subtitlesRendererModule)
loadModule(mobileFarmRendererModule)
loadModule(notesRendererModule)
loadModule(expensesRendererModule)

async function start(): Promise<void> {
  // The mirror wall is its own window: no app shell, just the device grid.
  if (window.location.hash.startsWith('#/mobilefarm-wall')) {
    ReactDOM.createRoot(document.getElementById('root')!).render(<StyleProvider layer><MirrorWall /></StyleProvider>)
    return
  }
  const installed: InstalledModule[] = window.desktop
    ? await window.desktop.moduleManager.list()
    : [youtubeRendererModule, webviewRendererModule, mp3PlayerRendererModule, videoPlayerRendererModule, subtitlesRendererModule, mobileFarmRendererModule, notesRendererModule, expensesRendererModule].map((module) => ({ id: module.id, name: module.label, version: '1.0.0', description: '', source: 'built-in', enabled: true }))
  // Read before the first paint so the sidebar opens in its saved state without flickering.
  const collapsed = await window.desktop?.preferences.getSidebarCollapsed?.().catch(() => undefined)

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <StyleProvider layer>
        <HashRouter>
          <ThemeProvider>
            <App initialInstalled={installed} initialCollapsed={collapsed} />
          </ThemeProvider>
        </HashRouter>
      </StyleProvider>
    </React.StrictMode>
  )
}

void start().catch((error: unknown) => {
  const root = document.getElementById('root')!
  root.textContent = `Could not load modules: ${error instanceof Error ? error.message : String(error)}`
})
