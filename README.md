# CipherChat 🔐

**A Desktop End-to-End Encrypted Chat Application**

CipherChat is a cross-platform desktop messaging application built with Electron, React, TypeScript, and Supabase. It allows users to communicate through direct and group conversations, share encrypted media, and react to messages.

The project focuses on demonstrating secure communication concepts through client-side encryption and a simple desktop interface.

## ✨ Features

- **User Authentication:** Sign up and log in using email and password.
- **Direct Messaging:** Communicate privately with other users.
- **Group Chats:** Create group conversations and communicate with multiple members.
- **Encrypted Messages:** Encrypt and decrypt messages on the client side.
- **Encrypted Media Sharing:** Select and share files after encrypting them locally.
- **Message Reactions:** React to messages using emojis.
- **Dark and Light Themes:** Switch between available interface themes.
- **Cross-Platform Desktop App:** Built with Electron for macOS and Windows.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Electron | Desktop application framework |
| React | User interface |
| TypeScript | Application development |
| Vite / electron-vite | Development and build tooling |
| Supabase Auth | User authentication |
| Supabase Database | Store conversations and messages |
| Supabase Realtime | Real-time communication |
| Supabase Storage | Store encrypted media |
| Web Crypto API | Client-side encryption and decryption |

## 🔐 Security and Encryption

CipherChat implements client-side encryption using browser cryptographic APIs.

### Cryptographic Components

- **ECDH with P-256:** Derives shared secrets between users.
- **HKDF-SHA256:** Derives encryption keys from shared secrets.
- **AES-256-GCM:** Encrypts and decrypts messages and media.
- **Electron safeStorage:** Protects locally stored private-key material using the operating system's secure storage facilities.

### Message Encryption

Messages are encrypted before being stored in the database. The intended recipient uses the corresponding conversation key to decrypt them.

### Media Encryption

Files are encrypted locally before being uploaded to the private Supabase Storage bucket. Recipients download the encrypted files and decrypt them locally.

For implementation details, see:

- [Media Upload Documentation](docs/MEDIA_UPLOAD.md)

### Security Limitations

CipherChat is an educational project and has not undergone an independent security audit. It does not currently implement a forward-secrecy ratchet or automatic key rotation. Public-key authenticity and identity verification also require additional safeguards.

It should not be considered a production-audited secure messaging system.

## 📁 Project Structure

```text
CipherChat/
├── docs/
│   └── MEDIA_UPLOAD.md
├── electron/
│   ├── main.ts
│   └── preload.ts
├── src/
│   └── renderer/
│       └── src/
│           ├── components/
│           ├── lib/
│           │   ├── crypto.ts
│           │   ├── groupCrypto.ts
│           │   ├── identity.ts
│           │   └── supabase.ts
│           ├── App.tsx
│           └── main.tsx
├── .env.example
├── package.json
└── README.md
```

*Note: This is a high-level structure; the exact files may vary as development continues.*

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YugShah1510/CipherChat.git
cd CipherChat
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Supabase

Create a Supabase project and configure the required authentication, database tables, Row Level Security policies, Realtime functionality, and private Storage bucket.

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

Replace the placeholder values with your own Supabase project credentials.

**Never commit your `.env` file or expose credentials in your repository.**

### 4. Run the Application

```bash
npm run dev
```

### 5. Build the Application

```bash
npm run build
```

## 🧪 Testing

The following workflows can be tested:

1. Register and log in with a user account.
2. Create or open a direct conversation.
3. Send and receive encrypted messages.
4. Create a group conversation.
5. Send messages in a group.
6. Add reactions to messages.
7. Select and upload multiple media files.
8. Verify that recipients can download and decrypt shared media.
9. Test the application using different user accounts.

## 📚 Documentation

- [Encrypted Media Upload and Sharing](docs/MEDIA_UPLOAD.md)

## 🎯 Project Objective

The objective of CipherChat is to explore desktop application development, real-time communication, database integration, cryptographic APIs, and secure file sharing.

It combines frontend development, backend services, and applied cryptography into one practical desktop application.

## 👨‍💻 Developer

**Yug Shah**

- GitHub: [@YugShah1510](https://github.com/YugShah1510)

---

*Built as a desktop application project using Electron, React, TypeScript, and Supabase.*