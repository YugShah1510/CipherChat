import { gcm } from '@noble/ciphers/aes.js'
import { p256 } from '@noble/curves/nist.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export type PublicKey = JsonWebKey

export type EncryptedMessage = {
  version: 1
  iv: string
  ciphertext: string
}

// Use an explicit encoder so the wire format does not depend on browser-only btoa/atob.
export function encodeBase64(bytes: Uint8Array, alphabet = BASE64): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const hasB = i + 1 < bytes.length
    const hasC = i + 2 < bytes.length
    const b = hasB ? bytes[i + 1] : 0
    const c = hasC ? bytes[i + 2] : 0
    result += alphabet[a >> 2]
    result += alphabet[((a & 3) << 4) | (b >> 4)]
    result += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '='
    result += hasC ? alphabet[c & 63] : '='
  }
  return result
}

export function decodeBase64(value: string, urlSafe = false): Uint8Array {
  const alphabet = urlSafe ? BASE64URL : BASE64
  const normalized = urlSafe
    ? value.replace(/-/g, '+').replace(/_/g, '/')
    : value
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw new Error('Invalid Base64 data')
  }
  const outputLength = (normalized.length / 4) * 3 -
    (normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0)
  const output = new Uint8Array(outputLength)
  let offset = 0
  for (let i = 0; i < normalized.length; i += 4) {
    const a = alphabet.indexOf(normalized[i])
    const b = alphabet.indexOf(normalized[i + 1])
    const c = normalized[i + 2] === '=' ? 0 : alphabet.indexOf(normalized[i + 2])
    const d = normalized[i + 3] === '=' ? 0 : alphabet.indexOf(normalized[i + 3])
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('Invalid Base64 data')
    if (offset < output.length) output[offset++] = (a << 2) | (b >> 4)
    if (offset < output.length) output[offset++] = ((b & 15) << 4) | (c >> 2)
    if (offset < output.length) output[offset++] = ((c & 3) << 6) | d
  }
  return output
}

function toJwkBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes, BASE64URL).replace(/=+$/g, '')
}

function fromJwkBase64(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return decodeBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

function as32Bytes(value: string, field: string): Uint8Array {
  const bytes = fromJwkBase64(value)
  if (bytes.length !== 32) throw new Error(`Invalid P-256 ${field}`)
  return bytes
}

function publicPoint(key: PublicKey): Uint8Array {
  if (key.kty !== 'EC' || key.crv !== 'P-256' || !key.x || !key.y) {
    throw new Error('Invalid P-256 public JWK')
  }
  const point = new Uint8Array(65)
  point[0] = 4
  point.set(as32Bytes(key.x, 'x coordinate'), 1)
  point.set(as32Bytes(key.y, 'y coordinate'), 33)
  if (!p256.utils.isValidPublicKey(point)) throw new Error('Invalid P-256 public point')
  return point
}

/** Validate remote JWK coordinates before comparing them with our local identity. */
export function validatePublicKey(key: PublicKey): PublicKey {
  publicPoint(key)
  if ('d' in key) throw new Error('A public key must not contain private material')
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }
}

export type RandomBytes = (length: number) => Uint8Array | Promise<Uint8Array>

// Generate the same standard P-256 JWK shape that Web Crypto uploads on desktop.
export async function generateIdentityKeys(getRandomBytes: RandomBytes): Promise<{
  publicKey: PublicKey
  privateKey: string
}> {
  const seed = await getRandomBytes(48)
  let privateBytes: Uint8Array
  try {
    privateBytes = p256.utils.randomSecretKey(seed)
  } finally {
    // The random seed is no longer needed once Noble has produced the scalar.
    seed.fill(0)
  }
  try {
    const publicBytes = p256.getPublicKey(privateBytes, false)
    const publicKey: PublicKey = {
      kty: 'EC', crv: 'P-256', x: toJwkBase64(publicBytes.slice(1, 33)),
      y: toJwkBase64(publicBytes.slice(33, 65)), ext: true
    }
    const privateKey = JSON.stringify({
      ...publicKey, d: toJwkBase64(privateBytes), key_ops: ['deriveBits']
    })
    return { publicKey, privateKey }
  } finally {
    // Clear the temporary scalar even if exporting the JWK fails partway through.
    privateBytes.fill(0)
  }
}

/**
 * Recompute the public JWK from private material before trusting a key pair.
 * This catches damaged storage and ensures the public coordinates match the private scalar.
 */
