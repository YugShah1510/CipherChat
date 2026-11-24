# Existing CipherChat encryption protocol

This is a code-level description of the desktop implementation, not an
independent security review. Mobile message and media encryption are **not**
implemented in the initial mobile stage. Do not claim cross-device messaging
compatibility until byte-for-byte interoperability fixtures have been run on
mobile and desktop.

## Identity and public-key registration

1. `crypto.ts` creates an ECDH key pair on curve P-256 with Web Crypto.
2. Both keys are exported as JSON Web Keys. The desktop serializes the private
   JWK and public JWK together, then writes that identity through Electron
   `safeStorage` to a user-specific file. The private JWK is not uploaded.
3. Only the public JWK is JSON-serialized into the existing
   `user_public_keys.public_key` row. If another device already has a public key
   but the local private key is absent, desktop refuses to silently replace it.

## Independent Mobile identity

Mobile is a separate messaging ecosystem and creates its own P-256 identity
during authenticated first-time setup. It stores the private JWK only in Expo
SecureStore under the Mobile namespace
`cipherchat.mobile.identity.v1.<userId>` and registers only the public JWK in
`mobile_user_public_keys` through the Mobile registration RPC. Storage is
create-only; a registered key without its local private key requires recovery,
and a mismatch stops provisioning without replacing either key. Logout does
not delete the Mobile identity.

Desktop and Mobile identities are independent. Mobile never imports, reuses, or
transfers a Desktop private key or `.ccid` export, and it never reads or writes
the Desktop `user_public_keys` table. The Desktop identity export format is
Desktop-only and is not a Mobile recovery mechanism. No private key is sent to
Supabase or stored in AsyncStorage.

## Direct-message key derivation

1. Import the account private JWK and the other participant's public JWK as
   ECDH P-256 keys.
2. Derive 256 bits with ECDH.
3. Import those bits as HKDF material, then derive an AES-GCM-256 key with:
   - Hash: SHA-256
   - Salt: UTF-8 conversation ID
   - Info: UTF-8 `CipherChat E2EE v1`
4. The 256-bit intermediate secret is overwritten in its byte buffer after
   importing it as HKDF material. JavaScript cannot guarantee removal of all
   engine copies from memory.

The sender's private key and recipient's public key produce the same ECDH
secret as the recipient's private key and sender's public key. The conversation
ID separates otherwise identical participant key pairs across conversations.

## Encrypted text message representation

- Algorithm: AES-256-GCM.
- IV: fresh 12-byte cryptographically random value for each encryption.
- Tag: 128 bits (included by Web Crypto at the end of the returned ciphertext).
- Additional authenticated data: UTF-8 conversation ID.
- Plaintext: UTF-8 message text.
- Database `messages.ciphertext`: a JSON string with `{ "version": 1,
"iv": "<base64>", "ciphertext": "<base64>" }`.

The decoder checks version `1`, recreates the conversation key, and asks
AES-GCM to authenticate and decrypt the ciphertext. IV, tag, AAD, and Base64
conventions must remain identical on mobile.

## Group-key wrapping

1. A new 256-bit AES-GCM key is generated for the group and exported as Base64
   raw key material in memory.
2. The group creator derives a pairwise key with the same ECDH/HKDF steps for
   each member (including the creator, based on the current RPC member list).
3. The raw group key is wrapped with AES-256-GCM using a fresh 12-byte IV and
   AAD `CipherChat group key:<conversationId>`.
4. Each `conversation_keys.encrypted_key` stores a JSON string containing a
   version-1 envelope with Base64 IV and ciphertext. The recipient unwraps it
   with their private identity and the creator public JWK.
5. Group messages and media use the unwrapped shared key instead of a pairwise
   conversation key.

## Encrypted media representation

- The file bytes are encrypted locally with the conversation key (pairwise for
  direct chats; shared group key for groups), AES-256-GCM, fresh 12-byte IV,
  128-bit tag, and AAD `CipherChat media:<conversationId>`.
- The binary ciphertext is uploaded unchanged to the private `chat-media`
  bucket at `<conversationId>/<senderUserId>/<uuid>` with the opaque storage
  content type `application/octet-stream`.
- The sender makes JSON metadata containing `kind: "cipherchat-media"`,
  `version: 1`, storage path, Base64 IV, original file name, MIME type, and size.
  That JSON is itself encrypted as a normal message using the conversation ID
  as AAD and stored in `messages.ciphertext`.
- The receiver decrypts the message metadata, downloads the ciphertext, then
  decrypts the file with the metadata IV and the same media AAD.
- Desktop permits multiple selected files, up to 25 MiB per file.

## Mobile interoperability work still required

React Native does not automatically provide the same Web Crypto `subtle` APIs
and binary handling as Electron Chromium. The selected implementation and
current text-protocol checks are described below. Before messaging is
implemented, run fixtures in Android and iOS runtimes and extend coverage to
group-key envelopes and media. If any of those formats cannot match desktop,
stop and document the incompatibility instead of changing the protocol or
weakening security.

## Mobile text-crypto prototype status

The current prototype lives in `src/lib/crypto.ts` and `src/lib/cryptoCore.ts`.
It uses `@noble/curves` for P-256, `@noble/hashes` for HKDF-SHA256,
`@noble/ciphers` for AES-GCM, and Expo Crypto's asynchronous native random-byte
API for P-256 key material and IVs. Its public and private key data uses the same P-256 JWK fields and
Base64URL coordinate encoding as Web Crypto. The ECDH shared point is reduced
to its 32-byte x-coordinate before HKDF, matching Web Crypto's 256-bit
`deriveBits` output. AES-GCM emits the 16-byte tag appended to ciphertext.

