import type { DecryptedMobileMessage } from './mobileMessagingCore'

export type MobileMessageInsertEvent = {
  id: string
  conversation_id: string
  sender_id: string
  created_at: string
}

type PostgresInsertPayload = { new: unknown }
type RealtimeFilter = {
  event: 'INSERT'
  schema: 'public'
  table: 'mobile_messages'
  filter?: string
}
type RealtimeChannelLike = {
  on: (
    event: 'postgres_changes',
    filter: RealtimeFilter,
    callback: (payload: PostgresInsertPayload) => void
  ) => RealtimeChannelLike
  subscribe: (callback: (status: string) => void) => RealtimeChannelLike
}
export type MobileRealtimeClientLike = {
  channel: (name: string) => RealtimeChannelLike
  removeChannel: (channel: RealtimeChannelLike) => Promise<unknown>
}

function readInsertEvent(value: unknown, conversationId: string | null): MobileMessageInsertEvent | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (
    typeof row.conversation_id !== 'string' ||
    (conversationId !== null && row.conversation_id !== conversationId) ||
    typeof row.id !== 'string' ||
    typeof row.sender_id !== 'string' ||
    typeof row.created_at !== 'string'
  ) return null

  // Keep the event handler's data minimal; it refetches ciphertext under RLS before decrypting.
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    created_at: row.created_at
  }
}

/**
 * Watch one active conversation. Supabase rejoins the channel after reconnect;
 * the reconnect callback then fetches history missed while the socket was down.
 */
export function subscribeToMobileMessages(
  client: MobileRealtimeClientLike,
  conversationId: string | null,
  onInsert: (event: MobileMessageInsertEvent) => void,
  onStatus: (status: string) => void,
  onReconnect: () => void
): () => void {
  let active = true
  let hasConnectedOnce = false
  let lostConnection = false
  const channel = client
    .channel(conversationId ? `mobile-conversation-${conversationId}` : 'mobile-conversation-list')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'mobile_messages',
      ...(conversationId ? { filter: `conversation_id=eq.${conversationId}` } : {})
    }, (payload) => {
      if (!active) return
      const event = readInsertEvent(payload.new, conversationId)
      if (event) onInsert(event)
    })
    .subscribe((status) => {
      if (!active) return
      onStatus(status)
      if (status === 'SUBSCRIBED') {
        if (hasConnectedOnce && lostConnection) onReconnect()
        hasConnectedOnce = true
        lostConnection = false
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (hasConnectedOnce) lostConnection = true
      }
    })

  return () => {
    active = false
    void client.removeChannel(channel).catch(() => undefined)
  }
}

/** Merge event-driven refreshes by message ID and keep stable chronological order. */
export function mergeDecryptedMobileMessages(
  current: DecryptedMobileMessage[],
  incoming: DecryptedMobileMessage[]
): DecryptedMobileMessage[] {
  const byId = new Map<string, DecryptedMobileMessage>()
  for (const message of current) byId.set(message.id, message)
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((left, right) => {
    const timeDifference = Date.parse(left.created_at) - Date.parse(right.created_at)
    return timeDifference || left.id.localeCompare(right.id)
  })
}
