# Desktop reference and Mobile implementation status

This checklist comes from the current desktop implementation in `src/renderer/src/App.tsx`,
the crypto helpers under `src/renderer/src/lib/`, the Electron storage bridge, and
`docs/MEDIA_UPLOAD.md`. README bullets were checked against code; this list does
not treat undocumented ideas as existing features.

## Existing desktop functionality

- [x] Email/password sign-in, sign-up with a full-name auth metadata field,
      session restoration, sign-out, and email verification messaging.
- [x] Forgot-password email requests and password update after the
      `cipherchat://auth/callback` recovery link is opened.
- [x] Read-only display of the signed-in user's full name and email. The profile
      query also reads `avatar_url`, but the UI displays initials; there is no profile
      editing screen.
- [x] Direct conversations: search `profiles.full_name`, find an existing shared
      direct conversation or create one, load messages, and send encrypted text.
- [x] Group conversations: search users, create a named group using the existing
      `create_chat_group` RPC, generate a shared key, and wrap it for each member.
- [x] Encrypted text messages with Supabase Realtime refresh for message rows.
- [x] One persistent heart reaction per user/message in direct conversations.
      The UI disables reactions for group conversations.
- [x] Multiple media attachments in a send operation, with a 25 MiB per-file
      limit; encrypt locally, upload ciphertext to private `chat-media` storage,
      encrypt attachment metadata as a message, then download and decrypt locally.
- [x] Dark/light theme toggle. Desktop starts dark and does not persist the choice.
- [x] Loading and error messages for auth, conversations, messages, reactions,
      group creation, and media handling.

Desktop does not currently implement calls, online status, typing indicators,
push notifications, stories, message editing/deletion, profile editing, or a
settings screen beyond the theme toggle. Mobile must not add those features.

## Initial mobile stage status

- [x] Login, signup, email-verification guidance, forgot password, reset
      callback, password update, persistent Supabase session, logout, and theme
      toggle are implemented with native screens.
- [x] Read-only account name/email summary uses the existing `profiles` table.
- [x] Mobile creates an independent P-256 identity, validates the public/private
      pair, stores the private key in its Mobile-only SecureStore namespace, and
      registers only the public key in the Mobile registry. Desktop identities
      and `.ccid` exports are never imported or reused.
- [ ] Mobile-only direct/group messaging, reactions, encryption, and media
      sharing are not implemented yet. The existing chat screen prototypes are
      inaccessible because they still target Desktop messaging tables.

## Planned parity when messaging is implemented

- [ ] Use only the approved Mobile-specific tables and RPCs for Mobile
      messaging; do not read or write Desktop messaging tables.
- [ ] Match the desktop encrypted message JSON, KDF inputs, AES-GCM tags, IVs,
      authenticated data, group-key envelopes, and media metadata exactly. See
      `ENCRYPTION_PROTOCOL.md`.
- [x] Store the generated Mobile private identity only through
      `lib/secure-storage/identityStorage.ts`;
      never put it in SQLite, AsyncStorage, logs, or Supabase.
- [ ] Use native file/image selection as the mobile equivalent of desktop file
      input while retaining the same attachment formats, 25 MiB limit, storage
      bucket, object path convention, and ciphertext format.

## Text encryption prototype

- [x] Pure crypto prototype for P-256 JWKs, ECDH/HKDF-SHA256, AES-256-GCM,
      and the desktop encrypted-message JSON shape.
- [x] Node Web Crypto interoperability checks pass in both directions.
- [x] A separate development-only `/dev-crypto-test` runner is prepared with
      fixed fixtures and ephemeral test keys.
- [x] Physical Android `/dev-crypto-test` was reported by the user as passing
      8/8; iOS runtime testing remains unavailable here.
- [ ] Validate Mobile identity provisioning and SecureStore persistence on a
      physical device against the deployed Mobile registry.
- [ ] Group-key wrapping and encrypted media remain unimplemented.

## Conversation screens

- [ ] Mobile-only chat list and direct conversation screens are not ready. The
      current prototypes are kept behind the identity gate because they query
      Desktop messaging tables.
- [ ] Decrypt and send messages only after phone runtime tests pass, the
      independent Mobile identity is validated, and Mobile-to-Mobile
      interoperability has been confirmed.
