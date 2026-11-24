import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { InlineNotice } from '../../../components/Controls'
import { useAuth } from '../../../hooks/AuthProvider'
import { useTheme } from '../../../hooks/ThemeProvider'
import { loadMobileMessages, sendMobileMessage } from '../../../lib/mobileMessaging'
import type { DecryptedMobileMessage } from '../../../lib/mobileMessagingCore'
import { supabase } from '../../../lib/supabase'
import {
  mergeDecryptedMobileMessages,
  subscribeToMobileMessages,
  type MobileRealtimeClientLike
} from '../../../lib/mobileRealtimeCore'

function formatMessageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })
}

export default function DirectConversationScreen(): React.JSX.Element {
  const { conversationId: routeConversationId } = useLocalSearchParams<{ conversationId: string }>()
  const conversationId = Array.isArray(routeConversationId) ? routeConversationId[0] : routeConversationId
  const { session } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const [conversationName, setConversationName] = useState('Conversation')
  const [messages, setMessages] = useState<DecryptedMobileMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING')
  const messageRequestId = useRef(0)
  const messageTarget = useRef('')

  const loadConversation = useCallback(async (): Promise<void> => {
    const requestId = ++messageRequestId.current
    const isCurrentRequest = (): boolean => requestId === messageRequestId.current
    const userId = session?.user.id
    if (!userId || !conversationId) {
      if (isCurrentRequest()) {
        setMessages([])
        setError('This conversation link is incomplete.')
        setLoading(false)
        setRefreshing(false)
      }
      return
    }

    const nextTarget = `${userId}:${conversationId}`
    if (messageTarget.current !== nextTarget) {
      messageTarget.current = nextTarget
      setMessages([])
      setConversationName('Conversation')
      setLoading(true)
    }
    setError(null)
    try {
      const result = await loadMobileMessages(userId, conversationId)
      if (!isCurrentRequest()) return
      setConversationName(result.conversationName)
      setMessages((current) => mergeDecryptedMobileMessages(current, result.messages))
    } catch (loadError) {
      if (isCurrentRequest()) {
        // Clear stale plaintext when the current user's access or key check fails.
        setMessages([])
        setError(loadError instanceof Error ? loadError.message : 'Unable to load this conversation.')
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [conversationId, session?.user.id])

  // Subscribe only while this authenticated conversation is focused.
  useFocusEffect(useCallback(() => {
    void loadConversation()
    if (!session?.user.id || !conversationId || !supabase) {
      return () => { messageRequestId.current += 1 }
    }

    setRealtimeStatus('CONNECTING')
    return subscribeToMobileMessages(
      supabase as unknown as MobileRealtimeClientLike,
      conversationId,
      () => { void loadConversation() },
      setRealtimeStatus,
      // Rejoining after a network interruption fetches history that was missed offline.
      () => { void loadConversation() }
    )
  }, [conversationId, loadConversation, session?.user.id]))

  const refresh = (): void => {
    setRefreshing(true)
    void loadConversation()
  }

  const send = async (): Promise<void> => {
    const userId = session?.user.id
    if (!userId || !conversationId || sending || !draft.trim()) return
    setSending(true)
    setError(null)
    try {
      await sendMobileMessage(userId, conversationId, draft)
      setDraft('')
      await loadConversation()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'The encrypted message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back to conversations"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={[styles.backText, { color: colors.accent }]}>‹</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {conversationName}
            </Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>Mobile direct conversation</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh messages"
            onPress={refresh}
            disabled={refreshing || loading}
            style={styles.refreshButton}
          >
            <Text style={[styles.refreshText, { color: colors.accent }]}>↻</Text>
          </Pressable>
        </View>

        {realtimeStatus !== 'SUBSCRIBED' && (
          <InlineNotice message="Live updates are reconnecting. Pull down to refresh while offline." />
        )}
        {error && <InlineNotice message={error} tone="error" />}
        {loading && messages.length === 0 ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.statusText, { color: colors.muted }]}>Decrypting Mobile messages…</Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={messages.length === 0 ? styles.emptyList : styles.messageList}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
            }
            ListEmptyComponent={error ? undefined : (
              <View style={styles.loadingState}>
                <Text style={[styles.statusText, { color: colors.muted }]}>No messages yet.</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const sentByMe = item.sender_id === session?.user.id
              return (
                <View style={[styles.messageLine, sentByMe ? styles.sentLine : styles.receivedLine]}>
                  <View style={[
                    styles.messageBubble,
                    sentByMe
                      ? { backgroundColor: colors.accent, borderColor: colors.accent }
                      : { backgroundColor: colors.surface, borderColor: colors.border }
                  ]}>
                    <Text style={[styles.messageText, {
                      color: sentByMe ? '#ffffff' : colors.text,
                      opacity: item.decryptionFailed ? 0.75 : 1
                    }]}>
                      {item.decryptionFailed ? 'Unable to decrypt this message.' : item.text}
                    </Text>
                    <Text style={[styles.timestamp, { color: sentByMe ? '#e8e9ff' : colors.muted }]}>
                      {formatMessageTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              )
            }}
          />
        )}

        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          <TextInput
            accessibilityLabel="Message text"
            editable={!sending}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => { void send() }}
            returnKeyType="send"
            multiline
            placeholder="Write an encrypted message"
            placeholderTextColor={colors.muted}
            style={[styles.input, {
              color: colors.text, backgroundColor: colors.input, borderColor: colors.border
            }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send encrypted message"
            accessibilityState={{ disabled: sending || !draft.trim() }}
            disabled={sending || !draft.trim()}
            onPress={() => { void send() }}
            style={[styles.sendButton, { backgroundColor: colors.accent, opacity: sending || !draft.trim() ? 0.45 : 1 }]}
          >
            {sending
              ? <ActivityIndicator color="#ffffff" />
              : <Text style={styles.sendText}>Send</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: 14 },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  backButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 36, lineHeight: 40, marginTop: -4 },
  headerCopy: { flex: 1, paddingRight: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 11, marginTop: 3 },
  refreshButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  refreshText: { fontSize: 28 },
  loadingState: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 9 },
  statusText: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  messageList: { paddingVertical: 14, gap: 10 },
  messageLine: { width: '100%', flexDirection: 'row' },
  sentLine: { justifyContent: 'flex-end' },
  receivedLine: { justifyContent: 'flex-start' },
  messageBubble: { maxWidth: '84%', borderWidth: 1, borderRadius: 15, padding: 12, gap: 7 },
  messageText: { fontSize: 14, lineHeight: 20 },
  timestamp: { fontSize: 10, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  sendButton: { minHeight: 44, minWidth: 62, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#ffffff', fontWeight: '700', fontSize: 13 }
})
