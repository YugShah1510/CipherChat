
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
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
