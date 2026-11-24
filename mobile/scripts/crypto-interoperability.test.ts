import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { gcm } from '@noble/ciphers/aes.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { EncryptedMessage } from '../src/lib/cryptoCore'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const crypto = webcrypto as unknown as Crypto
type CryptoModule = typeof import('../src/lib/cryptoCore')

function base64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64')
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function fromHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'hex'))
}

async function desktopKey(privateJwkJson: string, otherPublicJwk: JsonWebKey, id: string) {
  const privateJwk = JSON.parse(privateJwkJson) as JsonWebKey
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, {
    name: 'ECDH', namedCurve: 'P-256'
  }, false, ['deriveBits'])
  const publicKey = await crypto.subtle.importKey('jwk', otherPublicJwk, {
    name: 'ECDH', namedCurve: 'P-256'
  }, false, [])
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const hkdfKey = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(id),
    info: encoder.encode('CipherChat E2EE v1')
  }, hkdfKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

async function desktopEncrypt(plaintext: string, key: CryptoKey, id: string): Promise<EncryptedMessage> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: iv.buffer as ArrayBuffer,
    additionalData: encoder.encode(id), tagLength: 128
  }, key, encoder.encode(plaintext))
  return { version: 1, iv: base64(iv.buffer), ciphertext: base64(ciphertext) }
}

async function run(): Promise<void> {
  // RFC 5869 SHA-256 test case 1 provides a fixed answer independent of random fixtures.
  const hkdfVector = hkdf(
    sha256,
    new Uint8Array(22).fill(0x0b),
    fromHex('000102030405060708090a0b0c'),
    fromHex('f0f1f2f3f4f5f6f7f8f9'),
    42
  )
  assert.equal(Buffer.from(hkdfVector).toString('hex'),
    '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865')
  // NIST AES-256-GCM empty-plaintext vector: output is the 16-byte tag only.
  const gcmVector = gcm(new Uint8Array(32), new Uint8Array(12)).encrypt(new Uint8Array())
  assert.equal(Buffer.from(gcmVector).toString('hex'), '530f8afbc74536b9a963b4f1c4cb738b')

  const { decryptMessage, deriveConversationKey, encryptMessage, generateIdentityKeys } =
    await import('../src/lib/cryptoCore') as CryptoModule
  const randomBytes = (length: number) => webcrypto.getRandomValues(new Uint8Array(length))
  const alice = await generateIdentityKeys(randomBytes)
  const bob = await generateIdentityKeys(randomBytes)
  const conversationId = 'fixture-conversation-42'
  const mobileKey = await deriveConversationKey(alice.privateKey, bob.publicKey, conversationId)
  const desktopDerivedKey = await desktopKey(alice.privateKey, bob.publicKey, conversationId)
  const desktopRawKey = new Uint8Array(await crypto.subtle.exportKey('raw', desktopDerivedKey))
  assert.deepEqual(mobileKey, desktopRawKey, 'HKDF output must match Web Crypto exactly')

  // Desktop Web Crypto fixture encrypted with a desktop-compatible JWK and format.
  const desktopFixture = await desktopEncrypt('desktop → mobile ✓', desktopDerivedKey, conversationId)
  assert.equal(await decryptMessage(desktopFixture, mobileKey, conversationId), 'desktop → mobile ✓')

  // Mobile-produced bytes must open with the same Web Crypto AES-GCM settings.
  const mobileFixture = await encryptMessage('mobile → desktop ✓', mobileKey, conversationId, randomBytes)
  const opened = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: fromBase64(mobileFixture.iv).buffer as ArrayBuffer,
    additionalData: encoder.encode(conversationId).buffer as ArrayBuffer, tagLength: 128
  }, desktopDerivedKey, fromBase64(mobileFixture.ciphertext).buffer as ArrayBuffer)
  assert.equal(decoder.decode(opened), 'mobile → desktop ✓')
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(mobileFixture))), [
    'version', 'iv', 'ciphertext'
  ])
  assert.equal(fromBase64(mobileFixture.ciphertext).length, encoder.encode('mobile → desktop ✓').length + 16)

  // The peer's private key and sender's public key derive the same conversation key.
  const bobKey = await deriveConversationKey(bob.privateKey, alice.publicKey, conversationId)
  assert.deepEqual(bobKey, mobileKey)
  assert.notDeepEqual(
    await deriveConversationKey(alice.privateKey, bob.publicKey, `${conversationId}-other`),
    mobileKey,
    'a different conversation ID must derive a different key'
  )

  await assert.rejects(decryptMessage(mobileFixture, mobileKey, `${conversationId}-other`),
    'wrong AAD must fail authentication')
  const corrupted = { ...mobileFixture, ciphertext: base64(Uint8Array.from(
    fromBase64(mobileFixture.ciphertext), (byte, index) => index === 0 ? byte ^ 1 : byte
  ).buffer) }
  await assert.rejects(decryptMessage(corrupted, mobileKey, conversationId),
    'tampered ciphertext must fail authentication')
  await assert.rejects(decryptMessage({ ...mobileFixture, ciphertext: '***' }, mobileKey, conversationId),
    'invalid Base64 must be rejected')
  await assert.rejects(decryptMessage({ ...mobileFixture, ciphertext: 'AAAA' }, mobileKey, conversationId),
    'ciphertext shorter than the GCM tag must be rejected')
  await assert.rejects(decryptMessage({ ...mobileFixture, version: 2 } as never, mobileKey, conversationId),
    'unsupported versions must be rejected')

  // Fixed public scalars make this ECDH/HKDF/AES fixture reproducible on devices.
  const fixedAlicePrivate = JSON.stringify({
    kty: 'EC', crv: 'P-256',
    x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
    y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
    d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
    ext: true, key_ops: ['deriveBits']
  } satisfies JsonWebKey)
  const fixedBobPublic: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: 'fPJ7GI0DT36KUjgDBLUaw8CJaeJ38hs1pgtI_EdmmXg',
    y: 'B3dVENuO0EApPZrGn3Qw27p9reY86YIpngS3nSJ4c9E', ext: true
  }
  const fixedConversation = 'fixture-conversation-fixed'
  const fixedKey = await deriveConversationKey(fixedAlicePrivate, fixedBobPublic, fixedConversation)
  assert.equal(Buffer.from(fixedKey).toString('hex'),
    '06b19441c453d948f3b9aabf5ebf7ec41518bafc5e168f81c87c2f56c2616c87')
  const fixedFixture: EncryptedMessage = {
    version: 1,
    iv: 'AQIDBAUGBwgJCgsM',
    ciphertext: 'cuuMSfVpetNaOqbnBB99dxKA7wN86GATcGPpLp8IX6NmUWK8J0btt3KYEutYVR3EtaTo8Q=='
  }
  assert.equal(await decryptMessage(fixedFixture, fixedKey, fixedConversation),
    'CipherChat fixed runtime fixture ✓')
  const reproduced = await encryptMessage(
    'CipherChat fixed runtime fixture ✓', fixedKey, fixedConversation,
    () => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  )
  assert.deepEqual(reproduced, fixedFixture,
    'mobile output with the fixed IV must match the desktop Web Crypto fixture')

  console.log('Crypto interoperability checks passed: JWK, ECDH/HKDF, AES-GCM both directions, AAD and malformed input.')
}

run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
