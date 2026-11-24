import { useState } from 'react'
import { Link } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'
import { AuthFrame } from '../../components/AuthFrame'
import { AppButton, FormField, InlineNotice } from '../../components/Controls'
import { useAuth } from '../../hooks/AuthProvider'
import { useTheme } from '../../hooks/ThemeProvider'
import { isValidEmail } from '../../lib/validation'

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { requestPasswordReset } = useAuth()
  const { colors } = useTheme()
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  // The neutral result avoids revealing whether an email address has an account.
  const submit = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setNotice('Enter a valid email address.')
      setIsError(true)
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      await requestPasswordReset(email)
      setNotice(
        'If an account exists for that email, a reset link was requested. Check your inbox and spam folder.'
      )
      setIsError(false)
    } catch (authError) {
      setNotice(authError instanceof Error ? authError.message : 'Unable to request a reset link.')
      setIsError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title="Reset your password"
      subtitle="Enter your email address and we will send a password-reset link."
    >
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
      />
      {notice && <InlineNotice message={notice} tone={isError ? 'error' : 'neutral'} />}
      <AppButton
        title="Send reset link"
        onPress={() => void submit()}
        loading={busy}
        disabled={!email.trim()}
      />
      <Link href="/(auth)/login" asChild>
        <Pressable accessibilityRole="link" style={styles.backLink}>
          <Text style={[styles.linkText, { color: colors.accent }]}>Back to login</Text>
        </Pressable>
      </Link>
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  backLink: { alignSelf: 'center', paddingTop: 18 },
  linkText: { fontSize: 12, fontWeight: '700' }
})
