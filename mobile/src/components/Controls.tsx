import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps
} from 'react-native'
import { useTheme } from '../hooks/ThemeProvider'

type ButtonProps = {
  title: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'link'
}

/** One button style keeps auth actions consistent with the desktop accent color. */
export function AppButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary'
}: ButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  const isLink = variant === 'link'
  const backgroundColor =
    variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.input : 'transparent'
  const textColor = isLink ? colors.accent : variant === 'primary' ? '#ffffff' : colors.text

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isLink && styles.linkButton,
        {
          backgroundColor,
          borderColor: colors.border,
          opacity: disabled || loading ? 0.55 : pressed ? 0.82 : 1
        }
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>
      )}
    </Pressable>
  )
}

type FieldProps = TextInputProps & { label: string }

/** Labelled native input with the same muted label and rounded field treatment. */
export function FormField({ label, style, ...inputProps }: FieldProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.muted }]}>{label.toUpperCase()}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={[
          styles.input,
          { backgroundColor: colors.input, borderColor: colors.border, color: colors.text },
          style
        ]}
        {...inputProps}
      />
    </View>
  )
}

/** Present request errors and neutral auth confirmations in a readable panel. */
export function InlineNotice({
  message,
  tone = 'neutral'
}: {
  message: string
  tone?: 'neutral' | 'error'
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      style={[styles.notice, { backgroundColor: colors.notice, borderColor: colors.border }]}
    >
      <Text style={[styles.noticeText, { color: tone === 'error' ? colors.danger : colors.muted }]}>
        {message}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    marginTop: 12
  },
  linkButton: { minHeight: 40, paddingHorizontal: 4, borderWidth: 0, alignItems: 'flex-start' },
  buttonText: { fontSize: 14, fontWeight: '700' },
  field: { gap: 8, marginTop: 16 },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 9, paddingHorizontal: 13, fontSize: 15 },
  notice: { borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 14 },
  noticeText: { fontSize: 13, lineHeight: 19 }
})
