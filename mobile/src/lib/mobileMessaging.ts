import {
  decryptMessage,
  deriveConversationKey,
  encryptMessage,
  validatePublicKey,
  verifyIdentityKeyPair
} from './crypto'
import { loadIdentity } from './secure-storage/identityStorage'
import { supabase, supabaseConfigurationMessage } from './supabase'
import {
  createMobileMessagingService,
  type MobileConversationRecord,
  type MobileLatestMessage,
  type MobileMemberRecord,
  type MobileMessagingRepository,
  type MobileProfileRecord,
  type MobileStoredMessage,
  type MobileUserResult
} from './mobileMessagingCore'

function getClient() {
  if (!supabase) throw new Error(supabaseConfigurationMessage)
  return supabase
}

/** Every database operation in this adapter targets Mobile tables or the Mobile RPCs. */
const repository: MobileMessagingRepository = {
  async listMemberships(userId): Promise<MobileMemberRecord[]> {
    const { data, error } = await getClient()
      .from('mobile_conversation_members')
      .select('conversation_id, user_id')
      .eq('user_id', userId)
    if (error) throw error
    return (data ?? []) as MobileMemberRecord[]
  },

  async getConversations(ids): Promise<MobileConversationRecord[]> {
    if (ids.length === 0) return []
    const { data, error } = await getClient()
      .from('mobile_conversations')
      .select('id, type, created_at')
      .in('id', ids)
    if (error) throw error
    return (data ?? []) as MobileConversationRecord[]
  },

  async getMembers(conversationIds): Promise<MobileMemberRecord[]> {
    if (conversationIds.length === 0) return []
    const { data, error } = await getClient()
      .from('mobile_conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', conversationIds)
    if (error) throw error
    return (data ?? []) as MobileMemberRecord[]
  },

  async getProfiles(userIds): Promise<MobileProfileRecord[]> {
    if (userIds.length === 0) return []
    const { data, error } = await getClient()
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)
    if (error) throw error
    return (data ?? []) as MobileProfileRecord[]
  },

  async getLatestMessages(conversationIds): Promise<MobileLatestMessage[]> {
    if (conversationIds.length === 0) return []
    // Fetch only one metadata row per conversation; ciphertext never appears in list previews.
    return Promise.all(conversationIds.map(async (conversationId) => {
      const { data, error } = await getClient()
        .from('mobile_messages')
        .select('conversation_id, sender_id, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as MobileLatestMessage | null
    })).then((rows) => rows.filter((row): row is MobileLatestMessage => row !== null))
  },

  async searchUsers(query, limit): Promise<MobileUserResult[]> {
    const { data, error } = await getClient().rpc('search_mobile_users', {
      p_query: query,
      p_limit: limit
    })
    if (error) throw error
    return (data ?? []) as MobileUserResult[]
  },

  async createDirectConversation(otherUserId): Promise<string> {
    const { data, error } = await getClient().rpc('create_mobile_direct_conversation', {
      p_other_user_id: otherUserId
    })
    if (error) throw error
    if (typeof data !== 'string' || !data) {
      throw new Error('The Mobile conversation service returned an invalid conversation ID.')
    }
    return data
  },

  async getConversation(conversationId): Promise<MobileConversationRecord | null> {
    const { data, error } = await getClient()
      .from('mobile_conversations')
      .select('id, type, created_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (error) throw error
    return data as MobileConversationRecord | null
  },

  async getConversationMembers(conversationId): Promise<MobileMemberRecord[]> {
    const { data, error } = await getClient()
      .from('mobile_conversation_members')
      .select('conversation_id, user_id')
      .eq('conversation_id', conversationId)
    if (error) throw error
    return (data ?? []) as MobileMemberRecord[]
  },

  async getPublicKey(userId): Promise<unknown | null> {
    const { data, error } = await getClient()
      .from('mobile_user_public_keys')
      .select('public_key')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return data?.public_key ?? null
  },

  async getMessages(conversationId): Promise<MobileStoredMessage[]> {
    const rows: MobileStoredMessage[] = []
    const pageSize = 500
    // Supabase applies a row cap to each request, so read older history in stable pages.
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await getClient()
        .from('mobile_messages')
        .select('id, conversation_id, sender_id, created_at, ciphertext')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (error) throw error
      const page = (data ?? []) as MobileStoredMessage[]
      rows.push(...page)
      if (page.length < pageSize) return rows
    }
  },

  async insertMessage(input): Promise<void> {
    const { error } = await getClient().from('mobile_messages').insert(input)
    if (error) throw error
  }
}

const service = createMobileMessagingService({
  repository,
  loadIdentity,
  validatePublicKey,
  verifyIdentityKeyPair,
  deriveConversationKey,
  encryptMessage,
  decryptMessage
})

export const searchMobileUsers = service.searchUsers
export const createMobileDirectConversation = service.createDirectConversation
export const listMobileConversations = service.listConversations
export const loadMobileConversationPreview = service.loadConversationPreview
export const loadMobileMessages = service.loadMessages
export const sendMobileMessage = service.sendMessage
