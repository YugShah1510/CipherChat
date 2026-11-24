import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { AppButton, FormField, InlineNotice } from '../../components/Controls'
import { useAuth } from '../../hooks/AuthProvider'
import { useTheme } from '../../hooks/ThemeProvider'
import { supabase } from '../../lib/supabase'
import {
  createMobileDirectConversation,
  listMobileConversations,
  loadMobileConversationPreview,
  searchMobileUsers
} from '../../lib/mobileMessaging'
import type { MobileConversationListItem, MobileUserResult } from '../../lib/mobileMessagingCore'
import {
  subscribeToMobileMessages,
  type MobileRealtimeClientLike
} from '../../lib/mobileRealtimeCore'

function initialsFor(name: string): string {
  return name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CC'
}

function formatActivityTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function SignedInHomeScreen(): React.JSX.Element {
  const { session, signOut } = useAuth()
  const { colors, isDark, toggleTheme } = useTheme()
  const router = useRouter()
  const [fullName, setFullName] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Array<MobileConversationListItem & { initials: string }>>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<MobileUserResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [openingUserId, setOpeningUserId] = useState<string | null>(null)
  const [realtimeStatus, setRealtimeStatus] = useState('CONNECTING')
  const listRequestId = useRef(0)

  const loadConversations = useCallback(async (): Promise<void> => {
    // Ignore older network responses if a refresh or realtime event starts a newer load.
    const requestId = ++listRequestId.current
    const isCurrentRequest = (): boolean => requestId === listRequestId.current
    const userId = session?.user.id
    if (!userId) {
      if (isCurrentRequest()) {
        setConversations([])
        setLoading(false)
      }
      return
    }
    setError(null)
    try {
      const rows = await listMobileConversations(userId)
      if (!isCurrentRequest()) return
      const nextConversations = rows.map((row) => ({
        ...row,
        initials: initialsFor(row.name)
      }))
      if (isCurrentRequest()) setConversations(nextConversations)
    } catch (loadError) {
      if (isCurrentRequest()) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load conversations.')
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [session?.user.id])

  // The list listens only while focused; reconnects trigger a full missed-event catch-up.
  useFocusEffect(useCallback(() => {
    void loadConversations()
    const userId = session?.user.id
    if (!userId || !supabase) return () => { listRequestId.current += 1 }

    let active = true
    setRealtimeStatus('CONNECTING')
    const unsubscribe = subscribeToMobileMessages(
      supabase as unknown as MobileRealtimeClientLike,
      null,
      (event) => {
        // Read only the changed conversation's preview after an insert.
        void loadMobileConversationPreview(userId, event.conversation_id).then((row) => {
          if (!active) return
          if (!row) {
            void loadConversations()
            return
          }
          let alreadyListed = false
          setConversations((current) => {
            alreadyListed = current.some((item) => item.id === row.id)
            const updated = { ...row, initials: initialsFor(row.name) }
            if (!alreadyListed) return current
            return [...current.filter((item) => item.id !== row.id), updated]
              .sort((left, right) => Date.parse(right.activity_at) - Date.parse(left.activity_at))
          })
          if (!alreadyListed) void loadConversations()
        }).catch(() => {
          // A list catch-up also safely handles an event for a no-longer-visible chat.
          if (active) void loadConversations()
        })
      },
      setRealtimeStatus,
      // Re-read the full list after rejoining so events missed while offline are recovered.
      () => { void loadConversations() }
    )
    return () => {
      active = false
      listRequestId.current += 1
      unsubscribe()
    }
  }, [loadConversations, session?.user.id]))

  const runSearch = async (): Promise<void> => {
    setSearchBusy(true)
    setError(null)
    try {
      const results = await searchMobileUsers(searchText, 20)
      setSearchResults(results.filter((result) => result.user_id !== session?.user.id))
      if (results.length === 0) setError('No Mobile users matched that search.')
    } catch (searchError) {
      setSearchResults([])
      setError(searchError instanceof Error ? searchError.message : 'Unable to search Mobile users.')
    } finally {
      setSearchBusy(false)
    }
  }

  const openOrCreateConversation = async (otherUserId: string): Promise<void> => {
    setOpeningUserId(otherUserId)
    setError(null)
    try {
      // The RPC returns the existing pair conversation or creates it atomically.
      const conversationId = await createMobileDirectConversation(otherUserId)
      setSearchResults([])
      setSearchText('')
      router.push({
        pathname: '/(app)/conversation/[conversationId]',
        params: { conversationId }
      })
      void loadConversations()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to open this Mobile conversation.')
    } finally {
      setOpeningUserId(null)
    }
  }

  useEffect(() => {
    if (!session?.user.id || !supabase) return
    let active = true
    void supabase.from('profiles').select('full_name').eq('id', session.user.id).maybeSingle()
      .then(({ data, error: profileError }) => {
        if (active && !profileError) setFullName(data?.full_name ?? null)
      })
    return () => { active = false }
  }, [session?.user.id])

  const refresh = (): void => {
    setRefreshing(true)
    void loadConversations()
  }

  const handleSignOut = async (): Promise<void> => {
    setSignOutBusy(true)
    setError(null)
    try {
      await signOut()
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Unable to sign out.')
    } finally {
      setSignOutBusy(false)
    }
  }

  const displayName = fullName || session?.user.user_metadata.full_name || 'Your account'

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Image source={require('../../../assets/images/icon.png')} style={styles.logo} />
          <View style={styles.headerTitles}>
            <Text style={[styles.brand, { color: colors.text }]}>CipherChat</Text>
            <Text style={[styles.account, { color: colors.muted }]}>{displayName}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle color theme"
            onPress={toggleTheme}
            style={styles.headerAction}
          >
            <Text style={[styles.themeIcon, { color: colors.accent }]}>{isDark ? '☀' : '☾'}</Text>
          </Pressable>
        </View>

        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>Messages</Text>
          <Text style={[styles.count, { color: colors.muted }]}>{conversations.length}</Text>
        </View>

        <Text style={[styles.searchHeading, { color: colors.text }]}>Start a Mobile direct chat</Text>
        <FormField
          label="Find Mobile users"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => { void runSearch() }}
          placeholder="Enter at least two characters"
        />
        <AppButton
          title="Search Mobile users"
          onPress={() => { void runSearch() }}
          loading={searchBusy}
          disabled={searchText.trim().length < 2}
        />
        {searchResults.map((result) => (
          <Pressable
            key={result.user_id}
            accessibilityRole="button"
            accessibilityLabel={`Start a direct chat with ${result.full_name}`}
            disabled={openingUserId !== null}
            onPress={() => { void openOrCreateConversation(result.user_id) }}
            style={[styles.userResult, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.userResultText, { color: colors.text }]}>
              {openingUserId === result.user_id ? 'Opening…' : result.full_name}
            </Text>
          </Pressable>
        ))}

        {realtimeStatus !== 'SUBSCRIBED' && (
          <InlineNotice message="Live updates are reconnecting. Pull down to refresh while offline." />
        )}
        {error && <InlineNotice message={error} tone="error" />}
        {loading && conversations.length === 0 ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.stateText, { color: colors.muted }]}>Loading conversations…</Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={conversations.length === 0 ? styles.emptyList : styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
            }
            ListEmptyComponent={
              <View style={styles.centerState}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No conversations yet</Text>
                <Text style={[styles.stateText, { color: colors.muted }]}>
                  Conversations will appear here when you are added to one.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const rowContent = (
                <>
                  <View style={[styles.avatar, {
                    backgroundColor: colors.surface,
                    borderColor: colors.border
                  }]}>
                    <Text style={[styles.avatarText, { color: colors.accent }]}>{item.initials}</Text>
                  </View>
                  <View style={styles.conversationDetails}>
                    <View style={styles.conversationTitleRow}>
                      <Text numberOfLines={1} style={[styles.conversationName, { color: colors.text }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.time, { color: colors.muted }]}>
                        {formatActivityTime(item.activity_at)}
                      </Text>
                    </View>
                    <View style={styles.conversationTitleRow}>
                      <Text numberOfLines={1} style={[styles.preview, { color: colors.muted }]}>
                        {item.preview}
                      </Text>
                    </View>
                  </View>
                </>
              )

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open conversation with ${item.name}`}
                  onPress={() => router.push({
                    pathname: '/(app)/conversation/[conversationId]',
                    params: { conversationId: item.id }
                  })}
                  style={({ pressed }) => [
                    styles.conversationRow,
                    { backgroundColor: pressed ? colors.input : colors.surface, borderColor: colors.border }
                  ]}
                >
                  {rowContent}
                </Pressable>
              )
            }}
          />
        )}

        <AppButton title="Sign out" onPress={() => void handleSignOut()} loading={signOutBusy} variant="secondary" />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 22 },
  logo: { width: 42, height: 42, borderRadius: 11 },
  headerTitles: { flex: 1 },
  brand: { fontSize: 18, fontWeight: '800' },
  account: { marginTop: 3, fontSize: 12 },
  headerAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  themeIcon: { fontSize: 22 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 },
  searchHeading: { marginTop: 3, fontSize: 15, fontWeight: '700' },
  userResult: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: 9, marginTop: 7 },
  userResultText: { fontSize: 14, fontWeight: '600' },
  title: { fontSize: 25, fontWeight: '800' },
  count: { fontSize: 13, fontWeight: '600' },
  list: { paddingBottom: 12 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  stateText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  conversationRow: {
    minHeight: 78, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12,
    marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 12
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center'
  },
  avatarText: { fontWeight: '800', fontSize: 14 },
  conversationDetails: { flex: 1, gap: 7 },
  conversationTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conversationName: { flex: 1, fontSize: 15, fontWeight: '700' },
  time: { fontSize: 11 },
  preview: { flex: 1, fontSize: 13 },
})
