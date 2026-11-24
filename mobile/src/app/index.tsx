import { Redirect } from 'expo-router'
import { LoadingScreen } from '../components/LoadingScreen'
import { useAuth } from '../hooks/AuthProvider'

/** Decide the first screen only after the persisted Supabase session is known. */
export default function IndexScreen(): React.JSX.Element {
  const { session, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return <Redirect href={session ? '/(app)' : '/(auth)/login'} />
}
