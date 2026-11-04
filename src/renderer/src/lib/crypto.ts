
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type PublicKey = JsonWebKey

export type EncryptedMessage = {
  version: 1
  iv: string
  ciphertext: string
}

// Convert ArrayBuffer to Base64.
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}

// Convert Base64 to Uint8Array backed by ArrayBuffer.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

// Generate an ECDH P-256 identity key pair.
export async function generateIdentityKeys(): Promise<{
  publicKey: PublicKey
  privateKey: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveBits']
  )

  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

  return {
    publicKey,
    privateKey: JSON.stringify(privateKey)
  }
}

// Derive a shared AES-256-GCM key.
export async function deriveConversationKey(
  privateKeyJson: string,
  otherPublicKey: PublicKey,
  conversationId: string
): Promise<CryptoKey> {
  if (!conversationId) {
    throw new Error('Conversation ID is required')
  }

  const privateJwk = JSON.parse(privateKeyJson) as JsonWebKey

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    ['deriveBits']
  )

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    otherPublicKey,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  )

  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey
    },
    privateKey,
    256
  )

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveKey']
  )

  new Uint8Array(sharedSecret).fill(0)

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(conversationId),
      info: encoder.encode('CipherChat E2EE v1')
    },
    hkdfKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt plaintext before sending it to Supabase.
export async function encryptMessage(
  plaintext: string,
  key: CryptoKey,
  conversationId: string
): Promise<EncryptedMessage> {
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(conversationId),
      tagLength: 128
    },
    key,
    encoder.encode(plaintext)
  )

  return {
    version: 1,
    iv: toBase64(iv.buffer),
    ciphertext: toBase64(encrypted)
  }
}

// Decrypt an encrypted message.
export async function decryptMessage(
  encrypted: EncryptedMessage,
  key: CryptoKey,
  conversationId: string
): Promise<string> {
  if (encrypted.version !== 1) {
    throw new Error('Unsupported encrypted message version')
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(encrypted.iv),
      additionalData: encoder.encode(conversationId),
      tagLength: 128
    },
    key,
    fromBase64(encrypted.ciphertext)
  )

  return decoder.decode(decrypted)
}
