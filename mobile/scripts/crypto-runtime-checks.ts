import * as ExpoCrypto from 'expo-crypto'
import { p256 } from '@noble/curves/nist.js'
import {
  decryptMessage,
  deriveConversationKey,
  encryptMessage,
  generateIdentityKeys,
  type EncryptedMessage,
  type PublicKey
} from '../src/lib/crypto'
import { encryptMessage as encryptWithRandom } from '../src/lib/cryptoCore'

export type RuntimeCheckResult = { name: string; passed: boolean }

const CONVERSATION_ID = 'fixture-conversation-fixed'
const FIXTURE_TEXT = 'CipherChat fixed runtime fixture ✓'
const FIXTURE_KEY_HEX = '06b19441c453d948f3b9aabf5ebf7ec41518bafc5e168f81c87c2f56c2616c87'
const FIXTURE_IV = 'AQIDBAUGBwgJCgsM'
const FIXTURE_CIPHERTEXT = 'cuuMSfVpetNaOqbnBB99dxKA7wN86GATcGPpLp8IX6NmUWK8J0btt3KYEutYVR3EtaTo8Q=='

// These public JWK coordinates and private scalars are published test-only values.
// They are never saved or derived from a user's account.
const ALICE_PRIVATE_JWK: JsonWebKey = {
  kty: 'EC', crv: 'P-256',
  x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
  y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
  d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
  ext: true, key_ops: ['deriveBits']
}
const BOB_PRIVATE_JWK: JsonWebKey = {
  kty: 'EC', crv: 'P-256',
  x: 'fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg',
  y: 'B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E',
  d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI',
  ext: true, key_ops: ['deriveBits']
}
const ALICE_PUBLIC_JWK: PublicKey = {
  kty: 'EC', crv: 'P-256', x: ALICE_PRIVATE_JWK.x, y: ALICE_PRIVATE_JWK.y, ext: true
}
const BOB_PUBLIC_JWK: PublicKey = {
  kty: 'EC', crv: 'P-256', x: BOB_PRIVATE_JWK.x, y: BOB_PRIVATE_JWK.y, ext: true
}
const DESKTOP_FIXTURE: EncryptedMessage = {
  version: 1, iv: FIXTURE_IV, ciphertext: FIXTURE_CIPHERTEXT
}

function bytesFromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, i) => byte === right[i])
}

