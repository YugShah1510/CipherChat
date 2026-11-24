-- CipherChat Mobile direct messaging only.
--
-- This migration assumes the identity-only deployment already created
-- public.mobile_user_public_keys, its own-key SELECT policy, grants, and
-- public.register_mobile_public_key(jsonb). It validates those prerequisites
-- and deliberately does not recreate or alter them. Desktop objects and
-- Realtime publication membership are outside this migration.

BEGIN;

DO $preflight$
DECLARE
  v_identity_table oid;
  v_existing_name text;
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Required auth.users table is missing.';
  END IF;
  IF pg_catalog.to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Required public.profiles table is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'Required Supabase roles authenticated/anon are missing.';
  END IF;

  v_identity_table := pg_catalog.to_regclass('public.mobile_user_public_keys');
  IF v_identity_table IS NULL THEN
    RAISE EXCEPTION 'The deployed Mobile identity table public.mobile_user_public_keys is missing; apply the identity-only deployment first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_identity_table AND attname = 'user_id'
      AND atttypid = 'uuid'::pg_catalog.regtype AND attnotnull AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_identity_table AND attname = 'public_key'
      AND atttypid = 'jsonb'::pg_catalog.regtype AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'The deployed Mobile identity table has an unexpected user_id/public_key signature.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'mobile_user_public_keys'
      AND policyname = 'mobile_user_public_keys_authenticated_select'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'The existing Mobile identity own-key SELECT policy is missing; inspect the identity deployment before continuing.';
  END IF;
  IF NOT (
    SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = v_identity_table
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on the deployed Mobile identity table.';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
    'authenticated', v_identity_table, 'SELECT'
  ) THEN
    RAISE EXCEPTION 'The authenticated role lacks the existing Mobile identity SELECT privilege; this migration will not change it.';
  END IF;
  IF pg_catalog.to_regprocedure('public.register_mobile_public_key(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'The deployed public.register_mobile_public_key(jsonb) RPC is missing.';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.register_mobile_public_key(jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'The authenticated role lacks EXECUTE on the existing registration RPC; this migration will not change it.';
  END IF;

  -- A collision is an error, not a reason to silently reuse an unknown object.
  FOREACH v_existing_name IN ARRAY ARRAY[
    'mobile_conversations',
    'mobile_conversation_members',
    'mobile_messages'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(v_existing_name)) IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_type
         WHERE typnamespace = 'public'::pg_catalog.regnamespace
           AND typname = v_existing_name
       ) THEN
      RAISE EXCEPTION 'Planned Mobile relation/type public.% already exists; inspect it before applying.', v_existing_name;
    END IF;
  END LOOP;

  FOREACH v_existing_name IN ARRAY ARRAY[
    'mobile_conversations_pkey',
    'mobile_conversations_direct_pair_key_key',
    'mobile_conversation_members_pkey',
    'mobile_conversation_members_user_id_idx',
    'mobile_conversations_created_by_idx',
    'mobile_messages_pkey',
    'mobile_messages_conversation_created_idx',
    'mobile_messages_sender_id_idx'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(v_existing_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'Planned Mobile index/relation name public.% is already occupied.', v_existing_name;
    END IF;
  END LOOP;

  FOREACH v_existing_name IN ARRAY ARRAY[
    'is_current_user_mobile_member',
    'search_mobile_users',
    'create_mobile_direct_conversation'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::pg_catalog.regnamespace
        AND proname = v_existing_name
    ) THEN
      RAISE EXCEPTION 'A public.% function already exists; inspect all overloads before applying.', v_existing_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND (
        (tablename = 'mobile_user_public_keys'
          AND policyname = 'mobile_user_public_keys_conversation_peer_select')
        OR (tablename = 'mobile_conversations'
          AND policyname = 'mobile_conversations_member_select')
        OR (tablename = 'mobile_conversation_members'
          AND policyname = 'mobile_conversation_members_participant_select')
        OR (tablename = 'mobile_messages'
          AND policyname IN (
            'mobile_messages_member_select',
            'mobile_messages_member_sender_insert'
          ))
      )
  ) THEN
    RAISE EXCEPTION 'A planned Mobile messaging RLS policy name already exists; inspect it before applying.';
  END IF;
END;
$preflight$;

CREATE TABLE public.mobile_conversations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  type text NOT NULL DEFAULT 'direct',
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  direct_pair_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT mobile_conversations_direct_only_check CHECK (type = 'direct')
);

