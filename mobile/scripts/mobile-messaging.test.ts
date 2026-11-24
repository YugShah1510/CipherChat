import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decryptMessage,
  deriveConversationKey,
  encryptMessage,
  generateIdentityKeys,
  validatePublicKey,
  verifyIdentityKeyPair,
  type PublicKey
} from '../src/lib/cryptoCore'
import {
  createMobileMessagingService,
  type MobileConversationRecord,
  type MobileLatestMessage,
  type MobileMemberRecord,
  type MobileMessagingRepository,
  type MobileProfileRecord,
  type MobileStoredMessage,
  type MobileUserResult
} from '../src/lib/mobileMessagingCore'
import {
  mergeDecryptedMobileMessages,
  subscribeToMobileMessages,
  type MobileRealtimeClientLike
} from '../src/lib/mobileRealtimeCore'

const userA = '11111111-2222-4333-8444-555555555555'
const userB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const userC = '99999999-8888-4777-8666-555555555555'
const conversationId = '12345678-1234-4234-8234-123456789012'

type FakeRealtimeChannel = {
  filter?: { event: string; schema: string; table: string; filter?: string }
  eventHandler?: (payload: { new: unknown }) => void
  statusHandler?: (status: string) => void
  removed: boolean
  on: (
    event: 'postgres_changes',
    filter: { event: 'INSERT'; schema: 'public'; table: 'mobile_messages'; filter?: string },
    callback: (payload: { new: unknown }) => void
  ) => FakeRealtimeChannel
  subscribe: (callback: (status: string) => void) => FakeRealtimeChannel
}

function fakeRealtimeClient(): { client: MobileRealtimeClientLike; channel: FakeRealtimeChannel } {
  const channel: FakeRealtimeChannel = {
    removed: false,
    on(_event, filter, callback) {
      this.filter = filter
      this.eventHandler = callback
      return this
    },
    subscribe(callback) {
      this.statusHandler = callback
      return this
    }
  }
  const client = {
    channel: () => channel,
    removeChannel: async (target: unknown) => {
      if (target === channel) channel.removed = true
    }
  } as unknown as MobileRealtimeClientLike
  return { client, channel }
}

type TestIdentity = { publicKey: PublicKey; privateKey: string }
type TestDatabase = {
  identities: Map<string, TestIdentity>
  conversations: Map<string, MobileConversationRecord>
  members: MobileMemberRecord[]
  messages: MobileStoredMessage[]
  profiles: MobileProfileRecord[]
  messageReads: string[]
  nextConversation: number
  nextMessage: number
}

