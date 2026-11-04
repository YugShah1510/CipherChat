import { supabase } from './supabase'
import { generateIdentityKeys, type PublicKey } from './crypto'

type StoredIdentity = {
  privateKey: string
  publicKey: PublicKey
}

export async function ensureUserIdentity(userId: string): Promise<void> {
  if (!userId) {
    throw new Error('User ID is required to initialize encryption')
  }

  // Load the existing identity from encrypted local storage.
  const storedValue = await window.api.secureStorage.load(userId)

  let identity: StoredIdentity

  if (storedValue) {
    try {
      identity = JSON.parse(storedValue) as StoredIdentity

      if (
        !identity.privateKey ||
        !identity.publicKey?.x ||
        !identity.publicKey?.y
      ) {
        throw new Error('Invalid stored identity')
      }
    } catch {
      throw new Error(
        'Stored encryption identity is invalid. It cannot be safely replaced automatically.'
      )
    }
  } else {
    // Check whether this account already has an identity on another device.
    const { data: existingKey, error: lookupError } = await supabase
      .from('user_public_keys')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (lookupError) {
      throw new Error(
        `Unable to check existing public key: ${lookupError.message}`
      )
    }

    if (existingKey) {
      throw new Error(
        'An encryption identity already exists for this account, but its private key is not available on this device.'
      )
    }

    // Generate a new identity.
    const generated = await generateIdentityKeys()

    identity = {
      privateKey: generated.privateKey,
      publicKey: generated.publicKey
    }

    // Store the private key locally using Electron safeStorage.
    await window.api.secureStorage.save(
      userId,
      JSON.stringify(identity)
    )
  }

  // Upload only the public key to Supabase.
  const { error: uploadError } = await supabase
    .from('user_public_keys')
    .upsert(
      {
        user_id: userId,
        public_key: JSON.stringify(identity.publicKey),
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'user_id'
      }
    )

  if (uploadError) {
    throw new Error(
      `Unable to register public key: ${uploadError.message}`
    )
  }
}
