import { Stack } from 'expo-router'

/** A separate route group keeps authenticated screens behind the root session gate. */
export default function SignedInLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />
}