export function derivePublicKeyFromPrivate(privateKeyJson: string): PublicKey {
  let privateJwk: JsonWebKey
  try {
    privateJwk = JSON.parse(privateKeyJson) as JsonWebKey
  } catch {
    throw new Error('The private identity is not valid JSON.')
  }
  if (
    privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' ||
    typeof privateJwk.d !== 'string' || !privateJwk.x || !privateJwk.y || privateJwk.ext !== true ||
    !Array.isArray(privateJwk.key_ops) || privateJwk.key_ops.length !== 1 ||
    privateJwk.key_ops[0] !== 'deriveBits' ||
    Object.keys(privateJwk).sort().join(',') !== 'crv,d,ext,key_ops,kty,x,y'
  ) {
    throw new Error('The private identity is not a supported P-256 JWK.')
  }

  const privateBytes = as32Bytes(privateJwk.d, 'private scalar')
  try {
    if (!p256.utils.isValidSecretKey(privateBytes)) {
      throw new Error('The private identity contains an invalid P-256 scalar.')
    }
    const point = p256.getPublicKey(privateBytes, false)
    const x = toJwkBase64(point.slice(1, 33))
    const y = toJwkBase64(point.slice(33, 65))
    if (privateJwk.x !== x || privateJwk.y !== y) {
      throw new Error('The private JWK public coordinates do not match its private scalar.')
    }

    // Desktop Web Crypto exports public P-256 JWKs with an empty key_ops array.
    return { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: [] }
  } finally {
    // Clear the decoded scalar after checking its matching public point.
    privateBytes.fill(0)
  }
}

/** Check that a generated public JWK is exactly the public half of its private JWK. */
export function verifyIdentityKeyPair(privateKeyJson: string, publicKey: PublicKey): boolean {
  const derived = derivePublicKeyFromPrivate(privateKeyJson)
  return derived.kty === publicKey.kty && derived.crv === publicKey.crv &&
    derived.x === publicKey.x && derived.y === publicKey.y
}

// Match Web Crypto deriveBits(256): use the shared point's 32-byte x coordinate.
export async function deriveConversationKey(
  privateKeyJson: string,
  otherPublicKey: PublicKey,
  conversationId: string
): Promise<Uint8Array> {
  if (!conversationId) throw new Error('Conversation ID is required')
  const privateJwk = JSON.parse(privateKeyJson) as JsonWebKey
  if (
    privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' ||
    !privateJwk.d || !privateJwk.x || !privateJwk.y
  ) {
    throw new Error('Invalid P-256 private JWK')
  }
  const privateBytes = as32Bytes(privateJwk.d, 'private scalar')
  let sharedSecret: Uint8Array | undefined
  let sharedPoint: Uint8Array | undefined
  try {
    if (!p256.utils.isValidSecretKey(privateBytes)) throw new Error('Invalid P-256 private scalar')
    const expectedPublicPoint = publicPoint(privateJwk)
    const actualPublicPoint = p256.getPublicKey(privateBytes, false)
    if (actualPublicPoint.some((byte, index) => byte !== expectedPublicPoint[index])) {
      throw new Error('P-256 private and public JWK values do not match')
    }
    sharedPoint = p256.getSharedSecret(privateBytes, publicPoint(otherPublicKey), false)
    sharedSecret = sharedPoint.slice(1, 33)
    return hkdf(
      sha256,
      sharedSecret,
      encoder.encode(conversationId),
      encoder.encode('CipherChat E2EE v1'),
      32
    )
  } finally {
    // Best-effort cleanup also runs on invalid peer keys and derivation failures.
    privateBytes.fill(0)
    sharedSecret?.fill(0)
    sharedPoint?.fill(0)
  }
}

// AES-GCM returns ciphertext followed by the same 16-byte tag as Web Crypto.
export async function encryptMessage(
  plaintext: string,
  key: Uint8Array,
  conversationId: string,
  getRandomBytes: RandomBytes
): Promise<EncryptedMessage> {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes')
  const iv = await getRandomBytes(12)
  if (iv.length !== 12) throw new Error('AES-GCM IV must be 12 bytes')
  const ciphertext = gcm(key, iv, encoder.encode(conversationId)).encrypt(encoder.encode(plaintext))
  return { version: 1, iv: encodeBase64(iv), ciphertext: encodeBase64(ciphertext) }
}

export async function decryptMessage(
  encrypted: EncryptedMessage,
  key: Uint8Array,
  conversationId: string
): Promise<string> {
  if (encrypted.version !== 1) throw new Error('Unsupported encrypted message version')
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes')
  const iv = decodeBase64(encrypted.iv)
  const ciphertext = decodeBase64(encrypted.ciphertext)
  if (iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid AES-GCM message')
  return decoder.decode(gcm(key, iv, encoder.encode(conversationId)).decrypt(ciphertext))
}
