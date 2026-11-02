
import { app, shell, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

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
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
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
