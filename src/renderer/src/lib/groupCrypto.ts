
import { deriveConversationKey } from './crypto'
import type { PublicKey } from './crypto'

const encoder = new TextEncoder()

export type GroupKeyEnvelope = {
  version: 1
  iv: string
  ciphertext: string
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }

  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

// Generate the shared AES-256 group key.
export async function generateGroupKey(): Promise<{
  key: CryptoKey
  rawKey: string
}> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )

  const raw = await crypto.subtle.exportKey('raw', key)

  return {
    key: await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    ),
    rawKey: toBase64(raw)
  }
}

// Encrypt the group key for one member.
export async function wrapGroupKey(
  rawGroupKey: string,
  creatorPrivateKey: string,
  memberPublicKey: PublicKey,
  conversationId: string
): Promise<GroupKeyEnvelope> {
  const pairKey = await deriveConversationKey(
    creatorPrivateKey,
    memberPublicKey,
    conversationId
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(
        `CipherChat group key:${conversationId}`
      )
    },
    pairKey,
    fromBase64(rawGroupKey)
  )

  return {
    version: 1,
    iv: toBase64(iv.buffer),
    ciphertext: toBase64(encrypted)
  }
}

// Decrypt the group key received by the current member.
export async function unwrapGroupKey(
  envelope: GroupKeyEnvelope,
  memberPrivateKey: string,
  creatorPublicKey: PublicKey,
  conversationId: string
): Promise<CryptoKey> {
  if (envelope.version !== 1) {
    throw new Error('Unsupported group key version')
  }

  const pairKey = await deriveConversationKey(
    memberPrivateKey,
    creatorPublicKey,
    conversationId
  )

  const rawGroupKey = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encoder.encode(
        `CipherChat group key:${conversationId}`
      )
    },
    pairKey,
    fromBase64(envelope.ciphertext)
  )

  return crypto.subtle.importKey(
    'raw',
    rawGroupKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt a selected file before uploading it.
export async function encryptMedia(
  file: File,
  groupKey: CryptoKey,
  conversationId: string
): Promise<{
  ciphertext: ArrayBuffer
  iv: string
  originalName: string
  mimeType: string
}> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(
        `CipherChat media:${conversationId}`
      )
    },
    groupKey,
    await file.arrayBuffer()
  )

  return {
    ciphertext,
    iv: toBase64(iv.buffer),
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream'
  }
}

// Decrypt downloaded media on the recipient's device.
export async function decryptMedia(
  ciphertext: ArrayBuffer,
  iv: string,
  groupKey: CryptoKey,
  conversationId: string
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(iv),
      additionalData: encoder.encode(
        `CipherChat media:${conversationId}`
      )
    },
    groupKey,
    ciphertext
  )
}
