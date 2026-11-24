export type RouteGateInput = {
  authLoading: boolean
  userId: string | null
  isAuthRoute: boolean
  isRecoveryRoute: boolean
  isDevCryptoTest: boolean
  identityUserId: string | null
  identityVerified: boolean
}

export type RouteGateState =
  | 'dev-crypto'
  | 'loading'
  | 'auth-routes'
  | 'recovery-route'
  | 'redirecting-to-login'
  | 'identity-required'
  | 'identity-verified'

/** Decide what may render before the root layout mounts any application routes. */
export function getRouteGateState(input: RouteGateInput): RouteGateState {
  if (input.isDevCryptoTest) return 'dev-crypto'
  if (input.authLoading) return 'loading'

  if (!input.userId) {
    return input.isAuthRoute || input.isRecoveryRoute
      ? 'auth-routes'
      : 'redirecting-to-login'
  }

  if (input.isRecoveryRoute) return 'recovery-route'
  if (input.identityUserId !== input.userId || !input.identityVerified) {
    return 'identity-required'
  }
  return 'identity-verified'
}
