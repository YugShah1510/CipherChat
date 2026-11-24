import * as ExpoCrypto from 'expo-crypto'
import {
  decryptMessage,
  deriveConversationKey,
  derivePublicKeyFromPrivate,
  encryptMessage as encryptWithRandom,
  generateIdentityKeys as generateWithRandom,
  validatePublicKey,
  verifyIdentityKeyPair
} from './cryptoCore'
import type { EncryptedMessage, PublicKey } from './cryptoCore'

export type { EncryptedMessage, PublicKey } from './cryptoCore'

// Keep platform randomness at this boundary; Expo maps it to the OS CSPRNG.
export function generateIdentityKeys(): Promise<{
  publicKey: PublicKey
  privateKey: string
}> {
  return generateWithRandom((length) => ExpoCrypto.getRandomBytesAsync(length))
}

export {
  deriveConversationKey, decryptMessage, derivePublicKeyFromPrivate,
  validatePublicKey, verifyIdentityKeyPair
}

export function encryptMessage(
  plaintext: string,
  key: Uint8Array,
  conversationId: string
): Promise<EncryptedMessage> {
  return encryptWithRandom(
    plaintext,
    key,
    conversationId,
    (length) => ExpoCrypto.getRandomBytesAsync(length)
  )
}
