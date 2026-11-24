import { useState } from 'react'
import { Link, useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'
import { AuthFrame } from '../components/AuthFrame'
import { AppButton, FormField, InlineNotice } from '../components/Controls'
import { useAuth } from '../hooks/AuthProvider'
import { useTheme } from '../hooks/ThemeProvider'

export default function ResetPasswordScreen(): React.JSX.Element {
  const { recoveryReady, updatePassword, signOut } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Supabase only permits this update after the one-time email callback has
  // established the recovery session in AuthProvider.
  const submit = async (): Promise<void> => {
    if (password.length < 8) {
      setNotice('Password must be at least 8 characters long.')
      setIsError(true)
      return
    }
    if (password !== confirmPassword) {
      setNotice('Passwords do not match.')
      setIsError(true)
      return
    }

    setBusy(true)
    setNotice(null)
    try {
      await updatePassword(password)
      await signOut()
      router.replace({
        pathname: '/(auth)/login',
        params: { passwordUpdated: '1' }
      })
    } catch (authError) {
      setNotice(authError instanceof Error ? authError.message : 'Unable to update your password.')
      setIsError(true)
    } finally {
      setBusy(false)
    }
  }

  if (!recoveryReady) {
    return (
      <AuthFrame
        title="Reset link required"
        subtitle="Open the password-reset link from your email to continue."
      >
        <Link href="/(auth)/forgot-password" asChild>
          <Pressable accessibilityRole="link" style={styles.link}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Request a reset link</Text>
          </Pressable>
        </Link>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      title="Choose a new password"
      subtitle="Enter and confirm the new password for your account."
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: showPassword }}
        onPress={() => setShowPassword((visible) => !visible)}
        style={styles.showLink}
      >
        <Text style={{ color: colors.accent, fontWeight: '700' }}>
          {showPassword ? 'Hide' : 'Show'} password
        </Text>
      </Pressable>
      <FormField
        label="New password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry={!showPassword}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Enter password again"
        secureTextEntry={!showPassword}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {notice && <InlineNotice message={notice} tone={isError ? 'error' : 'neutral'} />}
      <AppButton
        title="Update password"
        onPress={() => void submit()}
        loading={busy}
        disabled={!password || !confirmPassword}
      />
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  showLink: { alignSelf: 'flex-end', paddingVertical: 8 },
  link: { alignSelf: 'center', paddingVertical: 18 }
})
