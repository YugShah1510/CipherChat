import * as SecureStore from 'expo-secure-store'
import { createIdentityStorage } from './identityStorageCore'

const keychainService = 'CipherChatIdentity'

// Keep the private identity in the OS secure store, separate from auth/session storage.
const identityStorage = createIdentityStorage({
  get: (key) => SecureStore.getItemAsync(key, { keychainService }),
  set: (key, value) => SecureStore.setItemAsync(key, value, {
    keychainService,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK
  }),
  delete: (key) => SecureStore.deleteItemAsync(key, { keychainService })
})

/** Read this account's private identity material from Keychain / Android Keystore. */
export const loadIdentity = identityStorage.loadIdentity

/** Check for an existing key without returning private key material to the screen. */
export const hasIdentity = identityStorage.hasIdentity

/** Save only when no key exists, then verify the secure-store readback. */
export const saveIdentity = identityStorage.saveIdentity

/** Remove this account's identity when a future account-management flow needs it. */
export const deleteIdentity = identityStorage.deleteIdentity