CREATE TABLE public.mobile_conversation_members (
  conversation_id uuid NOT NULL
    REFERENCES public.mobile_conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX mobile_conversation_members_user_id_idx
  ON public.mobile_conversation_members (user_id, conversation_id);
CREATE INDEX mobile_conversations_created_by_idx
  ON public.mobile_conversations (created_by);

CREATE TABLE public.mobile_messages (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES public.mobile_conversations (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  -- This rejects obvious plaintext strings and enforces the existing Mobile
  -- version-1 envelope shape. It does NOT prove that the value is encrypted.
  CONSTRAINT mobile_messages_v1_envelope_check CHECK (
    CASE
      WHEN pg_catalog.jsonb_typeof(ciphertext::jsonb) <> 'object' THEN false
      ELSE pg_catalog.jsonb_object_length(ciphertext::jsonb) = 3
        AND ciphertext::jsonb -> 'version' = '1'::jsonb
        AND pg_catalog.jsonb_typeof(ciphertext::jsonb -> 'iv') = 'string'
        AND ciphertext::jsonb ->> 'iv' ~ '^[A-Za-z0-9+/]{16}$'
        AND pg_catalog.jsonb_typeof(ciphertext::jsonb -> 'ciphertext') = 'string'
        AND pg_catalog.length(ciphertext::jsonb ->> 'ciphertext') >= 24
        AND ciphertext::jsonb ->> 'ciphertext' ~
          '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    END
  )
);

CREATE INDEX mobile_messages_conversation_created_idx
  ON public.mobile_messages (conversation_id, created_at, id);
CREATE INDEX mobile_messages_sender_id_idx
  ON public.mobile_messages (sender_id);

ALTER TABLE public.mobile_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_messages ENABLE ROW LEVEL SECURITY;

-- Policies call this narrowly scoped helper to avoid recursive membership RLS.
-- Its only answer is whether auth.uid() belongs to the supplied conversation.
CREATE FUNCTION public.is_current_user_mobile_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.mobile_conversation_members AS member_row
    WHERE member_row.conversation_id = p_conversation_id
      AND member_row.user_id = auth.uid()
  );
END;
$function$;

-- Search returns only names of accounts that have registered a Mobile key.
-- It does not expose email addresses or query Desktop messaging data.
CREATE FUNCTION public.search_mobile_users(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, full_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_query text := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_query, '')));
  v_pattern text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mobile_user_public_keys AS key_row
    WHERE key_row.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Mobile identity registration is required to search Mobile users.'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(v_query) < 2 OR pg_catalog.length(v_query) > 80 THEN
    RAISE EXCEPTION 'Search text must be between 2 and 80 characters.' USING ERRCODE = '22023';
  END IF;

  -- Treat LIKE wildcard characters as literal input supplied by the user.
  v_query := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(v_query, E'\\', E'\\\\'), '%', E'\\%'
    ), '_', E'\\_'
  );
  v_pattern := '%' || v_query || '%';

  RETURN QUERY
    SELECT profile_row.id, profile_row.full_name::text
    FROM public.profiles AS profile_row
    JOIN public.mobile_user_public_keys AS key_row
      ON key_row.user_id = profile_row.id
    WHERE profile_row.id <> v_user_id
      AND profile_row.full_name ILIKE v_pattern ESCAPE E'\\'
    ORDER BY profile_row.full_name, profile_row.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
END;
$function$;

-- Serialize creation for the same canonical pair and retain a unique key as a
-- second guard. Conversation and both memberships commit as one RPC transaction.
CREATE FUNCTION public.create_mobile_direct_conversation(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_pair_key text;
  v_conversation_id uuid;
  v_attempt integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '28000';
  END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = v_user_id THEN
    RAISE EXCEPTION 'Choose another Mobile user.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mobile_user_public_keys AS key_row
    WHERE key_row.user_id = v_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mobile_user_public_keys AS key_row
    WHERE key_row.user_id = p_other_user_id
  ) THEN
    RAISE EXCEPTION 'Both participants must have a registered Mobile identity.'
      USING ERRCODE = '23503';
  END IF;

  v_pair_key := LEAST(v_user_id::text, p_other_user_id::text)
    || ':' || GREATEST(v_user_id::text, p_other_user_id::text);

  LOOP
    SELECT conversation_row.id
      INTO v_conversation_id
    FROM public.mobile_conversations AS conversation_row
    WHERE conversation_row.direct_pair_key = v_pair_key
    FOR UPDATE;
    IF FOUND THEN
      EXIT;
    END IF;

    INSERT INTO public.mobile_conversations (created_by, direct_pair_key)
    VALUES (v_user_id, v_pair_key)
    ON CONFLICT (direct_pair_key) DO NOTHING
    RETURNING id INTO v_conversation_id;
    IF FOUND THEN
      EXIT;
    END IF;

    -- Under READ COMMITTED the next loop iteration sees the winning insert.
    -- Fail safely under snapshots that cannot see it; the unique key prevents duplicates.
    v_attempt := v_attempt + 1;
    IF v_attempt >= 3 THEN
      RAISE EXCEPTION 'Concurrent conversation creation; retry the request.'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  INSERT INTO public.mobile_conversation_members (conversation_id, user_id)
  VALUES (v_conversation_id, v_user_id), (v_conversation_id, p_other_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$function$;

-- Keep the deployed own-key policy intact; this additional permissive SELECT
-- policy reveals a peer's public key only after shared Mobile membership exists.
CREATE POLICY mobile_user_public_keys_conversation_peer_select
  ON public.mobile_user_public_keys
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.mobile_conversation_members AS peer_member
      WHERE peer_member.user_id = mobile_user_public_keys.user_id
        AND public.is_current_user_mobile_member(peer_member.conversation_id)
    )
  );

CREATE POLICY mobile_conversations_member_select
  ON public.mobile_conversations
  FOR SELECT TO authenticated
  USING (public.is_current_user_mobile_member(id));

CREATE POLICY mobile_conversation_members_participant_select
  ON public.mobile_conversation_members
  FOR SELECT TO authenticated
  USING (public.is_current_user_mobile_member(conversation_id));

CREATE POLICY mobile_messages_member_select
  ON public.mobile_messages
  FOR SELECT TO authenticated
  USING (public.is_current_user_mobile_member(conversation_id));

CREATE POLICY mobile_messages_member_sender_insert
  ON public.mobile_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_current_user_mobile_member(conversation_id)
  );

-- New messaging tables only: participants can read, and message writers can
-- insert only as their own Auth user. There are no client update/delete grants.
REVOKE ALL ON TABLE public.mobile_conversations,
  public.mobile_conversation_members,
  public.mobile_messages
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.mobile_conversations TO authenticated;
GRANT SELECT ON TABLE public.mobile_conversation_members TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mobile_messages TO authenticated;

REVOKE ALL ON FUNCTION public.is_current_user_mobile_member(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.search_mobile_users(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_mobile_direct_conversation(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_current_user_mobile_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_mobile_users(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_mobile_direct_conversation(uuid) TO authenticated;

COMMIT;
