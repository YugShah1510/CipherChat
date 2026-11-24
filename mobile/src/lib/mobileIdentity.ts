import { generateIdentityKeys } from './crypto'
import { loadIdentity, saveIdentity } from './secure-storage/identityStorage'
import { supabase, supabaseConfigurationMessage } from './supabase'
import {
  cancelMobileIdentityProvisioning,
  provisionMobileIdentity
} from './mobileIdentityProvisioning'

export { cancelMobileIdentityProvisioning }

/** Connect provisioning to only the Mobile identity registry and SecureStore namespace. */
export async function ensureMobileIdentity(userId: string): Promise<void> {
  if (!supabase) throw new Error(supabaseConfigurationMessage)

  await provisionMobileIdentity(userId, {
    loadIdentity,
    saveIdentity,
    generateIdentity: generateIdentityKeys,
    fetchRegisteredPublicKey: async (accountId) => {
      const { data, error } = await supabase!
        .from('mobile_user_public_keys')
        .select('public_key')
        .eq('user_id', accountId)
        .maybeSingle()
      if (error) throw error
      return data?.public_key ?? null
    },
    registerPublicKey: async (publicKey) => {
      const { data, error } = await supabase!.rpc('register_mobile_public_key', {
        p_public_key: publicKey
      })
      if (error) throw error
      return data
    }
  })
}
