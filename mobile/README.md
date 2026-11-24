# CipherChat Mobile

This Expo Router app is an isolated mobile companion for the existing CipherChat
desktop project. The desktop repository remains at the project root; mobile
source, dependencies, configuration, and documentation live in this directory.

## Configure Supabase

Copy `.env.example` to `.env` in this directory and fill in the same Supabase
project URL and publishable key used by desktop, under Expo's `EXPO_PUBLIC_`
variable names. The public key is intended for client applications; never put a
Supabase service-role key in a mobile build. The root desktop `.env` is not read
or modified by this project.

The reset email opens `cipherchat-mobile://auth/callback`. Add that exact URL to
the existing project's **Authentication → URL Configuration → Redirect URLs**
allowlist. Keep the existing recovery email template's Supabase confirmation
link so it forwards to the requested redirect.

## Run on macOS

```sh
cd mobile
npm install
npm run typecheck
npm start
```

Install the development build or Expo Go on a simulator/device and scan the QR
code. Native password-reset deep links require an app build that registers the
`cipherchat-mobile` scheme; Expo Go cannot own that scheme.

For an iOS simulator with Xcode installed:

```sh
npm run ios
```

## Run on Android

Install Android Studio and an Android emulator, then run:

```sh
cd mobile
npm install
npm run typecheck
npm run android
```

The initial mobile stage includes Supabase email/password auth, session
restoration, reset-link callback handling, theme switching, and a read-only
account summary. The authenticated route is deliberately a placeholder until
mobile messaging is implemented and its encryption compatibility is verified.
See `docs/FEATURE_PARITY.md` and `docs/ENCRYPTION_PROTOCOL.md` before that work.

For an Android development build that registers the reset-link scheme, install
Android Studio and its SDK, then run `npx expo run:android` from `mobile/`.
For quick UI iteration in Expo Go, `npm run android` opens the Metro project,
but Expo Go does not own the `cipherchat-mobile` scheme and cannot verify the
email reset callback.
