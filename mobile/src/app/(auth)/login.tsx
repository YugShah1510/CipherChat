import { useState } from 'react'
import { Link, useLocalSearchParams } from 'expo-router'
import { Text, Pressable, StyleSheet } from 'react-native'
import { AuthFrame } from '../../components/AuthFrame'
import { AppButton, FormField, InlineNotice } from '../../components/Controls'
import { useAuth } from '../../hooks/AuthProvider'
import { useTheme } from '../../hooks/ThemeProvider'
import { isValidEmail } from '../../lib/validation'

export default function LoginScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ passwordUpdated?: string | string[] }>()
  const { signIn, error: sessionError, clearError } = useAuth()
  const { colors } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(
    params.passwordUpdated === '1' ||
      (Array.isArray(params.passwordUpdated) && params.passwordUpdated[0] === '1')
      ? 'Your password was updated. Sign in with your new password.'
      : null
  )
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  // Keep the password in this screen only; Supabase receives it over TLS and
  // manages the resulting session through its configured persistence adapter.
  const submit = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setNotice('Enter a valid email address.')
      setNoticeIsError(true)
      return
    }
    setBusy(true)
    setNotice(null)
    setNoticeIsError(false)
    clearError()
    try {
      await signIn(email, password)
    } catch (authError) {
      setNotice(authError instanceof Error ? authError.message : 'Unable to sign in.')
      setNoticeIsError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to continue to your private conversations.">
      <FormField
        label="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <FormField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Enter your password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {(notice || sessionError) && (
        <InlineNotice
          message={notice ?? sessionError ?? ''}
          tone={noticeIsError || Boolean(sessionError) ? 'error' : 'neutral'}
        />
      )}
      <Link href="/(auth)/forgot-password" asChild>
        <Pressable accessibilityRole="link" style={styles.forgotLink}>
          <Text style={[styles.linkText, { color: colors.accent }]}>Forgot password?</Text>
        </Pressable>
      </Link>
      <AppButton
        title="Sign in"
        onPress={() => void submit()}
        loading={busy}
        disabled={!email.trim() || !password}
      />
      <Text style={[styles.footerText, { color: colors.muted }]}>Don't have an account?</Text>
      <Link href="/(auth)/signup" asChild>
        <Pressable accessibilityRole="link" style={styles.createLink}>
          <Text style={[styles.linkText, { color: colors.accent }]}>Create account</Text>
        </Pressable>
      </Link>
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  forgotLink: { alignSelf: 'flex-end', paddingTop: 13, paddingBottom: 4 },
  footerText: { textAlign: 'center', marginTop: 20, fontSize: 12 },
  createLink: { alignSelf: 'center', paddingTop: 7 },
  linkText: { fontSize: 12, fontWeight: '700' }
})
