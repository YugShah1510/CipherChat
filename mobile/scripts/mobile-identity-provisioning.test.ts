import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateIdentityKeys } from '../src/lib/cryptoCore'
import {
  cancelMobileIdentityProvisioning,
  provisionMobileIdentity,
  type MobileIdentity
} from '../src/lib/mobileIdentityProvisioning'
import { createIdentityStorage } from '../src/lib/secure-storage/identityStorageCore'

const userId = '11111111-2222-4333-8444-555555555555'

function setup(seedOffset = 0) {
  const entries = new Map<string, string>()
  let registered: unknown | null = null
  let registrationAttempts = 0
  let generationAttempts = 0
  let failNextRegistration = false
  const storage = createIdentityStorage({
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => { entries.set(key, value) },
    delete: async (key) => { entries.delete(key) }
  })
  const deps = {
    loadIdentity: storage.loadIdentity,
    saveIdentity: storage.saveIdentity,
    fetchRegisteredPublicKey: async () => registered,
    registerPublicKey: async (key: unknown) => {
      registrationAttempts += 1
      if (failNextRegistration) {
        failNextRegistration = false
        throw new Error('network unavailable')
      }
      if (registered && JSON.stringify(registered) !== JSON.stringify(key)) {
        throw new Error('different key already registered')
      }
      registered = key
      return key
    },
    generateIdentity: async () => {
      generationAttempts += 1
      return generateIdentityKeys((length) =>
        Uint8Array.from({ length }, (_, index) => (index * 17 + 29 + seedOffset) & 0xff)
      )
    }
  }
  return {
    deps,
    entries,
    storage,
    get registered() { return registered },
    set registered(value: unknown | null) { registered = value },
    get registrationAttempts() { return registrationAttempts },
    get generationAttempts() { return generationAttempts },
    failRegistrationOnce() { failNextRegistration = true }
  }
}

function identityIn(store: ReturnType<typeof setup>, accountId = userId): MobileIdentity {
  const serialized = store.entries.get(`cipherchat.mobile.identity.v1.${accountId}`)
  assert.ok(serialized)
  return JSON.parse(serialized) as MobileIdentity
}

test('first-time setup saves a Mobile identity and registers only its public key', async () => {
  const store = setup()
  await provisionMobileIdentity(userId, store.deps)
  assert.equal(store.entries.size, 1)
  const localKey = identityIn(store).publicKey
  assert.equal((store.registered as typeof localKey).x, localKey.x)
  assert.equal((store.registered as typeof localKey).y, localKey.y)
})

test('repeated provisioning verifies the existing key without generating or registering again', async () => {
  const store = setup()
  await provisionMobileIdentity(userId, store.deps)
  const saved = store.entries.get(`cipherchat.mobile.identity.v1.${userId}`)
  const attempts = store.registrationAttempts
  store.deps.generateIdentity = async () => { throw new Error('must not generate a replacement') }
  await provisionMobileIdentity(userId, store.deps)
  assert.equal(store.entries.get(`cipherchat.mobile.identity.v1.${userId}`), saved)
  assert.equal(store.registrationAttempts, attempts)
})

test('registered public key without local private identity requires recovery', async () => {
  const store = setup()
  store.registered = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) }
  await assert.rejects(provisionMobileIdentity(userId, store.deps), /private key is not on this phone/)
  assert.equal(store.entries.size, 0)
})

test('mismatched local and registered public keys stop without replacing either', async () => {
  const store = setup()
  await provisionMobileIdentity(userId, store.deps)
  const saved = store.entries.get(`cipherchat.mobile.identity.v1.${userId}`)
  store.registered = (await generateIdentityKeys((length) => new Uint8Array(length).fill(11))).publicKey
  await assert.rejects(provisionMobileIdentity(userId, store.deps), /does not match the registered key/)
  assert.equal(store.entries.get(`cipherchat.mobile.identity.v1.${userId}`), saved)
})

test('invalid generated key-pair validation prevents storage and registration', async () => {
  const store = setup()
  const good = await generateIdentityKeys((length) => new Uint8Array(length).fill(7))
  const other = await generateIdentityKeys((length) => new Uint8Array(length).fill(11))
  store.deps.generateIdentity = async () => ({ ...good, publicKey: other.publicKey })
  await assert.rejects(provisionMobileIdentity(userId, store.deps), /could not be generated and verified/)
  assert.equal(store.entries.size, 0)
  assert.equal(store.registrationAttempts, 0)
})