### Test and runtime record (2026-11-23)

The local `npm run test:crypto` checks the pure crypto core against Node's Web
Crypto implementation, which uses the same standard Web Crypto operations as
desktop. It checks JWK imports, matching ECDH/HKDF keys, desktop-encrypted data
opened by mobile code, mobile-encrypted data opened by Web Crypto, UTF-8,
message JSON fields, tag length, wrong-conversation authentication failure,
tampering, invalid Base64, truncated ciphertext, and unsupported versions.
It also checks RFC 5869 HKDF-SHA256 and NIST AES-256-GCM fixed vectors.

Android and iOS bundles both export successfully. This validates Metro
compatibility but does not execute JavaScript or native random generation on a
device. A separate development-only runner is available at
`/dev-crypto-test`; it uses public fixed test vectors and newly generated
in-memory test identities, does not access account data, and displays only
pass/fail labels. Use `npx expo start` in development, then open that route on
the target device or simulator.

| Check | Result |
| --- | --- |
| Node/Web Crypto interoperability and fixed vectors | Passed |
| TypeScript typecheck | Passed |
| Expo public configuration and dependency checks | Passed; dependency check used the local map because network access was unavailable |
| Android Metro bundle | Passed; Expo SDK 58.0.26, React Native 0.88.1 |
| iOS Metro bundle | Passed; Expo SDK 58.0.26, React Native 0.88.1 |
| Android physical runtime `/dev-crypto-test` | User reported 8/8 checks passed in Expo Go; device and Android version were not recorded |
| iOS Simulator and Expo native random provider | Not run: Xcode and `simctl` are unavailable; only Command Line Tools are selected |

The target dependency versions are Expo Crypto 58.0.8 and Noble curves, hashes,
and ciphers 2.4.0. The host used Node 26.10.0 and Expo CLI 58.1.21. The user
reported running the crypto test screen on a physical Android phone, but did not
provide Android or Expo Go versions. iOS Simulator was unavailable. The fixed
ECDH/HKDF/AES-GCM fixture matches expected output produced by the
desktop-compatible Web Crypto implementation.

### Security review notes

- Production key and IV randomness goes through Expo Crypto's asynchronous
  native API. The synchronous Expo random API is intentionally not used because
  its development behavior may fall back to `Math.random`.
- AES-GCM uses a 12-byte IV and a 16-byte appended authentication tag. The
  decoder rejects wrong IV sizes, ciphertext shorter than the tag, malformed
  Base64, unsupported versions, wrong AAD, and tampered ciphertext.
- Base64 parsing is explicit and validates the standard alphabet/padding;
  public JWK coordinates use Base64URL encoding.
- Temporary random seed, private-scalar, and ECDH shared-point/secret byte arrays
  are cleared in `finally` blocks as a best effort. JavaScript strings and
  engine copies cannot be reliably erased.
- Identity-provisioning tests cover initial setup, repeated verification,
  recovery-required and mismatch cases, invalid pairs, failed-registration
  retry, logout/login persistence, concurrent calls, distinct accounts, and
  cancellation during logout. They use in-memory storage and mocked registry
  calls; they do not establish live database or device behavior.
- These checks are not an independent cryptographic audit. Do not integrate
  messaging until Android and iOS runtime checks pass and group/media formats
  receive their own compatibility fixtures.

Provisioning creates and verifies an independent Mobile identity, but it is not
connected to encrypted message reads or writes. No live Supabase or physical
device provisioning check is claimed. The Mobile schema and RPC must be deployed
before the startup provisioning flow can succeed against the project.

### Messaging gate investigation

Authenticated startup verifies the Mobile identity before showing the identity
status screen. Signed-out deep links remain on a loading screen until they are
redirected, and errors keep app routes hidden. The developer crypto route is
available only in development. Chat routes remain inaccessible because the
existing screen prototypes still query Desktop messaging tables; they must be
rebuilt against Mobile-only tables before messaging can be enabled.

The Desktop identity and its `user_public_keys` row remain Desktop-only. Mobile
uses the independent `mobile_user_public_keys` registry and never reads or
writes Desktop identity data. A registered Mobile public key without its
matching local private identity requires recovery; the app does not generate a
replacement or import a Desktop `.ccid` file.

The `/dev-crypto-test` route is available only in development (`__DEV__`). It
automatically runs on screen mount and can be rerun with its button. It uses
published test-only key fixtures plus ephemeral generated keys; it does not
read account data, persist keys, or display secret material. The route uses Expo
Crypto and Noble packages in the Expo Go-compatible project configuration. The
user previously reported that the crypto screen ran on a physical Android phone
with all 8 checks passing. That report does not verify Mobile identity
provisioning, SecureStore persistence, or database registration.

No message-encryption protocol changes were made. Desktop-to-Mobile identity
transfer and cross-platform decryption are not supported. Sending cannot safely
be enabled until Mobile-only messaging is implemented and validated.

Group-key envelopes and media encryption have not been implemented or tested
in mobile. Mobile identity recovery across devices remains unsupported as
described above. Do not treat the prototype as production-ready messaging or
claim verified on-device interoperability until the fixtures above run in Expo
on Android and iOS.
