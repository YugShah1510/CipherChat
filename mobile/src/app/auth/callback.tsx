import { useEffect, useRef, useState } from 'react'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { AppButton, InlineNotice } from '../../components/Controls'
import { LoadingScreen } from '../../components/LoadingScreen'
import { useAuth } from '../../hooks/AuthProvider'
import { useTheme } from '../../hooks/ThemeProvider'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Exchange Supabase's one-time PKCE code before displaying the reset form. */
export default function AuthCallbackScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{
    code?: string | string[]
    error?: string | string[]
    error_description?: string | string[]
  }>()
  const code = first(params.code)
  const callbackError = first(params.error_description) ?? first(params.error)
  const { completePasswordRecovery } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const handled = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Deep links can trigger more than one render; a PKCE code is single-use.
    if (handled.current) return
    handled.current = true

    if (callbackError) {
      setError(`The reset link could not be verified: ${callbackError}`)
      return
    }
    if (!code) {
      setError('The reset link is missing its verification code. Request a new link.')
      return
    }

    void completePasswordRecovery(code)
      .then(() => router.replace('/reset-password'))
      .catch((authError: unknown) => {
        setError(
          authError instanceof Error ? authError.message : 'Unable to verify the reset link.'
        )
      })
  }, [callbackError, code, completePasswordRecovery, router])

  if (!error) return <LoadingScreen />
  return (
    <View style={[styles.errorPage, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Reset link unavailable</Text>
      <InlineNotice message={error} tone="error" />
      <Link href="/(auth)/forgot-password" asChild>
        <Pressable accessibilityRole="link" style={styles.link}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>
            Request another reset link
          </Text>
        </Pressable>
      </Link>
      <AppButton
        title="Back to login"
        onPress={() => router.replace('/(auth)/login')}
        variant="secondary"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  errorPage: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 23, fontWeight: '800', marginBottom: 10 },
  link: { alignSelf: 'center', paddingVertical: 18 }
})
