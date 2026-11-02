import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './assets/main.css'

type Message = {
  id: number
  text: string
  time: string
  sender: 'me' | 'them'
  reaction?: string
}

type Conversation = {
  id: number
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

const initialConversations: Conversation[] = [
  {
    id: 1,
    name: 'Alex Morgan',
    type: 'direct',
    avatar: 'AM',
    color: 'purple',
    preview: 'That sounds like a great idea!',
    time: '10:42',
    unread: 2,
    messages: [
      { id: 1, text: 'Hey! How is the project going?', time: '10:38', sender: 'them' },
      { id: 2, text: 'Pretty good! Working on the new interface.', time: '10:40', sender: 'me' },
      { id: 3, text: 'That sounds like a great idea!', time: '10:42', sender: 'them' }
    ]
  },
  {
    id: 2,
    name: 'Project Team',
    type: 'group',
    avatar: 'PT',
    color: 'blue',
    preview: 'You: I will share the update',
    time: '09:30',
    unread: 0,
    members: 5,
    messages: [
      { id: 1, text: 'Welcome everyone to the project group!', time: '09:15', sender: 'them' },
      { id: 2, text: 'Thanks! Excited to work together.', time: '09:20', sender: 'me' },
      { id: 3, text: 'I will share the update shortly.', time: '09:30', sender: 'me' }
    ]
  },
  {
    id: 3,
    name: 'Sarah Johnson',
    type: 'direct',
    avatar: 'SJ',
    color: 'orange',
    preview: 'Sent you a document',
    time: 'Yesterday',
    unread: 0,
    messages: [
      { id: 1, text: 'I have finished the document.', time: '16:20', sender: 'them' },
      { id: 2, text: 'Great, thank you!', time: '16:25', sender: 'me' }
    ]
  },
  {
    id: 4,
    name: 'Design Circle',
    type: 'group',
    avatar: 'DC',
    color: 'green',
    preview: 'New design concepts are ready',
    time: 'Yesterday',
    unread: 0,
    members: 8,
    messages: [
      { id: 1, text: 'New design concepts are ready.', time: '15:10', sender: 'them' }
    ]
  },
  {
    id: 5,
    name: 'David Wilson',
    type: 'direct',
    avatar: 'DW',
    color: 'pink',
    preview: 'See you tomorrow!',
    time: 'Mon',
    unread: 0,
    messages: [
      { id: 1, text: 'See you tomorrow!', time: '18:00', sender: 'them' }
    ]
  }
]

function App(): React.JSX.Element {
  // Authentication state
  const [screen, setScreen] = useState<'login' | 'signup' | 'forgot' | 'dashboard'>('login')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  // Restore an existing Supabase session and listen for auth changes.
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
          setScreen('login')
        }
      }
    )

    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  // Load the authenticated user's profile from the Supabase profiles table.
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

      if (data?.full_name) {
        setAuthName(data.full_name)
      }
    }

    void loadProfile()

    return () => {
      active = false
    }
  }, [authUserId])

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
        setAuthNotice('Account created. Check your email for the verification link, then sign in.')
        setScreen('login')
      }
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Unable to create your account.')
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
      setAuthNotice('If an account exists for that email, a password reset link has been sent.')
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Unable to send the reset link.')
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
      // The onAuthStateChange listener switches the app to the login screen.
    } catch (error) {
      setAuthNotice(
        error instanceof Error ? error.message : 'Unable to sign out.'
      )
    } finally {
      setAuthBusy(false)
    }
  }

  // Dashboard state
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState(1)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [darkMode, setDarkMode] = useState(true)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupMembers, setGroupMembers] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<
    { id: string; full_name: string | null }[]
  >([])
  const [userSearchBusy, setUserSearchBusy] = useState(false)
  const [creatingChatFor, setCreatingChatFor] = useState<string | null>(null)
  const [newChatNotice, setNewChatNotice] = useState('')

  const selectedChat = conversations.find((chat) => chat.id === selectedId)

  const filteredConversations = useMemo(
    () =>
      conversations.filter((chat) =>
        chat.name.toLowerCase().includes(search.toLowerCase())
      ),
    [conversations, search]
  )

  if (!authReady) {
    return <main className={`auth-screen ${darkMode ? 'dark' : 'light'}`} />
  }

  // Search for other registered CipherChat users by their profile name.
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

  // Create a Supabase direct conversation and add both users as members.
  const startDirectChat = async (otherUser: {
    id: string
    full_name: string | null
  }): Promise<void> => {
    if (!authUserId || otherUser.id === authUserId) return

    setCreatingChatFor(otherUser.id)
    setNewChatNotice('')

    try {
      // Reuse an existing direct conversation if both users already share one.
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

        const sharedConversationId = theirMemberships?.[0]?.conversation_id

        if (sharedConversationId) {
          setNewChatNotice('A conversation with this user already exists.')
          return
        }
      }

      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          name: null,
          created_by: authUserId
        })
        .select('id')
        .single()

      if (conversationError) throw conversationError

      const { error: membersError } = await supabase
        .from('conversation_members')
        .insert([
          { conversation_id: conversation.id, user_id: authUserId },
          { conversation_id: conversation.id, user_id: otherUser.id }
        ])

      if (membersError) {
        // Avoid leaving an inaccessible, half-created conversation behind.
        await supabase
          .from('conversations')
          .delete()
          .eq('id', conversation.id)
        throw membersError
      }

      setNewChatNotice(
        `Conversation created with ${otherUser.full_name || 'this user'}.`
      )
      setShowNewChat(false)
      setUserSearch('')
      setUserResults([])
    } catch (error) {
      setNewChatNotice(
        error instanceof Error ? error.message : 'Unable to create conversation.'
      )
    } finally {
      setCreatingChatFor(null)
    }
  }

  // Send message
  const sendMessage = (): void => {
    const trimmedMessage = message.trim()
    if (!trimmedMessage || !selectedChat) return

    const newMessage: Message = {
      id: Date.now(),
      text: trimmedMessage,
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      sender: 'me'
    }

    setConversations((previous) =>
      previous.map((chat) =>
        chat.id === selectedId
          ? {
              ...chat,
              messages: [...chat.messages, newMessage],
              preview: trimmedMessage,
              time: 'Now'
            }
          : chat
      )
    )

    setMessage('')
  }

  // Create group
  const createGroup = (): void => {
    const name = groupName.trim()
    if (!name) return

    const memberCount =
      groupMembers.split(',').filter((member) => member.trim()).length + 1

    const newGroup: Conversation = {
      id: Date.now(),
      name,
      type: 'group',
      avatar: name.slice(0, 2).toUpperCase(),
      color: 'blue',
      preview: 'Group created',
      time: 'Now',
      unread: 0,
      members: memberCount,
      messages: [
        {
          id: Date.now(),
          text: `Welcome to ${name}!`,
          time: 'Now',
          sender: 'them'
        }
      ]
    }

    setConversations((previous) => [newGroup, ...previous])
    setSelectedId(newGroup.id)
    setGroupName('')
    setGroupMembers('')
    setShowNewGroup(false)
  }

  // Add or remove a heart reaction
  const addReaction = (messageId: number): void => {
    setConversations((previous) =>
      previous.map((chat) =>
        chat.id === selectedId
          ? {
              ...chat,
              messages: chat.messages.map((item) =>
                item.id === messageId
                  ? { ...item, reaction: item.reaction ? undefined : '❤️' }
                  : item
              )
            }
          : chat
      )
    )
  }

  // ==========================================
  // AUTHENTICATION SCREENS
  // ==========================================

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

          {/* LOGIN */}
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

          {/* SIGNUP */}
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

                {authNotice && (
                  <p className="auth-error">{authNotice}</p>
                )}

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

          {/* FORGOT PASSWORD */}
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

                {authNotice && (
                  <p className="auth-notice">{authNotice}</p>
                )}

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

        <div className="auth-footer">
          CIPHERCHAT · PRIVATE MESSAGING
        </div>
      </main>
    )
  }

  // ==========================================
  // MAIN CIPHERCHAT DASHBOARD
  // ==========================================

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
          <button className="new-chat-button" onClick={() => {
            setNewChatNotice('')
            setUserSearch('')
            setUserResults([])
            setShowNewChat(true)
          }}>
            <span>＋</span> New chat
          </button>
          <button className="new-chat-button" onClick={() => setShowNewGroup(true)}>
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

          {filteredConversations.length === 0 && (
            <p className="empty-search">No conversations found.</p>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="profile-avatar">
            {(authName.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2) || 'CC').toUpperCase()}
          </div>

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
              Messages in CipherChat are designed to be private and encrypted.
              <span className="demo-label">DEMO</span>
            </div>

            <div className="messages-area">
              <div className="date-divider">
                <span>TODAY</span>
              </div>

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
                    <div className="message-bubble">{item.text}</div>

                    <div className="message-meta">
                      <span>{item.time}</span>
                      {item.sender === 'me' && (
                        <span className="read-status">✓✓</span>
                      )}

                      <button
                        className="reaction-button"
                        title="React with heart"
                        onClick={() => addReaction(item.id)}
                      >
                        {item.reaction || '＋'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="composer-area">
              <div className="composer">
                <button className="composer-tool" title="Attach file">
                  ＋
                </button>

                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      sendMessage()
                    }
                  }}
                  placeholder={`Message ${selectedChat.name}...`}
                />

                <button className="composer-tool" title="Emoji">
                  ☺
                </button>

                <button
                  className="send-button"
                  onClick={sendMessage}
                  disabled={!message.trim()}
                  title="Send message"
                >
                  ↑
                </button>
              </div>

              <p className="composer-hint">
                Press <kbd>Enter</kbd> to send · Your messages are local demo data
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

      {/* NEW DIRECT CHAT MODAL */}
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
                      {(user.full_name || 'U')
                        .trim()
                        .split(/\s+/)
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
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

      {/* CREATE GROUP MODAL */}
      {showNewGroup && (
        <div
          className="modal-backdrop"
          onClick={() => setShowNewGroup(false)}
        >
          <div
            className="group-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Create a group</h2>
                <p>Start a private conversation with multiple people.</p>
              </div>

              <button onClick={() => setShowNewGroup(false)}>×</button>
            </div>

            <label htmlFor="group-name">GROUP NAME</label>
            <input
              id="group-name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="e.g. Project Team"
              autoFocus
            />

            <label htmlFor="group-members">MEMBERS (DEMO)</label>
            <input
              id="group-members"
              value={groupMembers}
              onChange={(event) => setGroupMembers(event.target.value)}
              placeholder="Enter names separated by commas"
            />

            <p className="modal-note">
              Group creation is currently a local demo. Real member invitations
              will be added when we connect Supabase.
            </p>

            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={() => setShowNewGroup(false)}
              >
                Cancel
              </button>

              <button
                className="create-button"
                onClick={createGroup}
                disabled={!groupName.trim()}
              >
                Create group
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
