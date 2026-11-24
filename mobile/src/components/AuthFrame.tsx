import {
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../hooks/ThemeProvider'

/** A compact mobile version of the desktop brand, auth card, and security footer. */
export function AuthFrame({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}): React.JSX.Element {
  const { colors, isDark, toggleTheme } = useTheme()
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <Image source={require('../../assets/images/icon.png')} style={styles.logo} />
            <View>
              <Text style={[styles.brandName, { color: colors.text }]}>CipherChat</Text>
              <Text style={[styles.brandTagline, { color: colors.muted }]}>PRIVATE MESSAGING</Text>
            </View>
            <Pressable
              onPress={toggleTheme}
              accessibilityRole="button"
              accessibilityLabel="Toggle color theme"
              style={styles.themeButton}
            >
              <Text style={[styles.themeMark, { color: colors.accent }]}>{isDark ? '◐' : '☼'}</Text>
            </Pressable>
          </View>

          <View
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={[styles.symbol, { backgroundColor: colors.accent }]}>
              <Text style={styles.symbolText}>C</Text>
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>
            {children}
            <View style={[styles.security, { borderTopColor: colors.border }]}>
              <Text style={[styles.securityMark, { color: colors.accent }]}>♢</Text>
              <Text style={[styles.securityText, { color: colors.muted }]}>
                Your privacy matters. Built for secure conversations.
              </Text>
            </View>
          </View>
          <Text style={[styles.footer, { color: colors.muted }]}>
            CIPHERCHAT · PRIVATE MESSAGING
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22,
    paddingTop: 12,
    paddingBottom: 18
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 24 },
  themeButton: {
    marginLeft: 'auto',
    minWidth: 42,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center'
  },
  logo: { width: 42, height: 42, borderRadius: 11 },
  brandName: { fontSize: 19, fontWeight: '800', letterSpacing: -0.5 },
  brandTagline: { marginTop: 3, fontSize: 9, fontWeight: '700', letterSpacing: 1.7 },
  themeMark: { marginLeft: 'auto', fontSize: 22 },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: 24,
    borderWidth: 1,
    borderRadius: 17
  },
  symbol: {
    width: 43,
    height: 43,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 19
  },
  symbolText: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 5 },
  security: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 22,
    paddingTop: 16,
    borderTopWidth: 1
  },
  securityMark: { fontSize: 17 },
  securityText: { fontSize: 10, flexShrink: 1 },
  footer: { textAlign: 'center', marginTop: 17, fontSize: 9, fontWeight: '700', letterSpacing: 1.8 }
})
