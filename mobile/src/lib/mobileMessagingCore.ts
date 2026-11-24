import type { EncryptedMessage, PublicKey } from './cryptoCore'

export type MobileConversationRecord = { id: string; type: string; created_at: string }
export type MobileMemberRecord = { conversation_id: string; user_id: string }
export type MobileProfileRecord = { id: string; full_name: string | null }
export type MobileLatestMessage = { conversation_id: string; sender_id: string; created_at: string }
export type MobileStoredMessage = {
  id: string
  conversation_id: string
  sender_id: string
  created_at: string
  ciphertext: string
}
export type MobileUserResult = { user_id: string; full_name: string }
export type DecryptedMobileMessage = {
  id: string
  sender_id: string
  created_at: string
  text: string | null
  decryptionFailed: boolean
}
export type MobileConversationListItem = {
  id: string
  name: string
  created_at: string
  activity_at: string
  preview: string
}

/** The service accepts a small repository interface so security behavior can be tested offline. */
export type MobileMessagingRepository = {
  listMemberships: (userId: string) => Promise<MobileMemberRecord[]>
  getConversations: (ids: string[]) => Promise<MobileConversationRecord[]>
  getMembers: (conversationIds: string[]) => Promise<MobileMemberRecord[]>
  getProfiles: (userIds: string[]) => Promise<MobileProfileRecord[]>
  getLatestMessages: (conversationIds: string[]) => Promise<MobileLatestMessage[]>
  searchUsers: (query: string, limit: number) => Promise<MobileUserResult[]>
  createDirectConversation: (otherUserId: string) => Promise<string>
  getConversation: (conversationId: string) => Promise<MobileConversationRecord | null>
  getConversationMembers: (conversationId: string) => Promise<MobileMemberRecord[]>
  getPublicKey: (userId: string) => Promise<unknown | null>
  getMessages: (conversationId: string) => Promise<MobileStoredMessage[]>
  insertMessage: (input: {
    conversation_id: string
    sender_id: string
    ciphertext: string
  }) => Promise<void>
}

export type MobileMessagingDependencies = {
  repository: MobileMessagingRepository
  loadIdentity: (userId: string) => Promise<string | null>
  validatePublicKey: (key: PublicKey) => PublicKey
  verifyIdentityKeyPair: (privateKey: string, publicKey: PublicKey) => boolean
  deriveConversationKey: (
    privateKey: string,
    otherPublicKey: PublicKey,
    conversationId: string
  ) => Promise<Uint8Array>
  encryptMessage: (text: string, key: Uint8Array, conversationId: string) => Promise<EncryptedMessage>
  decryptMessage: (
    envelope: EncryptedMessage,
    key: Uint8Array,
    conversationId: string
  ) => Promise<string>
}

type StoredIdentity = { privateKey: string; publicKey: PublicKey }

function readIdentity(serialized: string | null): StoredIdentity {
  if (!serialized) throw new Error('This phone has no saved Mobile identity. Sign in again or contact support.')
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('The saved Mobile identity is unreadable. No key was changed.')
  }
  if (!value || typeof value !== 'object' || !('privateKey' in value) || !('publicKey' in value)) {
    throw new Error('The saved Mobile identity is invalid. No key was changed.')
  }
  const identity = value as StoredIdentity
  if (typeof identity.privateKey !== 'string' || !identity.publicKey || typeof identity.publicKey !== 'object') {
    throw new Error('The saved Mobile identity is invalid. No key was changed.')
  }
  return identity
}

function publicKeysMatch(left: PublicKey, right: PublicKey): boolean {
  return left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y
}

