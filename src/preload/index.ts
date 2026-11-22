
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  auth: {
    onDeepLink: (callback: (url: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, url: string): void =>
        callback(url)
      ipcRenderer.on('auth:deep-link', listener)
      return () => ipcRenderer.removeListener('auth:deep-link', listener)
    },
    getPendingDeepLinks: (): Promise<string[]> =>
      ipcRenderer.invoke('auth:get-pending-deep-links')
  },
  secureStorage: {
    save: (userId: string, keyMaterial: string): Promise<boolean> =>
      ipcRenderer.invoke('secure-storage:save', userId, keyMaterial),

    load: (userId: string): Promise<string | null> =>
      ipcRenderer.invoke('secure-storage:load', userId),

    delete: (userId: string): Promise<boolean> =>
      ipcRenderer.invoke('secure-storage:delete', userId)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
