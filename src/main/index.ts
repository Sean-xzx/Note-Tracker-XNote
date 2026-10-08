import { app, shell, BrowserWindow, protocol, nativeImage } from 'electron'
import { join, extname, isAbsolute } from 'path'
import { readFile } from 'fs/promises'
import { getDb, closeDb } from './db'
import { registerIpcHandlers } from './ipc'
import { getNote, organizeImageAssets } from './notes'
import { runFsrsReplayIfPending } from './review'
import { storedFilePath, guessMime } from './fileStore'

// Register the custom scheme used to stream library files (images) into the
// renderer without base64 or file:// (which the CSP blocks). Must run before
// the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'xnote-local',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'xnote-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// Windows groups taskbar buttons / pins by AppUserModelID. Use the same id as
// electron-builder's appId (and the shortcuts) so every launch path shares one
// identity and one icon. Must be set before the app is ready.
if (process.platform === 'win32') app.setAppUserModelId('com.xnote.app')

// Window / taskbar / Alt+Tab icon. Single source: assets/brand/xnote.ico
// (shipped next to the app as resources/xnote.ico via extraResources).
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'xnote.ico')
  : join(__dirname, '../../assets/brand/xnote.ico')
const appIcon = nativeImage.createFromPath(iconPath)

// The brand splash plays only on a cold start: the first window of this
// process is opened with #splash; later windows (and reloads) skip it.
let coldStart = true

function createWindow(): void {
  const splash = coldStart
  coldStart = false
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#faf7f2', // warm off-white so there's no white flash
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // the splash draw starts now that it is actually visible
    if (splash) mainWindow.webContents.executeJavaScript('window.__xnoteSplashPlay && window.__xnoteSplashPlay()').catch(() => {})
  })

  // Open external links in the OS browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In dev, electron-vite serves the renderer over HTTP with HMR.
  // In production, load the built HTML file.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL + (splash ? '#splash' : ''))
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), splash ? { hash: 'splash' } : undefined)
  }
}

app.whenReady().then(() => {
  getDb() // open + migrate the database before the UI can call it
  organizeImageAssets() // collect existing inline pictures without changing their URLs
  const fsrsReport = runFsrsReplayIfPending() // one-time: review history → FSRS state
  if (fsrsReport) console.log('[fsrs] migrated', JSON.stringify({ items: fsrsReport.items, replayed: fsrsReport.replayed, asNew: fsrsReport.asNew, bigShifts: fsrsReport.bigShifts.length }))

  // Serve library file bytes at xnote-file://<id> (used for <img> sources).
  protocol.handle('xnote-file', async (request) => {
    const id = decodeURIComponent(new URL(request.url).hostname)
    const note = getNote(id)
    if (!note || note.kind !== 'file' || !note.stored_name) {
      return new Response('Not found', { status: 404 })
    }
    try {
      const buf = await readFile(storedFilePath(note.stored_name))
      return new Response(buf, {
        headers: { 'content-type': note.mime_type ?? 'application/octet-stream' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  // Local images referenced by absolute path from markdown notes:
  // xnote-local://img/<encodeURIComponent(absolute path)>. Image files only.
  protocol.handle('xnote-local', async (request) => {
    const p = decodeURIComponent(new URL(request.url).pathname.slice(1))
    const mime = guessMime(extname(p))
    if (!isAbsolute(p) || !mime?.startsWith('image/')) return new Response('Not found', { status: 404 })
    try {
      return new Response(await readFile(p), { headers: { 'content-type': mime } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  registerIpcHandlers() // expose notes CRUD over IPC
  createWindow()

  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked and none are open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Quit on all platforms except macOS, where apps stay alive in the dock.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  closeDb() // flush WAL + release the file handle cleanly
})