function makeRepository(actorId: string, database: TestDatabase): MobileMessagingRepository {
  const hasAccess = (id: string): boolean =>
    database.members.some((member) => member.conversation_id === id && member.user_id === actorId)
  const memberRows = (ids: string[]): MobileMemberRecord[] =>
    database.members.filter((member) => ids.includes(member.conversation_id) && hasAccess(member.conversation_id))

  return {
    async listMemberships(userId) {
      assert.equal(userId, actorId)
      return memberRows(database.members.filter((row) => row.user_id === userId).map((row) => row.conversation_id))
        .filter((row) => row.user_id === userId)
    },
    async getConversations(ids) {
      return [...database.conversations.values()].filter((row) => ids.includes(row.id) && hasAccess(row.id))
    },
    async getMembers(ids) { return memberRows(ids) },
    async getProfiles(ids) { return database.profiles.filter((row) => ids.includes(row.id)) },
    async getLatestMessages(ids): Promise<MobileLatestMessage[]> {
      return database.messages
        .filter((row) => ids.includes(row.conversation_id) && hasAccess(row.conversation_id))
        .map((row) => ({
          conversation_id: row.conversation_id,
          sender_id: row.sender_id,
          created_at: row.created_at
        }))
    },
    async searchUsers(query, limit): Promise<MobileUserResult[]> {
      if (!database.identities.has(actorId)) throw new Error('Mobile identity registration is required.')
      return database.profiles
        .filter((profile) => profile.id !== actorId && database.identities.has(profile.id) &&
          (profile.full_name ?? '').toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit)
        .map((profile) => ({ user_id: profile.id, full_name: profile.full_name ?? '' }))
    },
    async createDirectConversation(otherUserId) {
      if (!database.identities.has(actorId) || !database.identities.has(otherUserId)) {
        throw new Error('Both participants need Mobile identities.')
      }
      const existing = database.members.find((member) =>
        member.user_id === actorId && database.members.some((other) =>
          other.conversation_id === member.conversation_id && other.user_id === otherUserId
        )
      )
      if (existing) return existing.conversation_id
      const id = database.nextConversation++ === 0 ? conversationId : `conversation-${database.nextConversation}`
      database.conversations.set(id, { id, type: 'direct', created_at: new Date(0).toISOString() })
      database.members.push(
        { conversation_id: id, user_id: actorId },
        { conversation_id: id, user_id: otherUserId }
      )
      return id
    },
    async getConversation(id) {
      // The real SELECT policy returns no conversation row to a nonmember.
      return hasAccess(id) ? database.conversations.get(id) ?? null : null
    },
    async getConversationMembers(id) { return memberRows([id]) },
    async getPublicKey(targetId) {
      if (targetId !== actorId && !database.members.some((member) =>
        member.user_id === targetId && hasAccess(member.conversation_id)
      )) throw new Error('Peer public key is not available outside a shared conversation.')
      return database.identities.get(targetId)?.publicKey ?? null
    },
    async getMessages(id) {
      if (!hasAccess(id)) throw new Error('Not authorized.')
      database.messageReads.push(id)
      return database.messages.filter((row) => row.conversation_id === id)
    },
    async insertMessage(input) {
      if (input.sender_id !== actorId || !hasAccess(input.conversation_id)) {
        throw new Error('Not authorized.')
      }
      const parsed = JSON.parse(input.ciphertext) as { version?: number; iv?: string; ciphertext?: string }
      assert.equal(parsed.version, 1)
      assert.equal(typeof parsed.iv, 'string')
      assert.equal(typeof parsed.ciphertext, 'string')
      database.messages.push({
        id: `message-${database.nextMessage++}`,
        conversation_id: input.conversation_id,
        sender_id: input.sender_id,
        created_at: new Date(database.nextMessage * 1000).toISOString(),
        ciphertext: input.ciphertext
      })
    }
  }
}

let randomCounter = 1
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) bytes[index] = (randomCounter++ * 31) & 0xff
  return bytes
}

async function createIdentity(seed: number): Promise<TestIdentity> {
  return generateIdentityKeys((length) => {
    const bytes = new Uint8Array(length)
    bytes.fill(seed)
    return bytes
  })
}

async function setup(): Promise<{
  database: TestDatabase
  serviceFor: (userId: string) => ReturnType<typeof createMobileMessagingService>
}> {
  const identities = new Map<string, TestIdentity>([
    [userA, await createIdentity(41)],
    [userB, await createIdentity(83)],
    [userC, await createIdentity(127)]
  ])
  const database: TestDatabase = {
    identities,
    conversations: new Map(),
    members: [],
    messages: [],
    profiles: [
      { id: userA, full_name: 'Mobile Alice' },
      { id: userB, full_name: 'Mobile Bob' },
      { id: userC, full_name: 'Mobile Carol' }
    ],
    messageReads: [],
    nextConversation: 0,
    nextMessage: 0
  }
  const serviceFor = (userId: string) => createMobileMessagingService({
    repository: makeRepository(userId, database),
    loadIdentity: async (accountId) => {
      const identity = identities.get(accountId)
      return identity ? JSON.stringify(identity) : null
    },
    validatePublicKey,
    verifyIdentityKeyPair,
    deriveConversationKey,
    encryptMessage: (text, key, id) => encryptMessage(text, key, id, randomBytes),
    decryptMessage
  })
  return { database, serviceFor }
}

test('two Mobile accounts create a direct conversation and exchange encrypted messages', async () => {
  const { database, serviceFor } = await setup()
  const alice = serviceFor(userA)
  const bob = serviceFor(userB)
  const id = await alice.createDirectConversation(userB)
  assert.equal(await bob.createDirectConversation(userA), id)
  assert.equal(database.members.filter((member) => member.conversation_id === id).length, 2)

  await alice.sendMessage(userA, id, 'hello from Alice')
  assert.equal(database.messages.length, 1)
  assert.equal(database.messages[0].ciphertext.includes('hello from Alice'), false)
  const bobHistory = await bob.loadMessages(userB, id)
  assert.equal(bobHistory.messages[0].text, 'hello from Alice')
  assert.equal(bobHistory.messages[0].decryptionFailed, false)

  await bob.sendMessage(userB, id, 'hello from Bob')
  const aliceHistory = await alice.loadMessages(userA, id)
  assert.deepEqual(aliceHistory.messages.map((message) => message.text), [
    'hello from Alice', 'hello from Bob'
  ])
})

