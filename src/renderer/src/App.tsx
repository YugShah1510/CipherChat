
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { ensureUserIdentity } from './lib/identity'
import {
  deriveConversationKey,
  encryptMessage,
  decryptMessage,
  type EncryptedMessage,
  type PublicKey
} from './lib/crypto'
import './assets/main.css'

import {
  generateGroupKey,
  wrapGroupKey,
  unwrapGroupKey,
  type GroupKeyEnvelope,
  encryptMedia,
  decryptMedia
} from './lib/groupCrypto'

type Message = {
  id: string | number
  text: string
  time: string
  sender: 'me' | 'them'
  reaction?: string
  reactedByMe?: boolean
  reactionCount?: number
  mediaUrl?: string
  mediaName?: string
  mediaMimeType?: string
  mediaSize?: number
}

type Conversation = {
  id: string | number
  name: string
  type: 'direct' | 'group'
  avatar: string
  color: string
  preview: string
  time: string
  unread: number
  members?: number
  messages: Message[]
}

type ReactionRow = {
  id: string
  message_id: string
  user_id: string
  reaction: string
}

function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'CC'
  )
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<'login' | 'signup' | 'forgot' | 'dashboard'>('login')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | number>('')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [darkMode, setDarkMode] = useState(true)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupUserSearch, setGroupUserSearch] = useState('')
  const [groupUserResults, setGroupUserResults] = useState<
    { id: string; full_name: string | null }[]
  >([])
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([])
  const [groupSearchBusy, setGroupSearchBusy] = useState(false)
  const [groupCreateBusy, setGroupCreateBusy] = useState(false)
  const [groupNotice, setGroupNotice] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<
    { id: string; full_name: string | null }[]
  >([])
  const [userSearchBusy, setUserSearchBusy] = useState(false)
  const [creatingChatFor, setCreatingChatFor] = useState<string | null>(null)
  const [newChatNotice, setNewChatNotice] = useState('')
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversationError, setConversationError] = useState('')
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messageError, setMessageError] = useState('')
  const [reactionBusy, setReactionBusy] = useState<string | null>(null)
  const [mediaBusy, setMediaBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaObjectUrlsRef = useRef<string[]>([])

  useEffect(() => () => {
    mediaObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    mediaObjectUrlsRef.current = []
  }, [])

  const selectedChat = conversations.find((chat) => chat.id === selectedId)

  const getConversationEncryptionKey = async (
    conversationId: string,
    conversationType: 'direct' | 'group'
  ): Promise<CryptoKey> => {
    if (!authUserId) {
      throw new Error('You must be signed in.')
    }

    const storedIdentity = await window.api.secureStorage.load(authUserId)

    if (!storedIdentity) {
      throw new Error('Your encryption identity is missing on this device.')
    }

    const identity = JSON.parse(storedIdentity) as {
      privateKey: string
    }

    if (!identity.privateKey) {
      throw new Error('Your private encryption key is invalid.')
    }

    if (conversationType === 'direct') {
      const { data: members, error: membersError } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', authUserId)

      if (membersError) throw membersError

      const otherUserId = members?.[0]?.user_id

      if (!otherUserId) {
        throw new Error('Could not find the other participant.')
      }

      const { data: publicKeyRow, error: publicKeyError } = await supabase
        .from('user_public_keys')
        .select('public_key')
        .eq('user_id', otherUserId)
        .maybeSingle()

      if (publicKeyError) throw publicKeyError

      if (!publicKeyRow?.public_key) {
        throw new Error('The other user has not registered an encryption key.')
      }

      return deriveConversationKey(
        identity.privateKey,
        JSON.parse(publicKeyRow.public_key) as PublicKey,
        conversationId
      )
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('created_by')
      .eq('id', conversationId)
      .single()

    if (conversationError) throw conversationError

    if (!conversation?.created_by) {
      throw new Error('Could not find the group creator.')
    }

    const { data: creatorKeyRow, error: creatorKeyError } = await supabase
      .from('user_public_keys')
      .select('public_key')
      .eq('user_id', conversation.created_by)
      .maybeSingle()

    if (creatorKeyError) throw creatorKeyError

    if (!creatorKeyRow?.public_key) {
      throw new Error('The group creator has no registered encryption key.')
    }

    const { data: groupKeyRow, error: groupKeyError } = await supabase
      .from('conversation_keys')
      .select('encrypted_key')
      .eq('conversation_id', conversationId)
      .eq('user_id', authUserId)
      .maybeSingle()

    if (groupKeyError) throw groupKeyError

    if (!groupKeyRow?.encrypted_key) {
      throw new Error(
        'Your encrypted group key was not found. Ask the group creator to add you again.'
      )
    }

    const envelope = JSON.parse(
      groupKeyRow.encrypted_key
    ) as GroupKeyEnvelope

    return unwrapGroupKey(
      envelope,
      identity.privateKey,
      JSON.parse(creatorKeyRow.public_key) as PublicKey,
      conversationId
    )
  }

  const filteredConversations = useMemo(
    () =>
      conversations.filter((chat) =>
        chat.name.toLowerCase().includes(search.toLowerCase())
      ),
    [conversations, search]
  )

  // Restore the Supabase session and listen for authentication changes.
  useEffect(() => {
    let active = true

    const restoreSession = async (): Promise<void> => {
      const { data, error } = await supabase.auth.getSession()
      if (!active) return

      if (error) setAuthNotice(error.message)

      if (data.session) {
        setAuthUserId(data.session.user.id)
        setAuthEmail(data.session.user.email ?? '')
        setAuthName(
          (data.session.user.user_metadata?.full_name as string | undefined) ?? ''
        )
        setScreen('dashboard')
      }

      setAuthReady(true)
    }

    void restoreSession()

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return

        if (session) {
          setAuthUserId(session.user.id)
          setAuthEmail(session.user.email ?? '')
          setAuthName(
            (session.user.user_metadata?.full_name as string | undefined) ?? ''
          )
          setScreen('dashboard')
        } else {
          setAuthUserId(null)
          setAuthName('')
          setAuthEmail('')
          setConversations([])
          setSelectedId('')
          setScreen('login')
        }
      }
    )

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  // Load the authenticated user's profile.
  useEffect(() => {
    if (!authUserId) return

    let active = true

    const loadProfile = async (): Promise<void> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', authUserId)
        .maybeSingle()

      if (!active) return

      if (error) {
        console.error('Unable to load profile:', error.message)
        return
      }

      if (data?.full_name) setAuthName(data.full_name)
    }

    void loadProfile()

    return () => {
      active = false
    }
  }, [authUserId])

  // Initialize or restore the user's encryption identity.
  useEffect(() => {
    if (!authUserId) return

    let active = true

    const initializeIdentity = async (): Promise<void> => {
      try {
        await ensureUserIdentity(authUserId)
        if (active) console.log('Encryption identity ready')
      } catch (error) {
        console.error('Encryption identity initialization failed:', error)
        if (active) {
          setAuthNotice(
            error instanceof Error
              ? error.message
              : 'Unable to initialize encryption identity.'
          )
        }
      }
    }

    void initializeIdentity()

    return () => {
      active = false
    }
  }, [authUserId])

  // Load real conversations and their members from Supabase.
  useEffect(() => {
    if (!authUserId) {
      setConversations([])
      setSelectedId('')
      return
    }

    let active = true

    const loadConversations = async (): Promise<void> => {
      setConversationLoading(true)
      setConversationError('')

      try {
        const { data: memberships, error: membershipError } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', authUserId)

        if (membershipError) throw membershipError

        const conversationIds = [
          ...new Set((memberships ?? []).map((item) => item.conversation_id))
        ]

        if (conversationIds.length === 0) {
          if (active) {
            setConversations([])
            setSelectedId('')
          }
          return
        }

        const { data: rows, error: conversationError } = await supabase
          .from('conversations')
          .select('id, name, type, created_at')
          .in('id', conversationIds)
          .order('created_at', { ascending: false })

        if (conversationError) throw conversationError

        const { data: members, error: membersError } = await supabase
          .from('conversation_members')
          .select('conversation_id, user_id')
          .in('conversation_id', conversationIds)

        if (membersError) throw membersError

        const otherUserIds = [
          ...new Set(
            (members ?? [])
              .map((member) => member.user_id)
              .filter((id) => id !== authUserId)
          )
        ]

        const { data: profiles, error: profilesError } = otherUserIds.length
          ? await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', otherUserIds)
          : { data: [], error: null }

        if (profilesError) throw profilesError

        const profileMap = new Map<string, string>(
          (profiles ?? []).map((profile) => [
            profile.id,
            profile.full_name || 'CipherChat User'
          ] as const)
        )

        const loadedConversations: Conversation[] = (rows ?? []).map((row) => {
          const conversationMembers = (members ?? []).filter(
            (member) => member.conversation_id === row.id
          )

          const otherNames = conversationMembers
            .filter((member) => member.user_id !== authUserId)
            .map((member) => profileMap.get(member.user_id) || 'CipherChat User')

          const isGroup = row.type === 'group'
          const displayName = isGroup
            ? row.name || 'Unnamed Group'
            : otherNames[0] || 'CipherChat User'

          return {
            id: row.id,
            name: displayName,
            type: isGroup ? 'group' : 'direct',
            avatar: getInitials(displayName),
            color: isGroup ? 'blue' : 'purple',
            preview: 'No messages yet',
            time: formatTime(row.created_at),
            unread: 0,
            members: conversationMembers.length,
            messages: []
          }
        })

        if (active) {
          setConversations(loadedConversations)
          setSelectedId((current) => {
            if (loadedConversations.some((chat) => chat.id === current)) {
              return current
            }
            return loadedConversations[0]?.id ?? ''
          })
        }
      } catch (error) {
        if (active) {
          setConversationError(
            error instanceof Error
              ? error.message
              : 'Unable to load conversations.'
          )
        }
      } finally {
        if (active) setConversationLoading(false)
      }
    }

    void loadConversations()

    return () => {
      active = false
    }
  }, [authUserId])

  // Load and decrypt messages for both direct and group conversations.
  useEffect(() => {
    if (!authUserId || !selectedChat) {
      setMessagesLoading(false)
      return
    }

    let active = true
    const conversationId = String(selectedChat.id)

    const loadMessages = async (): Promise<void> => {
      setMessagesLoading(true)
      setMessageError('')
      mediaObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      mediaObjectUrlsRef.current = []

      try {
        const conversationKey = await getConversationEncryptionKey(
          conversationId,
          selectedChat.type
        )

        const { data: rows, error: messagesError } = await supabase
          .from('messages')
          .select('id, sender_id, ciphertext, created_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })

        if (messagesError) throw messagesError

        const messageRows = rows ?? []
        const messageIds = messageRows.map((row) => row.id)
        let reactionRows: ReactionRow[] = []

        if (selectedChat.type === 'direct' && messageIds.length > 0) {
          const { data: reactions, error: reactionsError } = await supabase
            .from('message_reactions')
            .select('id, message_id, user_id, reaction')
            .in('message_id', messageIds)

          if (reactionsError) throw reactionsError
          reactionRows = (reactions ?? []) as ReactionRow[]
        }

        const decryptedMessages: Message[] = await Promise.all(
          messageRows.map(async (row) => {
            const plaintext = await decryptMessage(
              JSON.parse(row.ciphertext) as EncryptedMessage,
              conversationKey,
              conversationId
            )
            const messageReactions = reactionRows.filter(
              (reaction) => reaction.message_id === row.id
            )
            const myReaction = messageReactions.find(
              (reaction) => reaction.user_id === authUserId
            )

            let displayText = plaintext
            let mediaUrl: string | undefined
            let mediaName: string | undefined
            let mediaMimeType: string | undefined
            let mediaSize: number | undefined

            try {
              const payload = JSON.parse(plaintext) as {
                kind?: string
                version?: number
                path?: string
                iv?: string
                name?: string
                mimeType?: string
                size?: number
              }
              if (payload.kind === 'cipherchat-media' && payload.version === 1 && payload.path && payload.iv) {
                mediaName = payload.name || 'Attachment'
                mediaMimeType = payload.mimeType || 'application/octet-stream'
                mediaSize = payload.size
                displayText = `📎 ${mediaName}`
                const { data: encryptedBlob, error: downloadError } = await supabase
                  .storage.from('chat-media').download(payload.path)
                if (!downloadError && encryptedBlob) {
                  const decryptedBuffer = await decryptMedia(
                    await encryptedBlob.arrayBuffer(),
                    payload.iv,
                    conversationKey,
                    conversationId
                  )
                  mediaUrl = URL.createObjectURL(
                    new Blob([decryptedBuffer], { type: mediaMimeType })
                  )
                  mediaObjectUrlsRef.current.push(mediaUrl)
                } else {
                  console.error('Unable to download encrypted attachment:', downloadError)
                  displayText = `📎 ${mediaName} (download unavailable)`
                }
              }
            } catch (error) {
              // Ordinary text messages are not media payloads.
              if (error instanceof Error && error.name !== 'SyntaxError') {
                console.error('Unable to decrypt attachment:', error)
              }
            }

            return {
              id: row.id,
              text: displayText,
              time: formatTime(row.created_at),
              sender: row.sender_id === authUserId ? 'me' : 'them',
              reaction: myReaction?.reaction,
              reactedByMe: Boolean(myReaction),
              reactionCount: messageReactions.length,
              mediaUrl,
              mediaName,
              mediaMimeType,
              mediaSize
            }
          })
        )

        if (!active) return

        setConversations((previous) =>
          previous.map((chat) =>
            chat.id === selectedChat.id
              ? {
                  ...chat,
                  messages: decryptedMessages,
                  preview: decryptedMessages.length
                    ? decryptedMessages[decryptedMessages.length - 1].text
                    : 'No messages yet',
                  time: decryptedMessages.length
                    ? decryptedMessages[decryptedMessages.length - 1].time
                    : chat.time
                }
              : chat
          )
        )
      } catch (error) {
        if (active) {
          setMessageError(
            error instanceof Error ? error.message : 'Unable to load messages.'
          )
        }
      } finally {
        if (active) setMessagesLoading(false)
      }
    }

    void loadMessages()

    const channel = supabase
      .channel(`conversation-updates-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        () => void loadMessages()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        () => void loadMessages()
      )
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [authUserId, selectedId])

  // Authentication handlers.
  const handleLogin = async (): Promise<void> => {
    setAuthBusy(true)
    setAuthNotice('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword
      })

      if (error) throw error
      if (!data.session) throw new Error('Login succeeded but no session was returned.')

      setAuthUserId(data.user.id)
      setAuthEmail(data.user.email ?? authEmail.trim())
      setAuthName(
        (data.user.user_metadata?.full_name as string | undefined) ?? authName
      )
      setAuthPassword('')
      setScreen('dashboard')
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Unable to sign in.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignup = async (): Promise<void> => {
    if (authPassword !== confirmPassword) {
      setAuthNotice('Passwords do not match.')
      return
    }

    if (authPassword.length < 8) {
      setAuthNotice('Password must be at least 8 characters long.')
      return
    }

    setAuthBusy(true)
    setAuthNotice('')

    try {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
        options: {
          data: { full_name: authName.trim() }
        }
      })

      if (error) throw error

      setAuthPassword('')
      setConfirmPassword('')

      if (data.session) {
        setAuthUserId(data.user?.id ?? null)
        setAuthEmail(data.user?.email ?? authEmail.trim())
        setScreen('dashboard')
      } else {
        setAuthNotice(
          'Account created. Check your email for the verification link, then sign in.'
        )
        setScreen('login')
      }
    } catch (error) {
      setAuthNotice(
        error instanceof Error ? error.message : 'Unable to create your account.'
      )
    } finally {
      setAuthBusy(false)
    }
  }

  const handlePasswordReset = async (): Promise<void> => {
    setAuthBusy(true)
    setAuthNotice('')

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail.trim())
      if (error) throw error
      setAuthNotice(
        'If an account exists for that email, a password reset link has been sent.'
      )
    } catch (error) {
      setAuthNotice(
        error instanceof Error ? error.message : 'Unable to send the reset link.'
      )
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = async (): Promise<void> => {
    setAuthBusy(true)
    setAuthNotice('')

    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Unable to sign out.')
    } finally {
      setAuthBusy(false)
    }
  }

  // Search for other registered users.
  const searchUsers = async (): Promise<void> => {
    const query = userSearch.trim()

    if (!query) {
      setUserResults([])
      setNewChatNotice('Enter a name to search for users.')
      return
    }

    setUserSearchBusy(true)
    setNewChatNotice('')

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .neq('id', authUserId ?? '')
        .ilike('full_name', `%${query}%`)
        .limit(10)

      if (error) throw error

      setUserResults(data ?? [])

      if (!data?.length) {
        setNewChatNotice('No other users found. Check the name and try again.')
      }
    } catch (error) {
      setNewChatNotice(
        error instanceof Error ? error.message : 'Unable to search users.'
      )
    } finally {
      setUserSearchBusy(false)
    }
  }

  // Search registered users for group membership.
  const searchGroupUsers = async (): Promise<void> => {
    const query = groupUserSearch.trim()
    if (!query) {
      setGroupUserResults([])
      setGroupNotice('Enter a name to search for members.')
      return
    }

    setGroupSearchBusy(true)
    setGroupNotice('')
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .neq('id', authUserId ?? '')
        .ilike('full_name', `%${query}%`)
        .limit(20)
      if (error) throw error
      setGroupUserResults(data ?? [])
      if (!data?.length) setGroupNotice('No users found.')
    } catch (error) {
      setGroupNotice(error instanceof Error ? error.message : 'Unable to search users.')
    } finally {
      setGroupSearchBusy(false)
    }
  }

  // Create a direct conversation in Supabase.
  const startDirectChat = async (otherUser: {
    id: string
    full_name: string | null
  }): Promise<void> => {
    if (!authUserId || otherUser.id === authUserId) return

    setCreatingChatFor(otherUser.id)
    setNewChatNotice('')

    try {
      const { data: myMemberships, error: myMembershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', authUserId)

      if (myMembershipError) throw myMembershipError

      const myConversationIds = (myMemberships ?? []).map(
        (membership) => membership.conversation_id
      )

      if (myConversationIds.length > 0) {
        const { data: theirMemberships, error: theirMembershipError } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', otherUser.id)
          .in('conversation_id', myConversationIds)

        if (theirMembershipError) throw theirMembershipError

        const sharedIds = (theirMemberships ?? []).map(
          (membership) => membership.conversation_id
        )

        if (sharedIds.length > 0) {
          const { data: sharedConversations, error: sharedError } = await supabase
            .from('conversations')
            .select('id, type')
            .in('id', sharedIds)
            .eq('type', 'direct')

          if (sharedError) throw sharedError

          const existingId = sharedConversations?.[0]?.id

          if (existingId) {
            setSelectedId(existingId)
            setShowNewChat(false)
            return
          }
        }
      }

      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          name: null,
          created_by: authUserId
        })
        .select('id, created_at')
        .single()

      if (conversationError) throw conversationError

      const { error: membersError } = await supabase
        .from('conversation_members')
        .insert([
          { conversation_id: conversation.id, user_id: authUserId },
          { conversation_id: conversation.id, user_id: otherUser.id }
        ])

      if (membersError) {
        await supabase
          .from('conversations')
          .delete()
          .eq('id', conversation.id)

        throw membersError
      }

      const displayName = otherUser.full_name || 'CipherChat User'

      const newConversation: Conversation = {
        id: conversation.id,
        name: displayName,
        type: 'direct',
        avatar: getInitials(displayName),
        color: 'purple',
        preview: 'No messages yet',
        time: formatTime(conversation.created_at),
        unread: 0,
        members: 2,
        messages: []
      }

      setConversations((previous) => [
        newConversation,
        ...previous.filter((chat) => chat.id !== conversation.id)
      ])

      setSelectedId(conversation.id)
      setShowNewChat(false)
      setUserSearch('')
      setUserResults([])
      setNewChatNotice(`Conversation created with ${displayName}.`)
    } catch (error) {
      setNewChatNotice(
        error instanceof Error ? error.message : 'Unable to create conversation.'
      )
    } finally {
      setCreatingChatFor(null)
    }
  }

  // Encrypt and send a message in either a direct or group conversation.
  const sendMessage = async (): Promise<void> => {
    const trimmedMessage = message.trim()
    if (!trimmedMessage || !selectedChat || !authUserId) return
    setMessageError('')

    try {
      const conversationId = String(selectedChat.id)
      const conversationKey = await getConversationEncryptionKey(
        conversationId,
        selectedChat.type
      )
      const encrypted = await encryptMessage(
        trimmedMessage,
        conversationKey,
        conversationId
      )

      const { error: insertError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: authUserId,
        ciphertext: JSON.stringify(encrypted)
      })
      if (insertError) throw insertError
      setMessage('')

      const { data: rows, error: fetchError } = await supabase
        .from('messages')
        .select('id, sender_id, ciphertext, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (fetchError) throw fetchError

      const decryptedMessages: Message[] = await Promise.all(
        (rows ?? []).map(async (row) => ({
          id: row.id,
          text: await decryptMessage(
            JSON.parse(row.ciphertext) as EncryptedMessage,
            conversationKey,
            conversationId
          ),
          time: formatTime(row.created_at),
          sender: row.sender_id === authUserId ? 'me' : 'them'
        }))
      )

      setConversations((previous) =>
        previous.map((chat) => {
          if (chat.id !== selectedChat.id) return chat
          return {
            ...chat,
            messages: decryptedMessages.map((newMessage) => {
              const oldMessage = chat.messages.find((item) => item.id === newMessage.id)
              return {
                ...newMessage,
                reaction: oldMessage?.reaction,
                reactedByMe: oldMessage?.reactedByMe,
                reactionCount: oldMessage?.reactionCount
              }
            }),
            preview: trimmedMessage,
            time: 'Now'
          }
        })
      )
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : 'Unable to send message.')
    }
  }

  // Encrypt selected files locally, upload ciphertext, then send encrypted metadata.
  const handleMediaSelection = async (
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || !selectedChat || !authUserId) return

    const MAX_FILE_SIZE = 25 * 1024 * 1024
    const oversized = files.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setMessageError(`${oversized.name} is larger than the 25 MB limit.`)
      return
    }

    setMediaBusy(true)
    setMessageError('')
    const conversationId = String(selectedChat.id)
    const uploadedMessages: Message[] = []

    try {
      const conversationKey = await getConversationEncryptionKey(
        conversationId,
        selectedChat.type
      )

      for (const file of files) {
        const encryptedFile = await encryptMedia(file, conversationKey, conversationId)
        const storagePath = `${conversationId}/${authUserId}/${crypto.randomUUID()}`
        const encryptedBlob = new Blob([encryptedFile.ciphertext], {
          type: 'application/octet-stream'
        })

        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(storagePath, encryptedBlob, {
            contentType: 'application/octet-stream',
            upsert: false
          })
        if (uploadError) throw uploadError

        const mediaPayload = JSON.stringify({
          kind: 'cipherchat-media',
          version: 1,
          path: storagePath,
          iv: encryptedFile.iv,
          name: encryptedFile.originalName,
          mimeType: encryptedFile.mimeType,
          size: file.size
        })
        const encryptedMetadata = await encryptMessage(
          mediaPayload,
          conversationKey,
          conversationId
        )

        const { data: inserted, error: insertError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_id: authUserId,
            ciphertext: JSON.stringify(encryptedMetadata)
          })
          .select('id, created_at')
          .single()

        if (insertError) {
          await supabase.storage.from('chat-media').remove([storagePath])
          throw insertError
        }

        const localUrl = URL.createObjectURL(file)
        mediaObjectUrlsRef.current.push(localUrl)
        uploadedMessages.push({
          id: inserted.id,
          text: `📎 ${file.name}`,
          time: formatTime(inserted.created_at),
          sender: 'me',
          mediaUrl: localUrl,
          mediaName: file.name,
          mediaMimeType: file.type || 'application/octet-stream',
          mediaSize: file.size
        })
      }

      setConversations((previous) => previous.map((chat) => {
        if (chat.id !== selectedChat.id) return chat
        const updatedMessages = [...chat.messages, ...uploadedMessages]
        return {
          ...chat,
          messages: updatedMessages,
          preview: uploadedMessages.length === 1
            ? `📎 ${uploadedMessages[0].mediaName}`
            : `📎 ${uploadedMessages.length} attachments`,
          time: 'Now'
        }
      }))
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : 'Unable to upload attachment.')
    } finally {
      setMediaBusy(false)
    }
  }

  // Persistently add or remove the current user's heart reaction.
  const addReaction = async (messageId: string | number): Promise<void> => {
    if (!authUserId || !selectedChat || selectedChat.type !== 'direct') return

    const id = String(messageId)

    if (reactionBusy === id) return

    setReactionBusy(id)
    setMessageError('')

    try {
      const { data: existingReaction, error: lookupError } = await supabase
        .from('message_reactions')
        .select('id')
        .eq('message_id', id)
        .eq('user_id', authUserId)
        .maybeSingle()

      if (lookupError) throw lookupError

      if (existingReaction) {
        const { error: deleteError } = await supabase
          .from('message_reactions')
          .delete()
          .eq('id', existingReaction.id)

        if (deleteError) throw deleteError

        setConversations((previous) =>
          previous.map((chat) =>
            chat.id === selectedChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((item) =>
                    item.id === messageId
                      ? {
                          ...item,
                          reaction: undefined,
                          reactedByMe: false,
                          reactionCount: Math.max(
                            0,
                            (item.reactionCount ?? 1) - 1
                          )
                        }
                      : item
                  )
                }
              : chat
          )
        )
      } else {
        const { error: insertError } = await supabase
          .from('message_reactions')
          .insert({
            message_id: id,
            user_id: authUserId,
            reaction: '❤️'
          })

        if (insertError) throw insertError

        setConversations((previous) =>
          previous.map((chat) =>
            chat.id === selectedChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((item) =>
                    item.id === messageId
                      ? {
                          ...item,
                          reaction: '❤️',
                          reactedByMe: true,
                          reactionCount: (item.reactionCount ?? 0) + 1
                        }
                      : item
                  )
                }
              : chat
          )
        )
      }
    } catch (error) {
      setMessageError(
        error instanceof Error
          ? error.message
          : 'Unable to update reaction.'
      )
    } finally {
      setReactionBusy(null)
    }
  }

  // Create a Supabase group and securely wrap its group key for each member.
  const createGroup = async (): Promise<void> => {
    const name = groupName.trim()
    if (!authUserId || !name) return
    if (selectedGroupMembers.length === 0) {
      setGroupNotice('Select at least one member.')
      return
    }

    setGroupCreateBusy(true)
    setGroupNotice('')
    try {
      const storedIdentity = await window.api.secureStorage.load(authUserId)
      if (!storedIdentity) throw new Error('Your encryption identity is missing.')
      const identity = JSON.parse(storedIdentity) as { privateKey: string }
      if (!identity.privateKey) throw new Error('Your private encryption key is invalid.')

      const { data: conversationId, error: createError } = await supabase.rpc(
        'create_chat_group',
        { p_name: name, p_member_ids: selectedGroupMembers }
      )
      if (createError) throw createError
      if (!conversationId) throw new Error('Group creation failed.')

      const { data: members, error: membersError } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
      if (membersError) throw membersError

      const memberIds = (members ?? []).map((member) => member.user_id)
      const { data: publicKeys, error: keysError } = await supabase
        .from('user_public_keys')
        .select('user_id, public_key')
        .in('user_id', memberIds)
      if (keysError) throw keysError

      const publicKeyMap = new Map<string, PublicKey>(
        (publicKeys ?? []).map((row) => [row.user_id, JSON.parse(row.public_key) as PublicKey])
      )
      for (const memberId of memberIds) {
        if (!publicKeyMap.has(memberId)) {
          throw new Error('A selected member has not initialized encryption. Ask them to sign in again.')
        }
      }

      const { rawKey } = await generateGroupKey()
      const keyRows = await Promise.all(
        memberIds.map(async (memberId) => {
          const publicKey = publicKeyMap.get(memberId)
          if (!publicKey) throw new Error('A member public key is missing.')
          const envelope = await wrapGroupKey(
            rawKey,
            identity.privateKey,
            publicKey,
            conversationId
          )
          return {
            conversation_id: conversationId,
            user_id: memberId,
            encrypted_key: JSON.stringify(envelope)
          }
        })
      )

      const { error: insertKeysError } = await supabase
        .from('conversation_keys')
        .insert(keyRows)
      if (insertKeysError) throw insertKeysError

      const newGroup: Conversation = {
        id: conversationId,
        name,
        type: 'group',
        avatar: getInitials(name),
        color: 'blue',
        preview: 'No messages yet',
        time: 'Now',
        unread: 0,
        members: memberIds.length,
        messages: []
      }
      setConversations((previous) => [newGroup, ...previous.filter((chat) => chat.id !== conversationId)])
      setSelectedId(conversationId)
      setGroupName('')
      setGroupUserSearch('')
      setGroupUserResults([])
      setSelectedGroupMembers([])
      setShowNewGroup(false)
    } catch (error) {
      setGroupNotice(error instanceof Error ? error.message : 'Unable to create group.')
    } finally {
      setGroupCreateBusy(false)
    }
  }

  // Authentication screens.
  if (!authReady) {
    return <main className={`auth-screen ${darkMode ? 'dark' : 'light'}`} />
  }

  if (screen !== 'dashboard') {
    return (
      <main className={`auth-screen ${darkMode ? 'dark' : 'light'}`}>
        <div className="auth-brand">
          <div className="brand-icon">C</div>
          <div>
            <h1>CipherChat</h1>
            <span>PRIVATE MESSAGING</span>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-symbol">C</div>

          {screen === 'login' && (
            <>
              <div className="auth-heading">
                <h2>Welcome back</h2>
                <p>Sign in to continue to your private conversations.</p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleLogin()
                }}
              >
                <label htmlFor="login-email">EMAIL ADDRESS</label>
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  autoComplete="email"
                  required
                />

                <div className="auth-label-row">
                  <label htmlFor="login-password">PASSWORD</label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setAuthNotice('')
                      setScreen('forgot')
                    }}
                  >
                    Forgot password?
                  </button>
                </div>

                <input
                  id="login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />

                {authNotice && <p className="auth-notice">{authNotice}</p>}

                <button className="auth-submit" type="submit" disabled={authBusy}>
                  {authBusy ? 'Signing in...' : 'Sign in'} <span>→</span>
                </button>
              </form>

              <p className="auth-switch">
                Don't have an account?{' '}
                <button
                  onClick={() => {
                    setAuthNotice('')
                    setScreen('signup')
                  }}
                >
                  Create account
                </button>
              </p>
            </>
          )}

          {screen === 'signup' && (
            <>
              <div className="auth-heading">
                <h2>Create your account</h2>
                <p>Join CipherChat and start private conversations.</p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSignup()
                }}
              >
                <label htmlFor="signup-name">FULL NAME</label>
                <input
                  id="signup-name"
                  type="text"
                  placeholder="Your name"
                  value={authName}
                  onChange={(event) => setAuthName(event.target.value)}
                  autoComplete="name"
                  required
                />

                <label htmlFor="signup-email">EMAIL ADDRESS</label>
                <input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  autoComplete="email"
                  required
                />

                <label htmlFor="signup-password">PASSWORD</label>
                <input
                  id="signup-password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />

                <label htmlFor="confirm-password">CONFIRM PASSWORD</label>
                <input
                  id="confirm-password"
                  type="password"
                  placeholder="Enter password again"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />

                {authNotice && <p className="auth-error">{authNotice}</p>}

                <button className="auth-submit" type="submit" disabled={authBusy}>
                  {authBusy ? 'Creating account...' : 'Create account'} <span>→</span>
                </button>
              </form>

              <p className="auth-switch">
                Already have an account?{' '}
                <button
                  onClick={() => {
                    setAuthNotice('')
                    setScreen('login')
                  }}
                >
                  Sign in
                </button>
              </p>
            </>
          )}

          {screen === 'forgot' && (
            <>
              <div className="auth-heading">
                <h2>Reset your password</h2>
                <p>
                  Enter your email address. We'll help you get back into your
                  account.
                </p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void handlePasswordReset()
                }}
              >
                <label htmlFor="forgot-email">EMAIL ADDRESS</label>
                <input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  autoComplete="email"
                  required
                />

                {authNotice && <p className="auth-notice">{authNotice}</p>}

                <button className="auth-submit" type="submit" disabled={authBusy}>
                  {authBusy ? 'Sending...' : 'Send reset link'} <span>→</span>
                </button>
              </form>

              <p className="auth-switch">
                Remember your password?{' '}
                <button
                  onClick={() => {
                    setAuthNotice('')
                    setScreen('login')
                  }}
                >
                  Back to login
                </button>
              </p>
            </>
          )}

          <div className="auth-security">
            <span>♢</span>
            Your privacy matters. Built for secure conversations.
          </div>
        </div>

        <div className="auth-footer">CIPHERCHAT · PRIVATE MESSAGING</div>
      </main>
    )
  }

  // Main dashboard.
  return (
    <main className={`app ${darkMode ? 'dark' : 'light'}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">C</div>
          <div>
            <h1>CipherChat</h1>
            <span>PRIVATE MESSAGING</span>
          </div>
        </div>

        <div className="sidebar-actions">
          <button
            className="new-chat-button"
            onClick={() => {
              setNewChatNotice('')
              setUserSearch('')
              setUserResults([])
              setShowNewChat(true)
            }}
          >
            <span>＋</span> New chat
          </button>

          <button className="new-chat-button" onClick={() => {
            setGroupName('')
            setGroupUserSearch('')
            setGroupUserResults([])
            setSelectedGroupMembers([])
            setGroupNotice('')
            setShowNewGroup(true)
          }}>
            <span>＋</span> New group
          </button>
        </div>

        <div className="conversation-heading">
          <span>MESSAGES</span>
          <span className="conversation-count">{conversations.length}</span>
        </div>

        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations..."
          />
          <kbd>⌘ K</kbd>
        </div>

        <div className="chat-list">
          {conversationLoading && (
            <p className="empty-search">Loading conversations...</p>
          )}

          {conversationError && (
            <p className="empty-search">{conversationError}</p>
          )}

          {filteredConversations.map((chat) => (
            <button
              className={`chat-item ${selectedId === chat.id ? 'selected' : ''}`}
              key={chat.id}
              onClick={() => setSelectedId(chat.id)}
            >
              <div className={`avatar ${chat.color}`}>{chat.avatar}</div>

              <div className="chat-item-content">
                <div className="chat-item-top">
                  <span className="chat-name">{chat.name}</span>
                  <span className="chat-time">{chat.time}</span>
                </div>

                <div className="chat-item-bottom">
                  <span className="chat-preview">{chat.preview}</span>
                  {chat.unread > 0 && (
                    <span className="unread">{chat.unread}</span>
                  )}
                </div>

                {chat.type === 'group' && (
                  <span className="group-label">
                    GROUP · {chat.members} MEMBERS
                  </span>
                )}
              </div>
            </button>
          ))}

          {!conversationLoading && filteredConversations.length === 0 && (
            <p className="empty-search">
              {search ? 'No conversations found.' : 'No conversations yet. Start a new chat!'}
            </p>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="profile-avatar">{getInitials(authName)}</div>

          <div className="profile-info">
            <strong>{authName || 'Your Profile'}</strong>
            <span>{authEmail || 'My account'}</span>
          </div>

          <button
            className="theme-button"
            title="Sign out"
            onClick={() => void handleSignOut()}
            disabled={authBusy}
          >
            ↪
          </button>

          <button
            className="theme-button"
            title="Toggle theme"
            onClick={() => setDarkMode((value) => !value)}
          >
            {darkMode ? '☀' : '☾'}
          </button>
        </div>
      </aside>

      <section className="chat-panel">
        {selectedChat ? (
          <>
            <header className="chat-header">
              <div className={`avatar ${selectedChat.color}`}>
                {selectedChat.avatar}
              </div>

              <div className="header-info">
                <h2>{selectedChat.name}</h2>
                <span>
                  {selectedChat.type === 'group'
                    ? `${selectedChat.members} members · Group conversation`
                    : 'Direct conversation'}
                </span>
              </div>

              <div className="header-actions">
                <button title="Search messages">⌕</button>
                <button title="More options">···</button>
              </div>
            </header>

            <div className="encryption-notice">
              <span>♢</span>
              Messages in CipherChat are encrypted before storage.
              <span className="demo-label">DEMO</span>
            </div>

            <div className="messages-area">
              <div className="date-divider">
                <span>TODAY</span>
              </div>

              {messagesLoading && (
                <p className="empty-search">Loading messages...</p>
              )}

              {messageError && (
                <p className="auth-error">{messageError}</p>
              )}

              {selectedChat.messages.length === 0 && !messagesLoading && (
                <p className="empty-search">
                  No messages yet. Start the conversation!
                </p>
              )}

              {selectedChat.messages.map((item) => (
                <div
                  className={`message-row ${item.sender === 'me' ? 'mine' : 'theirs'}`}
                  key={item.id}
                >
                  {item.sender === 'them' && (
                    <div className={`message-avatar ${selectedChat.color}`}>
                      {selectedChat.avatar}
                    </div>
                  )}

                  <div className="message-content">
                    <div className="message-bubble">
                      {item.mediaUrl && item.mediaMimeType?.startsWith('image/') ? (
                        <a href={item.mediaUrl} target="_blank" rel="noreferrer" download={item.mediaName}>
                          <img
                            src={item.mediaUrl}
                            alt={item.mediaName || 'Shared image'}
                            style={{ display: 'block', maxWidth: 'min(320px, 100%)', maxHeight: 280, borderRadius: 8, objectFit: 'contain' }}
                          />
                        </a>
                      ) : item.mediaUrl && item.mediaMimeType?.startsWith('video/') ? (
                        <video src={item.mediaUrl} controls style={{ display: 'block', maxWidth: 'min(360px, 100%)', maxHeight: 280, borderRadius: 8 }} />
                      ) : item.mediaUrl && item.mediaMimeType?.startsWith('audio/') ? (
                        <audio src={item.mediaUrl} controls />
                      ) : item.mediaUrl ? (
                        <a href={item.mediaUrl} download={item.mediaName || 'attachment'} style={{ color: 'inherit' }}>
                          📎 {item.mediaName || 'Download attachment'}
                          {item.mediaSize ? ` · ${(item.mediaSize / (1024 * 1024)).toFixed(2)} MB` : ''}
                        </a>
                      ) : (
                        item.text
                      )}
                    </div>

                    <div className="message-meta">
                      <span>{item.time}</span>
                      {item.sender === 'me' && (
                        <span className="read-status">✓✓</span>
                      )}

                      <button
                        className="reaction-button"
                        title={
                          item.reactedByMe
                            ? 'Remove your heart reaction'
                            : 'React with heart'
                        }
                        disabled={
                          selectedChat.type !== 'direct' ||
                          reactionBusy === String(item.id)
                        }
                        onClick={() => void addReaction(item.id)}
                        aria-pressed={Boolean(item.reactedByMe)}
                      >
                        {item.reactionCount ? (
                          <>
                            <span>{item.reactedByMe ? '❤️' : '♡'}</span>
                            <span>{item.reactionCount}</span>
                          </>
                        ) : (
                          '＋'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="composer-area">
              <div className="composer">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(event) => void handleMediaSelection(event)}
                />
                <button
                  type="button"
                  className="composer-tool"
                  title="Attach files (maximum 25 MB each)"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={mediaBusy}
                >
                  {mediaBusy ? '…' : '＋'}
                </button>

                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                  placeholder={`Message ${selectedChat.name}...`}
                />

                <button className="composer-tool" title="Emoji">
                  ☺
                </button>

                <button
                  className="send-button"
                  onClick={() => void sendMessage()}
                  disabled={!message.trim()}
                  title="Send message"
                >
                  ↑
                </button>
              </div>

              <p className="composer-hint">
                {mediaBusy ? 'Encrypting and uploading files…' : 'Press Enter to send · Messages and attachments are encrypted'}
              </p>
            </div>
          </>
        ) : (
          <div className="empty-chat">
            <div className="empty-chat-icon">C</div>
            <h2>Welcome to CipherChat</h2>
            <p>Select a conversation to start messaging.</p>
          </div>
        )}
      </section>

      {/* New direct chat modal */}
      {showNewChat && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!creatingChatFor) setShowNewChat(false)
          }}
        >
          <div
            className="group-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Start a new chat</h2>
                <p>Find another registered CipherChat user by their name.</p>
              </div>

              <button
                onClick={() => setShowNewChat(false)}
                disabled={creatingChatFor !== null}
              >
                ×
              </button>
            </div>

            <label htmlFor="user-search">USER NAME</label>
            <div className="search-box">
              <span>⌕</span>
              <input
                id="user-search"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void searchUsers()
                  }
                }}
                placeholder="Enter the person's full name"
                autoFocus
              />
            </div>

            <button
              className="create-button"
              onClick={() => void searchUsers()}
              disabled={userSearchBusy || !userSearch.trim()}
            >
              {userSearchBusy ? 'Searching...' : 'Search users'}
            </button>

            {newChatNotice && (
              <p className="modal-note" role="status">{newChatNotice}</p>
            )}

            {userResults.length > 0 && (
              <div className="chat-list">
                {userResults.map((user) => (
                  <div
                    className="chat-item"
                    key={user.id}
                    style={{ cursor: 'default' }}
                  >
                    <div className="avatar blue">
                      {getInitials(user.full_name || 'User')}
                    </div>

                    <div className="chat-item-content">
                      <div className="chat-item-top">
                        <span className="chat-name">
                          {user.full_name || 'Unnamed user'}
                        </span>
                      </div>
                    </div>

                    <button
                      className="create-button"
                      onClick={() => void startDirectChat(user)}
                      disabled={creatingChatFor !== null}
                    >
                      {creatingChatFor === user.id ? 'Creating...' : 'Start chat'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={() => setShowNewChat(false)}
                disabled={creatingChatFor !== null}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create encrypted group modal */}
      {showNewGroup && (
        <div className="modal-backdrop" onClick={() => { if (!groupCreateBusy) setShowNewGroup(false) }}>
          <div className="group-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Create a group</h2>
                <p>Choose a name and add registered CipherChat users.</p>
              </div>
              <button onClick={() => setShowNewGroup(false)} disabled={groupCreateBusy}>×</button>
            </div>

            <label htmlFor="group-name">GROUP NAME</label>
            <input
              id="group-name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="e.g. Project Team"
              autoFocus
            />

            <label htmlFor="group-user-search">ADD MEMBERS</label>
            <div className="search-box">
              <span>⌕</span>
              <input
                id="group-user-search"
                value={groupUserSearch}
                onChange={(event) => setGroupUserSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void searchGroupUsers()
                  }
                }}
                placeholder="Search by name"
              />
            </div>
            <button
              className="create-button"
              onClick={() => void searchGroupUsers()}
              disabled={groupSearchBusy || !groupUserSearch.trim() || groupCreateBusy}
            >
              {groupSearchBusy ? 'Searching...' : 'Search users'}
            </button>

            {groupUserResults.length > 0 && (
              <div className="chat-list">
                {groupUserResults.map((user) => {
                  const isSelected = selectedGroupMembers.includes(user.id)
                  return (
                    <button
                      type="button"
                      className="chat-item"
                      key={user.id}
                      onClick={() => setSelectedGroupMembers((previous) =>
                        isSelected ? previous.filter((id) => id !== user.id) : [...previous, user.id]
                      )}
                    >
                      <div className="avatar blue">{getInitials(user.full_name || 'User')}</div>
                      <div className="chat-item-content">
                        <div className="chat-item-top">
                          <span className="chat-name">{user.full_name || 'Unnamed user'}</span>
                        </div>
                      </div>
                      <span>{isSelected ? '✓ Selected' : '＋ Add'}</span>
                    </button>
                  )
                })}
              </div>
            )}

            <p className="modal-note">
              {selectedGroupMembers.length} member(s) selected. Group messages are encrypted with a shared group key.
            </p>
            {groupNotice && <p className="modal-note" role="status">{groupNotice}</p>}

            <div className="modal-actions">
              <button className="cancel-button" onClick={() => setShowNewGroup(false)} disabled={groupCreateBusy}>Cancel</button>
              <button
                className="create-button"
                onClick={() => void createGroup()}
                disabled={!groupName.trim() || selectedGroupMembers.length === 0 || groupCreateBusy}
              >
                {groupCreateBusy ? 'Creating...' : 'Create group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