async function getVerifiedIdentity(
  userId: string,
  dependencies: MobileMessagingDependencies
): Promise<StoredIdentity> {
  const identity = readIdentity(await dependencies.loadIdentity(userId))
  const localPublicKey = dependencies.validatePublicKey(identity.publicKey)
  if (!dependencies.verifyIdentityKeyPair(identity.privateKey, localPublicKey)) {
    throw new Error('The saved Mobile public and private keys do not match. Messaging is disabled.')
  }
  const registeredValue = await dependencies.repository.getPublicKey(userId)
  if (!registeredValue) throw new Error('This account has no registered Mobile public key.')
  const registeredKey = dependencies.validatePublicKey(registeredValue as PublicKey)
  if (!publicKeysMatch(localPublicKey, registeredKey)) {
    throw new Error('The saved identity does not match the registered Mobile key. Messaging is disabled.')
  }
  return { ...identity, publicKey: localPublicKey }
}

function requireDirectPair(
  conversation: MobileConversationRecord | null,
  members: MobileMemberRecord[],
  conversationId: string,
  userId: string
): string {
  if (!conversation || conversation.id !== conversationId) throw new Error('This conversation could not be found.')
  if (conversation.type !== 'direct') throw new Error('Only direct Mobile conversations are supported.')
  const participantIds = members
    .filter((member) => member.conversation_id === conversationId)
    .map((member) => member.user_id)
  if (!participantIds.includes(userId)) throw new Error('You are not a member of this conversation.')
  const uniqueParticipantIds = [...new Set(participantIds)]
  if (uniqueParticipantIds.length !== 2) throw new Error('This direct conversation has an invalid membership list.')
  const otherUserId = uniqueParticipantIds.find((memberId) => memberId !== userId)
  if (!otherUserId) throw new Error('The other Mobile participant could not be found.')
  return otherUserId
}