async function expectFailure(operation: () => Promise<unknown>): Promise<void> {
  let rejected = false
  try {
    await operation()
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Expected operation to reject')
}

/** Run fixed public vectors and ephemeral round trips without touching account data. */
export async function runCryptoRuntimeChecks(): Promise<RuntimeCheckResult[]> {
  const results: RuntimeCheckResult[] = []
  const check = async (name: string, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation()
      results.push({ name, passed: true })
    } catch {
      // Keep any error details and key material out of the screen and device logs.
      results.push({ name, passed: false })
    }
  }

  await check('Expo native random-byte provider', async () => {
    const first = await ExpoCrypto.getRandomBytesAsync(32)
    const second = await ExpoCrypto.getRandomBytesAsync(32)
    if (first.length !== 32 || second.length !== 32 || sameBytes(first, second)) {
      throw new Error('Unexpected random-byte result')
    }
    first.fill(0)
    second.fill(0)
  })

  await check('P-256 JWK generation, export and peer import', async () => {
    const alice = await generateIdentityKeys()
    const bob = await generateIdentityKeys()
    const aliceJwk = JSON.parse(alice.privateKey) as JsonWebKey
    const bobJwk = JSON.parse(bob.privateKey) as JsonWebKey
    if (!aliceJwk.d || !bobJwk.d || !alice.publicKey.x || !bob.publicKey.x) {
      throw new Error('Missing P-256 JWK fields')
    }
    const aliceToBob = await deriveConversationKey(alice.privateKey, bob.publicKey, CONVERSATION_ID)
    const bobToAlice = await deriveConversationKey(bob.privateKey, alice.publicKey, CONVERSATION_ID)
    if (!sameBytes(aliceToBob, bobToAlice)) throw new Error('ECDH keys differ')
    aliceToBob.fill(0)
    bobToAlice.fill(0)
  })

  await check('Fixed ECDH and HKDF desktop vector', async () => {
    const aliceScalar = bytesFromHex(`${'00'.repeat(31)}01`)
    const bobPublicPoint = bytesFromHex(
      '047cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978' +
      '07775510db8ed040293d9ac69f7430dbba7dade63ce982299e04b79d227873d1'
    )
    const sharedPoint = p256.getSharedSecret(aliceScalar, bobPublicPoint, false)
    const sharedSecret = sharedPoint.slice(1, 33)
    const sharedSecretMatches = sameBytes(
      sharedSecret,
      bytesFromHex('7cf27b188d034f7e8a52380304b51ac3c08969e277f21b35a60b48fc47669978')
    )
    aliceScalar.fill(0)
    sharedSecret.fill(0)
    sharedPoint.fill(0)
    if (!sharedSecretMatches) throw new Error('Fixed ECDH secret mismatch')

    const aliceKey = await deriveConversationKey(
      JSON.stringify(ALICE_PRIVATE_JWK), BOB_PUBLIC_JWK, CONVERSATION_ID
    )
    const bobKey = await deriveConversationKey(
      JSON.stringify(BOB_PRIVATE_JWK), ALICE_PUBLIC_JWK, CONVERSATION_ID
    )
    const expected = bytesFromHex(FIXTURE_KEY_HEX)
    const matches = sameBytes(aliceKey, expected) && sameBytes(bobKey, expected)
    aliceKey.fill(0)
    bobKey.fill(0)
    expected.fill(0)
    if (!matches) throw new Error('Fixed key derivation vector mismatch')
  })

  await check('Fixed desktop AES-GCM fixture decrypts', async () => {
    const key = bytesFromHex(FIXTURE_KEY_HEX)
    const plaintext = await decryptMessage(DESKTOP_FIXTURE, key, CONVERSATION_ID)
    key.fill(0)
    if (plaintext !== FIXTURE_TEXT) throw new Error('Fixture plaintext mismatch')
  })

  await check('Mobile AES-GCM bytes match fixed desktop fixture', async () => {
    const key = bytesFromHex(FIXTURE_KEY_HEX)
    const fixedIv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const encrypted = await encryptWithRandom(FIXTURE_TEXT, key, CONVERSATION_ID, (length) => {
      if (length !== fixedIv.length) throw new Error('Unexpected IV length requested')
      return new Uint8Array(fixedIv)
    })
    key.fill(0)
    if (encrypted.iv !== FIXTURE_IV || encrypted.ciphertext !== FIXTURE_CIPHERTEXT) {
      throw new Error('AES-GCM output differs from desktop fixture')
    }
  })

  await check('Native IV generation and randomized round trip', async () => {
    const key = bytesFromHex(FIXTURE_KEY_HEX)
    const encrypted = await encryptMessage(FIXTURE_TEXT, key, CONVERSATION_ID)
    const plaintext = await decryptMessage(encrypted, key, CONVERSATION_ID)
    key.fill(0)
    if (encrypted.iv.length !== 16 || plaintext !== FIXTURE_TEXT) {
      throw new Error('Native-IV message round trip failed')
    }
  })

  await check('AAD, wrong keys, tampering and invalid ciphertext reject', async () => {
    const key = bytesFromHex(FIXTURE_KEY_HEX)
    const wrongKey = new Uint8Array(32)
    const alteredCiphertext = (DESKTOP_FIXTURE.ciphertext[0] === 'A' ? 'B' : 'A') +
      DESKTOP_FIXTURE.ciphertext.slice(1)
    await expectFailure(() => decryptMessage(DESKTOP_FIXTURE, key, `${CONVERSATION_ID}-wrong`))
    await expectFailure(() => decryptMessage(DESKTOP_FIXTURE, wrongKey, CONVERSATION_ID))
    await expectFailure(() => decryptMessage(
      { ...DESKTOP_FIXTURE, ciphertext: alteredCiphertext }, key, CONVERSATION_ID
    ))
    await expectFailure(() => decryptMessage(
      { ...DESKTOP_FIXTURE, ciphertext: '***' }, key, CONVERSATION_ID
    ))
    key.fill(0)
    wrongKey.fill(0)
  })

  await check('Conversation ID produces a separate key', async () => {
    const fixedKey = await deriveConversationKey(
      JSON.stringify(ALICE_PRIVATE_JWK), BOB_PUBLIC_JWK, CONVERSATION_ID
    )
    const otherKey = await deriveConversationKey(
      JSON.stringify(ALICE_PRIVATE_JWK), BOB_PUBLIC_JWK, `${CONVERSATION_ID}-other`
    )
    const differs = !sameBytes(fixedKey, otherKey)
    fixedKey.fill(0)
    otherKey.fill(0)
    if (!differs) throw new Error('Conversation IDs did not separate keys')
  })

  return results
}
