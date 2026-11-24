import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../hooks/ThemeProvider'

/** Shown while SecureStore-backed auth persistence restores the Supabase session. */
export function LoadingScreen(): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Image source={require('../../assets/images/icon.png')} style={styles.icon} />
      <Text style={[styles.name, { color: colors.text }]}>CipherChat</Text>
      <ActivityIndicator color={colors.accent} style={styles.spinner} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { width: 70, height: 70, borderRadius: 18 },
  name: { marginTop: 16, fontSize: 22, fontWeight: '800' },
  spinner: { marginTop: 20 }
})