/** Build listing, discovery, and encrypted message operations around Mobile-only tables. */
export function createMobileMessagingService(dependencies: MobileMessagingDependencies) {
  const { repository } = dependencies

  async function listConversations(userId: string): Promise<MobileConversationListItem[]> {
    const ownMemberships = await repository.listMemberships(userId)
    const ids = [...new Set(ownMemberships.map((member) => member.conversation_id))]
    if (ids.length === 0) return []

    const [conversations, members, latestRows] = await Promise.all([
      repository.getConversations(ids),
      repository.getMembers(ids),
      repository.getLatestMessages(ids)
    ])
    const directConversations = conversations.filter((conversation) => conversation.type === 'direct')
    const directIds = new Set(directConversations.map((conversation) => conversation.id))
    const peerIds = [...new Set(members
      .filter((member) => directIds.has(member.conversation_id) && member.user_id !== userId)
      .map((member) => member.user_id))]
    const profiles = peerIds.length > 0 ? await repository.getProfiles(peerIds) : []
    const names = new Map(profiles.map((profile) => [profile.id, profile.full_name || 'CipherChat User']))
    const latest = new Map<string, MobileLatestMessage>()
    for (const message of latestRows) {
      const current = latest.get(message.conversation_id)
      if (!current || Date.parse(message.created_at) > Date.parse(current.created_at)) {
        latest.set(message.conversation_id, message)
      }
    }

    return directConversations
      .filter((conversation) => members.filter((row) => row.conversation_id === conversation.id).length === 2)
      .map((conversation) => {
        const peerId = members.find((member) =>
          member.conversation_id === conversation.id && member.user_id !== userId
        )?.user_id
        const lastMessage = latest.get(conversation.id)
        return {
          id: conversation.id,
          name: names.get(peerId ?? '') ?? 'CipherChat User',
          created_at: conversation.created_at,
          activity_at: lastMessage?.created_at ?? conversation.created_at,
          // Do not put ciphertext or undecrypted content into a list preview.
          preview: lastMessage
            ? lastMessage.sender_id === userId ? 'You: Encrypted message' : 'Encrypted message'
            : 'No messages yet'
        }
      })
      .sort((left, right) => Date.parse(right.activity_at) - Date.parse(left.activity_at))
  }

  async function loadConversationPreview(
    userId: string,
    conversationId: string
  ): Promise<MobileConversationListItem | null> {
    const [conversation, members] = await Promise.all([
      repository.getConversation(conversationId),
      repository.getConversationMembers(conversationId)
    ])
    if (!conversation) return null
    const peerId = requireDirectPair(conversation, members, conversationId, userId)
    const [latestRows, profiles] = await Promise.all([
      repository.getLatestMessages([conversationId]),
      repository.getProfiles([peerId])
    ])
    const lastMessage = latestRows[0]
    return {
      id: conversation.id,
      name: profiles[0]?.full_name?.trim() || 'CipherChat User',
      created_at: conversation.created_at,
      activity_at: lastMessage?.created_at ?? conversation.created_at,
      preview: lastMessage
        ? lastMessage.sender_id === userId ? 'You: Encrypted message' : 'Encrypted message'
        : 'No messages yet'
    }
  }

  async function loadMessages(userId: string, conversationId: string): Promise<{
    conversationName: string
    messages: DecryptedMobileMessage[]
  }> {
    const [conversation, members] = await Promise.all([
      repository.getConversation(conversationId),
      repository.getConversationMembers(conversationId)
    ])
    const peerId = requireDirectPair(conversation, members, conversationId, userId)
    const identity = await getVerifiedIdentity(userId, dependencies)
    const [peerKeyValue, profiles, rows] = await Promise.all([
      repository.getPublicKey(peerId),
      repository.getProfiles([peerId]),
      repository.getMessages(conversationId)
    ])
    if (!peerKeyValue) throw new Error('The other participant has no registered Mobile public key.')
    const peerKey = dependencies.validatePublicKey(peerKeyValue as PublicKey)
    const key = await dependencies.deriveConversationKey(identity.privateKey, peerKey, conversationId)
    try {
      const messages = await Promise.all(rows.map(async (row): Promise<DecryptedMobileMessage> => {
        try {
          const envelope = JSON.parse(row.ciphertext) as EncryptedMessage
          const text = await dependencies.decryptMessage(envelope, key, conversationId)
          return { id: row.id, sender_id: row.sender_id, created_at: row.created_at, text, decryptionFailed: false }
        } catch {
          // A damaged or unauthentic message is shown as an error, never as ciphertext.
          return { id: row.id, sender_id: row.sender_id, created_at: row.created_at, text: null, decryptionFailed: true }
        }
      }))
      return { conversationName: profiles[0]?.full_name?.trim() || 'CipherChat User', messages }
    } finally {
      // The derived AES key is short-lived and cleared after this history load.
      key.fill(0)
    }
  }

  async function sendMessage(userId: string, conversationId: string, text: string): Promise<void> {
    if (!text.trim()) throw new Error('Enter a message before sending.')
    const [conversation, members] = await Promise.all([
      repository.getConversation(conversationId),
      repository.getConversationMembers(conversationId)
    ])
    const peerId = requireDirectPair(conversation, members, conversationId, userId)
    const identity = await getVerifiedIdentity(userId, dependencies)
    const peerKeyValue = await repository.getPublicKey(peerId)
    if (!peerKeyValue) throw new Error('The other participant has no registered Mobile public key.')
    const peerKey = dependencies.validatePublicKey(peerKeyValue as PublicKey)
    const key = await dependencies.deriveConversationKey(identity.privateKey, peerKey, conversationId)
    try {
      const envelope = await dependencies.encryptMessage(text, key, conversationId)
      // Only the serialized AES-GCM envelope is sent to Supabase; plaintext stays local.
      await repository.insertMessage({
        conversation_id: conversationId,
        sender_id: userId,
        ciphertext: JSON.stringify(envelope)
      })
    } finally {
      key.fill(0)
    }
  }

  return {
    searchUsers: (query: string, limit = 20) => repository.searchUsers(query, limit),
    createDirectConversation: (otherUserId: string) => repository.createDirectConversation(otherUserId),
    listConversations,
    loadConversationPreview,
    loadMessages,
    sendMessage
  }
}