test('wrong conversation ID fails AES-GCM authentication', async () => {
  const alice = await createIdentity(51)
  const bob = await createIdentity(92)
  const key = await deriveConversationKey(alice.privateKey, bob.publicKey, conversationId)
  try {
    const envelope = await encryptMessage('bound to this conversation', key, conversationId, randomBytes)
    await assert.rejects(
      decryptMessage(envelope, key, '87654321-4321-4321-8321-210987654321'),
      /auth|tag|decrypt|cipher/i
    )
  } finally {
    key.fill(0)
  }
})

test('a nonmember cannot read or send to another direct conversation', async () => {
  const { database, serviceFor } = await setup()
  const alice = serviceFor(userA)
  const carol = serviceFor(userC)
  const id = await alice.createDirectConversation(userB)

  await assert.rejects(carol.loadMessages(userC, id), /could not be found|not a member|invalid membership/i)
  await assert.rejects(carol.sendMessage(userC, id, 'unauthorized'), /could not be found|not a member|invalid membership/i)
  assert.equal(database.messages.length, 0)
  assert.deepEqual(database.messageReads, [])
})

test('a Mobile Realtime INSERT is filtered, decrypted, and deduplicated by message ID', async () => {
  const { database, serviceFor } = await setup()
  const alice = serviceFor(userA)
  const bob = serviceFor(userB)
  const id = await alice.createDirectConversation(userB)
  await bob.loadMessages(userB, id)
  const { client, channel } = fakeRealtimeClient()
  let visibleMessages: Awaited<ReturnType<typeof bob.loadMessages>>['messages'] = []
  let pendingLoad: Promise<void> | null = null
  let handledEvents = 0

  const unsubscribe = subscribeToMobileMessages(client, id, () => {
    handledEvents += 1
    pendingLoad = bob.loadMessages(userB, id).then((result) => {
      visibleMessages = mergeDecryptedMobileMessages(visibleMessages, result.messages)
    })
  }, () => {}, () => {})
  channel.statusHandler?.('SUBSCRIBED')
  assert.equal(channel.filter?.table, 'mobile_messages')
  assert.equal(channel.filter?.event, 'INSERT')
  assert.equal(channel.filter?.filter, `conversation_id=eq.${id}`)

  await alice.sendMessage(userA, id, 'received over realtime')
  const stored = database.messages[0]
  channel.eventHandler?.({ new: { ...stored, conversation_id: 'other-conversation' } })
  assert.equal(handledEvents, 0)

  const event = { ...stored }
  channel.eventHandler?.({ new: event })
  await pendingLoad
  assert.equal(visibleMessages[0]?.text, 'received over realtime')
  assert.equal(visibleMessages[0]?.decryptionFailed, false)

  // Replayed delivery causes a refetch, but the rendered list still has one copy.
  channel.eventHandler?.({ new: event })
  await pendingLoad
  assert.equal(handledEvents, 2)
  assert.equal(visibleMessages.length, 1)
  unsubscribe()
})

test('leaving a screen unsubscribes and ignores later events', async () => {
  const { client, channel } = fakeRealtimeClient()
  let handledEvents = 0
  const unsubscribe = subscribeToMobileMessages(
    client, conversationId, () => { handledEvents += 1 }, () => {}, () => {}
  )
  const event = {
    id: 'message-1',
    conversation_id: conversationId,
    sender_id: userA,
    created_at: new Date(0).toISOString()
  }
  channel.eventHandler?.({ new: event })
  assert.equal(handledEvents, 1)

  unsubscribe()
  await Promise.resolve()
  channel.eventHandler?.({ new: { ...event, id: 'message-2' } })
  assert.equal(channel.removed, true)
  assert.equal(handledEvents, 1)
})

test('rejoining after a disconnect triggers missed-message catch-up', async () => {
  const { client, channel } = fakeRealtimeClient()
  let reconnects = 0
  const unsubscribe = subscribeToMobileMessages(
    client, conversationId, () => {}, () => {}, () => { reconnects += 1 }
  )
  channel.statusHandler?.('SUBSCRIBED')
  assert.equal(reconnects, 0)
  channel.statusHandler?.('CHANNEL_ERROR')
  channel.statusHandler?.('SUBSCRIBED')
  assert.equal(reconnects, 1)
  unsubscribe()
})
