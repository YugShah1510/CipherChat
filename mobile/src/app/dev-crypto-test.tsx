import { useEffect, useState } from 'react'
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  runCryptoRuntimeChecks,
  type RuntimeCheckResult
} from '../../scripts/crypto-runtime-checks'

export default function DevelopmentCryptoTestScreen(): React.JSX.Element {
  const [checks, setChecks] = useState<RuntimeCheckResult[]>([])
  const [running, setRunning] = useState(false)

  const runChecks = async (): Promise<void> => {
    setRunning(true)
    setChecks([])
    try {
      setChecks(await runCryptoRuntimeChecks())
    } catch {
      // Show only a generic failure instead of surfacing native errors or test secrets.
      setChecks([{ name: 'Runtime test runner', passed: false }])
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    if (__DEV__) void runChecks()
  }, [])

  if (!__DEV__) {
    return <SafeAreaView style={styles.page}><Text>This developer test route is disabled.</Text></SafeAreaView>
  }

  const passedCount = checks.filter((check) => check.passed).length

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Crypto runtime checks</Text>
        <Text style={styles.description}>
          Developer-only checks use fixed public fixtures and temporary test keys. They do not
          access account data or save keys.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void runChecks()} disabled={running}>
          <Text style={styles.button}>{running ? 'Running…' : 'Run checks again'}</Text>
        </Pressable>
        <View style={styles.results}>
          {checks.map((check) => (
            <Text key={check.name} style={check.passed ? styles.pass : styles.fail}>
              {check.passed ? 'PASS' : 'FAIL'}  {check.name}
            </Text>
          ))}
        </View>
        {!running && checks.length > 0 && (
          <Text style={styles.summary}>{passedCount}/{checks.length} checks passed</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#10131d' },
  content: { padding: 24, gap: 16 },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '700' },
  description: { color: '#c4cad8', fontSize: 15, lineHeight: 22 },
  button: { color: '#ffffff', backgroundColor: '#5a6cf2', padding: 14, borderRadius: 10 },
  results: { gap: 12 },
  pass: { color: '#72dda3', fontSize: 14 },
  fail: { color: '#ff8e8e', fontSize: 14 },
  summary: { color: '#ffffff', fontWeight: '700' }
})
