import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { AppButton, InlineNotice } from './Controls'
import { useTheme } from '../hooks/ThemeProvider'

export function MobileIdentityGate({
  error,
  verified = false,
  retrying,
  onRetry,
  onSignOut
}: {
  error: string | null
  verified?: boolean
  retrying: boolean
  onRetry: () => void
  onSignOut: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Secure Mobile identity</Text>
        {verified ? (
          <InlineNotice
            message="This phone’s Mobile identity is verified. Messaging remains unavailable until the Mobile-only conversation screens are connected and validated."
          />
        ) : error ? (
          <InlineNotice message={error} tone="error" />
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.copy, { color: colors.muted }]}>Verifying this phone’s Mobile identity…</Text>
          </>
        )}
        {error && <AppButton title="Retry verification" onPress={onRetry} loading={retrying} />}
        {(error || verified) && <AppButton title="Sign out" onPress={onSignOut} variant="secondary" />}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { gap: 16 },
  title: { fontSize: 23, fontWeight: '800', textAlign: 'center' },
  copy: { fontSize: 15, lineHeight: 22, textAlign: 'center' }
})
