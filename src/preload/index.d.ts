
import { ElectronAPI } from '@electron-toolkit/preload'

interface CipherChatAPI {
  secureStorage: {
    save: (userId: string, keyMaterial: string) => Promise<boolean>
    load: (userId: string) => Promise<string | null>
    delete: (userId: string) => Promise<boolean>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CipherChatAPI
  }
}
