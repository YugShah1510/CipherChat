import { AppState, type AppStateStatus } from 'react-native'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigurationMessage } from '../lib/supabase'

export const mobileAuthCallbackUrl = 'cipherchat-mobile://auth/callback'

type SignUpResult = { emailConfirmationRequired: boolean }
type AuthValue = {
  session: Session | null
  loading: boolean
  error: string | null
  recoveryReady: boolean
  clearError: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>
  requestPasswordReset: (email: string) => Promise<void>
  completePasswordRecovery: (code: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function getClient() {
  if (!supabase) throw new Error(supabaseConfigurationMessage)
  return supabase
}

/**
 * Own the one Supabase session shared by every route. Restoring it before
 * showing login prevents a signed-in user from seeing the login screen briefly.
 */
export function AuthProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)

  useEffect(() => {
    const client = supabase
    if (!client) {
      setLoading(false)
      return
    }

    let active = true
    const { data: authListener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryReady(true)
      if (event === 'SIGNED_OUT') setRecoveryReady(false)
      if (active) setSession(nextSession)
    })

    // Register the listener before reading storage so auth changes aren't lost
    // while the persisted session is being restored.
    void client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return
        if (sessionError) setError(sessionError.message)
        setSession(data.session)
        setLoading(false)
      })
      .catch((restoreError: unknown) => {
        if (!active) return
        setError(
          restoreError instanceof Error ? restoreError.message : 'Unable to restore the session.'
        )
        setLoading(false)
      })

    // Native apps should refresh tokens only while the app is in the foreground.
    const updateRefreshState = (state: AppStateStatus): void => {
      if (state === 'active') void client.auth.startAutoRefresh()
      else void client.auth.stopAutoRefresh()
    }
    const initialAppState = AppState.currentState as AppStateStatus | null
    if (initialAppState) updateRefreshState(initialAppState)
    const appStateListener = AppState.addEventListener('change', updateRefreshState)

    return () => {
      active = false
      authListener.subscription.unsubscribe()
      appStateListener.remove()
      void client.auth.stopAutoRefresh()
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      error,
      recoveryReady,
      clearError: () => setError(null),
      signIn: async (email, password) => {
        setError(null)
        const { error: authError } = await getClient().auth.signInWithPassword({
          email: email.trim(),
          password
        })
        if (authError) throw authError
      },
      signUp: async (name, email, password) => {
        setError(null)
        const { data, error: authError } = await getClient().auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } }
        })
        if (authError) throw authError
        return { emailConfirmationRequired: !data.session }
      },
      requestPasswordReset: async (email) => {
        setError(null)
        const { error: authError } = await getClient().auth.resetPasswordForEmail(email.trim(), {
          redirectTo: mobileAuthCallbackUrl
        })
        if (authError) throw authError
      },
      completePasswordRecovery: async (code) => {
        setError(null)
        const { error: authError } = await getClient().auth.exchangeCodeForSession(code)
        if (authError) throw authError
        setRecoveryReady(true)
      },
      updatePassword: async (password) => {
        if (!recoveryReady)
          throw new Error('Open the password-reset link before changing your password.')
        setError(null)
        const { error: authError } = await getClient().auth.updateUser({ password })
        if (authError) throw authError
        setRecoveryReady(false)
      },
      signOut: async () => {
        setError(null)
        const { error: authError } = await getClient().auth.signOut()
        if (authError) throw authError
      }
    }),
    [session, loading, error, recoveryReady]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Give auth screens one typed place to access session state and actions. */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
