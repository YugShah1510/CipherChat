import { useState } from 'react'
import { Link } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'
import { AuthFrame } from '../../components/AuthFrame'
import { AppButton, FormField, InlineNotice } from '../../components/Controls'
import { useAuth } from '../../hooks/AuthProvider'
import { useTheme } from '../../hooks/ThemeProvider'
import { isValidEmail } from '../../lib/validation'

export default function SignupScreen(): React.JSX.Element {
  const { signUp } = useAuth()
  const { colors } = useTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [busy, setBusy] = useState(false)

  // Desktop sends the full name as Supabase auth metadata; preserve that shape
  // so existing profile creation policies and triggers can keep using it.
  const submit = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setNotice('Enter a valid email address.')
      setNoticeIsError(true)
      return
    }
    if (password.length < 8) {
      setNotice('Password must be at least 8 characters long.')
      setNoticeIsError(true)
      return
    }
    if (password !== confirmPassword) {
      setNotice('Passwords do not match.')
      setNoticeIsError(true)
      return
    }

    setBusy(true)
    setNotice(null)
    try {
      const result = await signUp(name, email, password)
      if (result.emailConfirmationRequired) {
        setNotice('Account created. Check your email for the verification link, then sign in.')
        setNoticeIsError(false)
      }
    } catch (authError) {
      setNotice(authError instanceof Error ? authError.message : 'Unable to create your account.')
      setNoticeIsError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title="Create your account"
      subtitle="Join CipherChat and start private conversations."
    >
      <FormField
        label="Full name"
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        autoComplete="name"
        textContentType="name"
      />
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
      <FormField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Enter password again"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {notice && <InlineNotice message={notice} tone={noticeIsError ? 'error' : 'neutral'} />}
      <AppButton
        title="Create account"
        onPress={() => void submit()}
        loading={busy}
        disabled={!name.trim() || !email.trim() || !password || !confirmPassword}
      />
      <Text style={[styles.footerText, { color: colors.muted }]}>Already have an account?</Text>
      <Link href="/(auth)/login" asChild>
        <Pressable accessibilityRole="link" style={styles.signinLink}>
          <Text style={[styles.linkText, { color: colors.accent }]}>Sign in</Text>
        </Pressable>
      </Link>
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  footerText: { textAlign: 'center', marginTop: 18, fontSize: 12 },
  signinLink: { alignSelf: 'center', paddingTop: 7 },
  linkText: { fontSize: 12, fontWeight: '700' }
})
