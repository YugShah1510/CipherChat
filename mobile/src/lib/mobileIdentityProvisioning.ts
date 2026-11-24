import {
  derivePublicKeyFromPrivate,
  validatePublicKey,
  verifyIdentityKeyPair,
  type PublicKey
} from './cryptoCore'

export type MobileIdentity = { publicKey: PublicKey; privateKey: string }

export type ProvisioningDependencies = {
  loadIdentity: (userId: string) => Promise<string | null>
  saveIdentity: (userId: string, serialized: string) => Promise<void>
  fetchRegisteredPublicKey: (userId: string) => Promise<unknown | null>
  registerPublicKey: (publicKey: PublicKey) => Promise<unknown>
  generateIdentity: () => Promise<MobileIdentity>
}

export class MobileIdentityProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MobileIdentityProvisioningError'
  }
}

type InFlightProvision = { promise: Promise<void>; cancelled: boolean }
const inFlightByUser = new Map<string, InFlightProvision>()

function ensureActive(isActive: () => boolean): void {
  if (!isActive()) {
    throw new MobileIdentityProvisioningError('Mobile identity verification was interrupted. Retry to continue.')
  }
}

function samePublicKey(left: PublicKey, right: PublicKey): boolean {
  const a = validatePublicKey(left)
  const b = validatePublicKey(right)
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y
}

function readStoredIdentity(serialized: string): MobileIdentity {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new MobileIdentityProvisioningError(
      'The saved Mobile identity is damaged. It was not changed; account recovery is required.'
    )
  }
  if (!value || typeof value !== 'object' || !('privateKey' in value) || !('publicKey' in value)) {
    throw new MobileIdentityProvisioningError(
      'The saved Mobile identity is invalid. It was not changed; account recovery is required.'
    )
  }
  const identity = value as MobileIdentity
  if (typeof identity.privateKey !== 'string' || !identity.publicKey || typeof identity.publicKey !== 'object') {
    throw new MobileIdentityProvisioningError(
      'The saved Mobile identity is invalid. It was not changed; account recovery is required.'
    )
  }
  try {
    if (!verifyIdentityKeyPair(identity.privateKey, identity.publicKey)) throw new Error('Pair mismatch')
    return { ...identity, publicKey: validatePublicKey(identity.publicKey) }
  } catch {
    throw new MobileIdentityProvisioningError(
      'The saved Mobile public and private keys do not match. The identity was not changed.'
    )
  }
}

async function verifyOrRegister(
  userId: string,
  localPublicKey: PublicKey,
  dependencies: ProvisioningDependencies,
  isActive: () => boolean
): Promise<void> {
  ensureActive(isActive)
  let registered: unknown | null
  try {
    registered = await dependencies.fetchRegisteredPublicKey(userId)
  } catch {
    throw new MobileIdentityProvisioningError(
      'Could not check the Mobile identity registry. Check your connection and retry.'
    )
  }
  ensureActive(isActive)

  if (registered !== null) {
    let registeredKey: PublicKey
    try {
      registeredKey = validatePublicKey(registered as PublicKey)
    } catch {
      throw new MobileIdentityProvisioningError(
        'The registered Mobile public key is invalid. Contact support; neither key was changed.'
      )
    }
    if (!samePublicKey(localPublicKey, registeredKey)) {
      throw new MobileIdentityProvisioningError(
        'This phone’s Mobile identity does not match the registered key. Neither key was changed; recovery is required.'
      )
    }
    return
  }

  // Save happens before the network call, so a failed request can retry with this same key.
  ensureActive(isActive)
  let result: unknown
  try {
    result = await dependencies.registerPublicKey(localPublicKey)
  } catch {
    throw new MobileIdentityProvisioningError(
      'The Mobile identity is saved securely on this phone, but registration did not complete. Check your connection and retry.'
    )
  }
  try {
    if (!samePublicKey(localPublicKey, result as PublicKey)) throw new Error('RPC returned another key')
  } catch {
    throw new MobileIdentityProvisioningError(
      'The registry returned a different Mobile public key. The local identity was preserved; recovery is required.'
    )
  }
}

/** Create once, then verify the same identity against Supabase on every signed-in startup. */
async function provisionMobileIdentityOnce(
  userId: string,
  dependencies: ProvisioningDependencies,
  isActive: () => boolean
): Promise<void> {
  ensureActive(isActive)
  let serialized: string | null
  try {
    serialized = await dependencies.loadIdentity(userId)
  } catch {
    throw new MobileIdentityProvisioningError('Could not read the Mobile identity from secure storage.')
  }
  ensureActive(isActive)

  if (serialized !== null) {
    const identity = readStoredIdentity(serialized)
    await verifyOrRegister(userId, identity.publicKey, dependencies, isActive)
    return
  }

  let registered: unknown | null
  try {
    registered = await dependencies.fetchRegisteredPublicKey(userId)
  } catch {
    throw new MobileIdentityProvisioningError(
      'Could not check whether this account already has a Mobile identity. Check your connection and retry.'
    )
  }
  ensureActive(isActive)
  if (registered !== null) {
    throw new MobileIdentityProvisioningError(
      'This account already has a registered Mobile identity, but its private key is not on this phone. Stop here; account recovery is required.'
    )
  }

  let identity: MobileIdentity
  try {
    identity = await dependencies.generateIdentity()
  } catch {
    throw new MobileIdentityProvisioningError(
      'A valid Mobile identity could not be generated and verified. No identity was registered.'
    )
  }
  ensureActive(isActive)
  try {
    if (!verifyIdentityKeyPair(identity.privateKey, identity.publicKey)) throw new Error('Pair mismatch')
    identity.publicKey = validatePublicKey(identity.publicKey)
  } catch {
    throw new MobileIdentityProvisioningError(
      'A valid Mobile identity could not be generated and verified. No identity was registered.'
    )
  }

  const serializedIdentity = JSON.stringify(identity)
  try {
    await dependencies.saveIdentity(userId, serializedIdentity)
  } catch {
    throw new MobileIdentityProvisioningError(
      'The Mobile identity could not be saved securely. No public key was registered.'
    )
  }

  ensureActive(isActive)
  await verifyOrRegister(userId, derivePublicKeyFromPrivate(identity.privateKey), dependencies, isActive)
}

/** Calls for one account share one promise; different account IDs remain independent. */
export function provisionMobileIdentity(
  userId: string,
  dependencies: ProvisioningDependencies
): Promise<void> {
  const existing = inFlightByUser.get(userId)
  if (existing) return existing.promise

  const entry: InFlightProvision = { promise: Promise.resolve(), cancelled: false }
  // Defer the work until after the map entry exists so even immediate repeat calls deduplicate.
  entry.promise = Promise.resolve().then(() =>
    provisionMobileIdentityOnce(userId, dependencies, () => !entry.cancelled)
  )
  inFlightByUser.set(userId, entry)

  const clearEntry = (): void => {
    if (inFlightByUser.get(userId) === entry) inFlightByUser.delete(userId)
  }
  void entry.promise.then(clearEntry, clearEntry)
  return entry.promise
}

/** Stop this caller's pending work when its authenticated session ends or changes. */
export function cancelMobileIdentityProvisioning(userId: string): void {
  const entry = inFlightByUser.get(userId)
  if (!entry) return
  entry.cancelled = true
  inFlightByUser.delete(userId)
}
