import 'react-native-gesture-handler'

import { useEffect, useState } from 'react'
import { Stack, usePathname, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from '../hooks/AuthProvider'
import { ThemeProvider, useTheme } from '../hooks/ThemeProvider'
import { LoadingScreen } from '../components/LoadingScreen'
import { MobileIdentityGate } from '../components/MobileIdentityGate'
import { cancelMobileIdentityProvisioning, ensureMobileIdentity } from '../lib/mobileIdentity'
import { getRouteGateState } from '../lib/routeGatePolicy'

function RouteGate(): React.JSX.Element {
  const { session, loading, signOut } = useAuth()
  const { colors, isDark } = useTheme()
  const router = useRouter()
  const segments = useSegments()
  const pathname = usePathname()
  const firstSegment = segments[0]
  // This isolated developer route needs no signed-in account to run its fixtures.
  const isDevCryptoTest = __DEV__ && pathname === '/dev-crypto-test'

  // Auth links must be allowed to exchange their one-time code before the
  // normal signed-in/signed-out route rules redirect the user elsewhere.
  const isAuthRoute = firstSegment === '(auth)'
  const isRecoveryRoute = firstSegment === 'auth' || firstSegment === 'reset-password'
  const [identityState, setIdentityState] = useState<{
    userId: string
    verified: boolean
    error: string | null
  } | null>(null)
  const [retryNumber, setRetryNumber] = useState(0)

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) {
      setIdentityState(null)
      return
    }
    let active = true
    setIdentityState({ userId, verified: false, error: null })
    void ensureMobileIdentity(userId).then(() => {
      if (active) setIdentityState({ userId, verified: true, error: null })
    }).catch((error: unknown) => {
      // Keep sensitive identity material out of UI errors and logs.
      if (active) setIdentityState({
        userId,
        verified: false,
        error: error instanceof Error ? error.message : 'Mobile identity verification failed.'
      })
    })
    return () => { active = false }
  }, [retryNumber, session?.user.id])

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    return () => cancelMobileIdentityProvisioning(userId)
  }, [session?.user.id])

  const identityReady = Boolean(
    session && identityState?.userId === session.user.id && identityState?.verified
  )
  const gateState = getRouteGateState({
    authLoading: loading,
    userId: session?.user.id ?? null,
    isAuthRoute,
    isRecoveryRoute,
    isDevCryptoTest,
    identityUserId: identityState?.userId ?? null,
    identityVerified: identityReady
  })

  useEffect(() => {
    if (gateState === 'loading' || gateState === 'dev-crypto') return
    if (gateState === 'redirecting-to-login') {
      router.replace('/(auth)/login')
    } else if (session && identityReady && isAuthRoute) {
      router.replace('/(app)')
    }
  }, [gateState, identityReady, isAuthRoute, router, session])

  if (gateState === 'loading' || gateState === 'redirecting-to-login') return <LoadingScreen />
  if (gateState === 'identity-required') {
    const gateError = identityState?.userId === session?.user.id ? identityState?.error ?? null : null
    return (
      <MobileIdentityGate
        error={gateError}
        retrying={false}
        onRetry={() => setRetryNumber((value) => value + 1)}
        onSignOut={() => { void signOut() }}
      />
    )
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="dev-crypto-test" />
      </Stack>
    </>
  )
}

/** Providers stay above Router so login, callback, and account routes share state. */
export default function RootLayout(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <RouteGate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
