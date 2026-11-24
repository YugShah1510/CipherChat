// Mobile identities have their own namespace and can never reuse a Desktop key.
const identityKeyPrefix = 'cipherchat.mobile.identity.v1.'

export type IdentityStorageDriver = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
}

function storageKeyFor(userId: string): string {
  // Supabase account IDs are UUIDs; validate before using them as secure-store keys.
  if (!/^[a-f0-9-]{36}$/i.test(userId)) {
    throw new Error('A valid account ID is required for secure identity storage.')
  }
  return `${identityKeyPrefix}${userId}`
}

/** Build the storage operations around SecureStore so their safety rules can be tested. */
export function createIdentityStorage(driver: IdentityStorageDriver) {
  const writesInProgress = new Set<string>()

  async function loadIdentity(userId: string): Promise<string | null> {
    return driver.get(storageKeyFor(userId))
  }

  async function hasIdentity(userId: string): Promise<boolean> {
    return (await loadIdentity(userId)) !== null
  }

  async function saveIdentity(userId: string, identity: string): Promise<void> {
    if (!identity) throw new Error('Identity material cannot be empty.')
    const key = storageKeyFor(userId)
    if (writesInProgress.has(key)) {
      throw new Error('An identity write is already in progress for this account.')
    }

    writesInProgress.add(key)
    try {
      // SecureStore set operations replace values, so check first and refuse any overwrite.
      const existing = await driver.get(key)
      if (existing !== null) {
        throw new Error('An identity already exists for this account; it cannot be overwritten.')
      }

      await driver.set(key, identity)

      // Read it back before reporting success; on failure, leave the value untouched for review.
      const saved = await driver.get(key)
      if (saved !== identity) {
        throw new Error('The saved identity could not be verified and was left untouched.')
      }
    } finally {
      writesInProgress.delete(key)
    }
  }

  async function deleteIdentity(userId: string): Promise<void> {
    await driver.delete(storageKeyFor(userId))
  }

  return { loadIdentity, hasIdentity, saveIdentity, deleteIdentity }
}
