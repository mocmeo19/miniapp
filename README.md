# Miniapp Studio

Electron desktop starter using TypeScript, Vite, React, Tailwind CSS, React Router DOM, and Ant Design. The sample workspace uses a ToolJet-inspired dashboard style with a shared light/dark theme.

## Run locally

```bash
npm install
npm run setup:media
npm run dev
```

## Build and preview

```bash
npm run build
npm run preview
```

`npm run build` type-checks and creates the Electron output in `out/`. It does not package an installer.

The app icon uses the four-tile Miniapp mark. Desktop icons are in `resources/`, and the renderer favicon is in `src/renderer/public/`. To regenerate them, run `python3 scripts/generate-icon.py` with Pillow installed.

The React renderer uses `HashRouter` so navigation also works when Electron loads the built app from a local file. Electron APIs can be added through the isolated preload bridge in `src/preload/index.ts`.

## Superapp module architecture

The main process owns native capabilities and long-running work. The renderer owns navigation and UI. Preload exposes a small namespaced IPC bridge; renderer modules never receive Node.js or Electron APIs directly.

```text
App main ── loadModule(mainModule) ──> IPC handlers ──> native work
                                             ↑
                                      preload bridge
                                             ↑
App UI ─── loadModule(rendererModule) ──> sidebar + route
```

Built-in modules have their own folder under `src/modules/`. YouTube Downloader and Web Browser are registered and enabled on a fresh install. Disabling either in Module Manager persists across restarts. Library is a core application feature at `#/library`, outside the module lifecycle.

- `src/modules/youtube/main.ts`: validates requests, runs yt-dlp, sends progress events.
- `src/modules/youtube/renderer.tsx`: page, form, format selection, progress display.
- `src/modules/youtube/types.ts`: data contract shared by both processes.
- `src/modules/webview/main.ts`: embedded browser views and persistent profile sessions.
- `src/modules/webview/renderer.tsx`: address bar, navigation, and profile controls.

To add a built-in module, create a `MainModule` and a `RendererModule` with the same unique `id`. Register the main module with `ModuleManager.registerBuiltIn(...)` in `src/main/index.ts` and the renderer module with `loadModule(...)` in `src/renderer/src/main.tsx`. The shell adds its sidebar link and route at `#/modules/<id>` when enabled. Register main handlers with `api.handle('action', handler)` and call them from the UI through `window.desktop.modules.invoke(id, 'action', payload)`. Use `api.emit(...)` and `window.desktop.modules.on(...)` for events. `api.settings.get/set` persists module settings in SQLite under its own namespace. Built-in modules are included at build time.

## Marketplace and installed modules

Marketplace installs modules from a direct HTTPS package URL, a local `.miniapp` or `.zip` file, or a JSON catalog URL configured on the Marketplace page. Installed modules are disabled until they are enabled in Module Manager. Enable/disable state, theme, module settings, and the catalog URL are stored in SQLite at `<Electron userData>/miniapp/config.sqlite`. Deleting an installed module removes its package files and settings. Built-in modules can be disabled but not deleted.

An installable module is a ZIP archive with these files at its root:

```text
manifest.json
index.html
main.cjs       # optional; omit for UI-only modules
```

`manifest.json` contains `id`, `name`, `version`, `description`, `ui`, and optional `main` file paths. See [`examples/hello-module`](examples/hello-module) for a complete package. The UI is a self-contained HTML page loaded in a sandboxed iframe. It calls its module's main handlers with `window.miniapp.invoke('action', payload)` and subscribes to events with `window.miniapp.on('event', callback)`. Relative asset files are not loaded by the iframe, so bundle scripts and CSS into the HTML file. The optional `main.cjs` exports `activate(api)` and can return a cleanup function called when the module is disabled. It may register handlers and use its namespaced SQLite settings. Validate every handler input.

To package the example on macOS/Linux, run this inside `examples/hello-module`:

```bash
zip -j ../hello-module.miniapp manifest.json index.html main.cjs
```

A catalog is a JSON array of entries with `id`, `name`, `version`, `description`, and direct HTTPS `downloadUrl` to a module ZIP. The app does not ship with a default online catalog; enter your catalog URL on the Marketplace page. Packages can contain main process code with desktop permissions, so only enable modules you trust.

## YouTube Downloader

`npm run setup:media` downloads the official yt-dlp standalone binary into ignored `resources/bin/`, verifies its SHA-256 checksum, and copies the platform-specific ffmpeg binary supplied by `ffmpeg-static` into the same folder. The module also accepts both tools on your `PATH`. It supports a single video or Short, shows the formats reported by yt-dlp, downloads the selected video or original audio format, lets you choose a destination folder, and supports cancellation. Playlists are disabled.

Without ffmpeg, combined video formats and original audio formats remain available. Recent yt-dlp versions use an external JavaScript runtime for YouTube; the module enables Node.js when it is available. The default download folder is configurable on the Settings page and saved in SQLite. For an installer, include `resources/bin/` as an extra resource and provide Node.js or another supported JavaScript runtime if your target machines do not have one.

## Web Browser

Open **Web Browser** in the sidebar to browse HTTP or HTTPS pages, search from the address bar, and use back, forward, reload, stop, and home controls. Create and switch profiles in the toolbar. Each profile uses its own persistent Electron session, so cookies and site storage stay separate. Profile names, the selected profile, and last visited addresses are stored in SQLite. Deleting a profile clears its browsing data; the last profile cannot be deleted. The browser page uses a sandboxed `WebContentsView` with no Node.js integration or preload.

## Library

Open **Library** under Workspace in the sidebar and choose one or more local folders. Library is always available and does not appear in Module Manager. Its service lives in `src/main/library/`, its page in `src/renderer/src/pages/Library.tsx`, and its preload API is `window.desktop.library`. Library recursively indexes images (`jpg`, `jpeg`, `png`, `gif`, `webp`, `bmp`, `avif`) and videos (`mp4`, `m4v`, `mov`, `webm`, `mkv`, `avi`) from those folders, including nested folders. Folder paths, file metadata, and tags live in the existing SQLite database. Existing Library data is retained when upgrading from the earlier module version. Symlinks are skipped during indexing. Use **Rescan** after changing files outside the app; missing files are removed from the index when the scan completes without unreadable items.

Search names, relative paths, and tags; filter by folder, media type, or tag; preview media; and open a file in its default system app. Playback depends on the codecs supported by Electron, so use **Open in default app** for formats that do not play in the preview. **Move to Trash** removes the selected file from disk and the index after confirmation. Removing a folder from Library removes only its index records and leaves its files on disk.
