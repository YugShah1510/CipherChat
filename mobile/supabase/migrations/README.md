# Mobile direct messaging migration

This migration adds the database foundation for **Mobile direct chats only**.
It does not enable chat routes in the app and does not configure Realtime.
The database stores the existing encrypted envelope string; it cannot prove
that a client actually encrypted the contents.

## Deployment order

1. Confirm the identity-only deployment has already been applied. It must
   provide `public.mobile_user_public_keys`,
   `public.register_mobile_public_key(jsonb)`, the
   `mobile_user_public_keys_authenticated_select` policy, and the existing
   identity-table grants/RLS. This migration checks those prerequisites and
   stops if they are missing. It intentionally does not change them.
2. Review and apply
   [`20261124000000_mobile_direct_messaging.sql`](20261124000000_mobile_direct_messaging.sql)
   once through the approved deployment process. The transaction contains
   collision checks and rolls back on an error. Do not apply the older full
   messaging draft: it also tries to create the already-deployed identity
   objects.
3. Run the read-only verification queries below. Do not expose public-key or
   message payload values when sharing the results.
4. Keep Mobile chat routes gated until client-side Mobile-only table queries,
   encryption/decryption, and two-account direct-chat tests are implemented
   and verified. Realtime is a separate later deployment.

## Read-only verification queries

Confirm the new tables, columns, types, and row-level security flags:

```sql
SELECT c.relname AS table_name, a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null, c.relrowsecurity AS rls_enabled
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('mobile_conversations', 'mobile_conversation_members', 'mobile_messages')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;
```

Confirm policies, including the preserved own-key policy and the added
conversation-scoped peer-key policy:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND (tablename IN ('mobile_conversations', 'mobile_conversation_members', 'mobile_messages')
       OR (tablename = 'mobile_user_public_keys'
           AND policyname IN ('mobile_user_public_keys_authenticated_select',
                              'mobile_user_public_keys_conversation_peer_select')))
ORDER BY tablename, policyname;
```

Confirm table grants without selecting any user keys or message contents:

```sql
SELECT table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('mobile_user_public_keys', 'mobile_conversations',
                     'mobile_conversation_members', 'mobile_messages')
ORDER BY table_name, grantee, privilege_type;
```

Confirm RPC signatures, security-definer status, fixed search path, and
authenticated execute access:

```sql
SELECT p.oid::pg_catalog.regprocedure AS signature,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_current_user_mobile_member', 'search_mobile_users',
                    'create_mobile_direct_conversation', 'register_mobile_public_key')
ORDER BY p.proname, signature::text;
```

Confirm this migration did not add or remove Realtime publication tables:

```sql
SELECT pub.pubname, pub.pubinsert, pub.pubupdate, pub.pubdelete, pub.pubtruncate,
       pt.schemaname, pt.tablename
FROM pg_catalog.pg_publication AS pub
LEFT JOIN pg_catalog.pg_publication_tables AS pt ON pt.pubname = pub.pubname
WHERE pub.pubname = 'supabase_realtime'
ORDER BY pt.schemaname, pt.tablename;
```

The identity registration RPC and identity-table grants/policies should match
the results recorded immediately after the identity-only deployment. This
migration adds only one new identity-table policy, allowing authenticated
conversation members to read the other participant's **public** key.

## Security notes and limits

- The new tables are Mobile-namespaced and their RLS policies restrict
  conversations, memberships, and messages to members. Message inserts also
  require `sender_id = auth.uid()`. Authenticated clients receive no message
  update/delete privileges from this migration.
- The peer-key policy exposes a public key only when its owner shares a Mobile
  conversation with the requesting user. Key registration and private-key
  storage remain governed by the previously deployed identity flow.
- Search returns only names for accounts with a registered Mobile key. It
  does not return email addresses.
- P-256 JWK shape checks in the identity registration flow do not establish
  that `x` and `y` encode a valid curve point. The server does not verify
  private-key possession. Client validation is not a server-side guarantee.
- The envelope constraint checks a JSON/base64 shape consistent with the
  Mobile version-1 envelope. It cannot verify AES-GCM authenticity or prove
  ciphertext is not plaintext disguised as a valid envelope. Encryption must
  be done correctly by trusted client code before insertion.
- Separate tables and RLS partition the intended application flows, but the
  same Supabase Auth token has the same `auth.uid()` in both apps. A modified
  client can call Mobile APIs directly and separation alone cannot prove
  client origin. Enforcing origin requires a trusted authorization boundary
  (for example, server-verified platform claims or separate auth projects).
- `ON DELETE RESTRICT` means Auth account deletion can fail while the user is
  referenced by a Mobile identity, conversation creator, membership, or
  message. Define a deliberate account-cleanup lifecycle before enabling
  account deletion.
- This is direct-chat schema only. No groups, media, reactions, or Realtime
  publication changes are included. Do not enable application messaging
  until the client integration and interoperability tests are complete.
