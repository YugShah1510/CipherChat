import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getRouteGateState } from '../src/lib/routeGatePolicy'

const authenticatedAppRoute = {
  authLoading: false,
  userId: '11111111-2222-4333-8444-555555555555',
  isAuthRoute: false,
  isRecoveryRoute: false,
  isDevCryptoTest: false,
  identityUserId: null,
  identityVerified: false
}

test('signed-out deep link remains on loading screen until redirect to login', () => {
  assert.equal(getRouteGateState({ ...authenticatedAppRoute, userId: null }), 'redirecting-to-login')
})

test('authenticated startup does not render app routes while provisioning is pending', () => {
  assert.equal(getRouteGateState(authenticatedAppRoute), 'identity-required')
})

test('provisioning failure remains behind the identity recovery gate', () => {
  assert.equal(getRouteGateState({
    ...authenticatedAppRoute,
    identityUserId: authenticatedAppRoute.userId,
    identityVerified: false
  }), 'identity-required')
})

test('successful provisioning shows the verified identity state', () => {
  assert.equal(getRouteGateState({
    ...authenticatedAppRoute,
    identityUserId: authenticatedAppRoute.userId,
    identityVerified: true
  }), 'identity-verified')
})

test('logout while an app route is open immediately chooses the signed-out gate', () => {
  assert.equal(getRouteGateState({ ...authenticatedAppRoute, userId: null }), 'redirecting-to-login')
})

test('unresolved authentication renders loading, except the exact dev-only test route', () => {
  assert.equal(getRouteGateState({
    ...authenticatedAppRoute,
    authLoading: true
  }), 'loading')
  assert.equal(getRouteGateState({
    ...authenticatedAppRoute,
    authLoading: true,
    isDevCryptoTest: true
  }), 'dev-crypto')
})