test('network failure leaves the same local key and retry registers that key', async () => {
  const store = setup()
  store.failRegistrationOnce()
  await assert.rejects(provisionMobileIdentity(userId, store.deps), /saved securely on this phone/)
  const saved = store.entries.get(`cipherchat.mobile.identity.v1.${userId}`)
  assert.ok(saved)
  await provisionMobileIdentity(userId, store.deps)
  assert.equal(store.entries.get(`cipherchat.mobile.identity.v1.${userId}`), saved)
  assert.deepEqual(store.registered, identityIn(store).publicKey)
  assert.equal(store.registrationAttempts, 2)
})

test('logout and login again preserve and re-verify the same Mobile identity', async () => {
  const store = setup()
  await provisionMobileIdentity(userId, store.deps)
  const saved = store.entries.get(`cipherchat.mobile.identity.v1.${userId}`)
  // Sign-out does not call deleteIdentity; this is the same startup check run after signing in again.
  await provisionMobileIdentity(userId, store.deps)
  assert.equal(store.entries.get(`cipherchat.mobile.identity.v1.${userId}`), saved)
})

test('simultaneous calls for one user share one provisioning promise and one key creation', async () => {
  const store = setup()
  let releaseGeneration: ((identity: MobileIdentity) => void) | undefined
  let generationStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => { generationStarted = resolve })
  store.deps.generateIdentity = () => new Promise((resolve) => { releaseGeneration = resolve })
  const originalGenerate = store.deps.generateIdentity
  store.deps.generateIdentity = () => {
    generationStarted?.()
    return originalGenerate()
  }
  const first = provisionMobileIdentity(userId, store.deps)
  const second = provisionMobileIdentity(userId, store.deps)
  assert.strictEqual(first, second)
  await started
  assert.equal(store.generationAttempts, 0)
  const generated = await generateIdentityKeys((length) => new Uint8Array(length).fill(13))
  releaseGeneration?.(generated)
  await Promise.all([first, second])
  assert.equal(store.registrationAttempts, 1)
  assert.equal(store.entries.size, 1)
})

test('concurrent calls for different accounts do not share identity or result', async () => {
  const firstStore = setup(0)
  const secondStore = setup(31)
  const otherUserId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const first = provisionMobileIdentity(userId, firstStore.deps)
  const second = provisionMobileIdentity(otherUserId, secondStore.deps)
  assert.notStrictEqual(first, second)
  await Promise.all([first, second])
  assert.ok(firstStore.entries.has(`cipherchat.mobile.identity.v1.${userId}`))
  assert.ok(secondStore.entries.has(`cipherchat.mobile.identity.v1.${otherUserId}`))
  assert.notDeepEqual(identityIn(firstStore).publicKey, identityIn(secondStore, otherUserId).publicKey)
})

test('creation race cannot make a duplicate caller fail while the first caller saves', async () => {
  const store = setup()
  let saveCalls = 0
  const save = store.deps.saveIdentity
  store.deps.saveIdentity = async (...args) => {
    saveCalls += 1
    if (saveCalls > 1) throw new Error('create-only storage would reject a duplicate write')
    await save(...args)
  }
  const first = provisionMobileIdentity(userId, store.deps)
  const second = provisionMobileIdentity(userId, store.deps)
  assert.strictEqual(first, second)
  await Promise.all([first, second])
  assert.equal(saveCalls, 1)
  assert.equal(store.generationAttempts, 1)
})

test('cancelled startup work clears its lock and a later login can retry', async () => {
  const store = setup()
  let releaseGeneration: ((identity: MobileIdentity) => void) | undefined
  let generationStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => { generationStarted = resolve })
  store.deps.generateIdentity = () => new Promise((resolve) => {
    generationStarted?.()
    releaseGeneration = resolve
  })
  const first = provisionMobileIdentity(userId, store.deps)
  await started
  cancelMobileIdentityProvisioning(userId)
  releaseGeneration?.(await generateIdentityKeys((length) => new Uint8Array(length).fill(17)))
  await assert.rejects(first, /verification was interrupted/)
  store.deps.generateIdentity = async () => generateIdentityKeys((length) => new Uint8Array(length).fill(19))
  await provisionMobileIdentity(userId, store.deps)
  assert.equal(store.registrationAttempts, 1)
})
