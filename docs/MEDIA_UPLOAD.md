# CipherChat – Encrypted Media Upload and Sharing

## 1. Overview

CipherChat supports sharing media and files inside direct and group conversations.

Users can select multiple files using the attachment (`＋`) button. Before uploading, each file is encrypted on the client side. The encrypted file is stored in Supabase Storage, while its encrypted metadata is stored in the messages table.

The recipient downloads the encrypted file and decrypts it locally.

## 2. Technologies Used

- **Electron:** Desktop application framework.
- **React + TypeScript:** User interface and application logic.
- **Supabase Storage:** Stores encrypted media files.
- **Supabase Database:** Stores message metadata and conversation information.
- **Web Crypto API:** Encrypts and decrypts files using AES-256-GCM.

## 3. Main Files

| File | Responsibility |
|---|---|
| `src/renderer/src/App.tsx` | File selection, upload, download and media display logic |
| `src/renderer/src/lib/groupCrypto.ts` | Media encryption, decryption and group-key wrapping |
| `src/renderer/src/lib/crypto.ts` | Message encryption and decryption |
| `src/renderer/src/lib/supabase.ts` | Supabase client configuration |

## 4. Media Upload Workflow

1. The user clicks the `＋` attachment button.
2. A file picker opens and allows multiple file selections.
3. The application validates the selected files. The current limit is 25 MB per file.
4. The application obtains the encryption key for the conversation.
5. Each file is encrypted locally using AES-256-GCM.
6. The encrypted file is uploaded to the private Supabase Storage bucket named `chat-media`.
7. The application encrypts the media metadata using the conversation message encryption function.
8. The encrypted metadata is inserted into the `messages` table.

### Storage Path

Files are stored using this path structure:

`{conversation_id}/{sender_user_id}/{unique_file_id}`

This keeps media organized by conversation and uploader.

## 5. Media Download Workflow

1. The recipient loads the conversation.
2. The application retrieves the encrypted message.
3. The message is decrypted to obtain the media metadata.
4. The application downloads the encrypted file from the private `chat-media` bucket.
5. The encrypted file is decrypted locally using the conversation key and stored IV.
6. A local object URL is created to display or open the decrypted media.

The recipient must have access to the conversation and the required encryption key.

## 6. Encryption Details

CipherChat uses the Web Crypto API.

- **Algorithm:** AES-256-GCM
- **Key size:** 256 bits
- **IV:** A unique initialization vector is generated for each encryption operation.
- **Additional Authenticated Data (AAD):** The conversation ID is included as authenticated additional data.
- **Encryption location:** The renderer/client, before the file is uploaded.

The encryption process ensures that Supabase Storage receives encrypted file contents rather than the original file contents.

## 7. Supabase Configuration

The application requires a private Storage bucket:

`chat-media`

The Storage access policies should ensure:

- Only authenticated conversation members can upload media.
- Only conversation members can download media.
- Users can delete their own uploaded media, subject to the configured policy.

The bucket should not be public.

The Supabase client uses environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not commit the `.env` file or expose credentials in the repository.

## 8. File Validation

The current implementation supports:

- Multiple file selection.
- Images and other file types.
- A maximum file size of 25 MB per file.
- Client-side encryption before upload.

Actual supported previews depend on the media-rendering logic and the file type.

## 9. Testing Procedure

### Sender

1. Sign in to CipherChat.
2. Open an existing conversation.
3. Click the `＋` button.
4. Select an image or another file.
5. Verify that the upload completes and the message appears.

### Recipient

1. Sign in using another account that belongs to the same conversation.
2. Open the same conversation.
3. Verify that the media is downloaded and decrypted correctly.

### Additional Checks

- Try selecting multiple files.
- Try a file larger than 25 MB.
- Verify that a non-member cannot access the private media.
- Verify that the application handles upload or download errors.

## 10. Security Considerations and Limitations

- Files are encrypted before being uploaded to Supabase Storage.
- Supabase Storage stores encrypted file contents.
- Conversation membership is enforced through Storage access policies.
- Encryption keys must be available to authorized conversation members.
- This implementation does not include a forward-secrecy ratchet or automatic key rotation.
- Public-key authenticity and identity verification are separate security concerns.

This implementation demonstrates client-side encrypted media sharing for the CipherChat desktop application. It should not be considered a production-audited encryption system.

## 11. Summary

The media-sharing feature allows CipherChat users to select, encrypt, upload, download and decrypt