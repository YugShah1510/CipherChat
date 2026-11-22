
import { app, shell, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const protocolScheme = 'cipherchat'
let mainWindow: BrowserWindow | null = null
const pendingAuthLinks: string[] = []

function queueAuthLink(value: string): void {
  if (!value.startsWith(`${protocolScheme}://`)) return

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('auth:deep-link', value)
  } else {
    pendingAuthLinks.push(value)
  }
}

const initialDeepLink = process.argv.find((arg) => arg.startsWith(`${protocolScheme}://`))
if (initialDeepLink) pendingAuthLinks.push(initialDeepLink)

app.on('open-url', (event, url) => {
  event.preventDefault()
  queueAuthLink(url)
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else {
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find((arg) => arg.startsWith(`${protocolScheme}://`))
    if (deepLink) queueAuthLink(deepLink)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

ipcMain.handle('auth:get-pending-deep-links', () => pendingAuthLinks.splice(0))

function getKeyFilePath(userId: string): string {
  if (!userId || !/^[a-zA-Z0-9-]+$/.test(userId)) {
    throw new Error('Invalid user ID')
  }

  return join(app.getPath('userData'), 'keys', `${userId}.key`)
}

ipcMain.handle('secure-storage:save', async (_, userId: string, keyMaterial: string) => {
  if (typeof keyMaterial !== 'string' || !keyMaterial) {
    throw new Error('Invalid key material')
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable')
  }

  const filePath = getKeyFilePath(userId)
  await mkdir(join(app.getPath('userData'), 'keys'), { recursive: true })

  const encrypted = safeStorage.encryptString(keyMaterial)
  await writeFile(filePath, encrypted, { mode: 0o600 })

  return true
})

ipcMain.handle('secure-storage:load', async (_, userId: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable')
  }

  try {
    const encrypted = await readFile(getKeyFilePath(userId))
    return safeStorage.decryptString(encrypted)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
})

ipcMain.handle('secure-storage:delete', async (_, userId: string) => {
  try {
    await unlink(getKeyFilePath(userId))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return true
    throw error
  }
})

function createWindow(): void {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(protocolScheme, process.execPath, [process.argv[1]])
  } else {
    app.setAsDefaultProtocolClient(protocolScheme)
  }

  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
