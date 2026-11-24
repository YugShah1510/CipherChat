import { Stack } from 'expo-router'

/** Keep auth routes in one navigation group without a second header. */
export default function AuthLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
}
