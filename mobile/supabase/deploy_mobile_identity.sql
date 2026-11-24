-- CipherChat Mobile identity provisioning only.
-- This is transactional and deliberately creates no conversation, message,
-- Realtime, or Desktop objects. Its preflight aborts on relevant collisions.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Required table auth.users is missing; no Mobile identity objects were created.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION 'Required Supabase roles authenticated/anon are missing; no Mobile identity objects were created.';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
    'authenticated'::pg_catalog.name,
    'public'::pg_catalog.name,
    'USAGE'
  ) THEN
    RAISE EXCEPTION 'The authenticated role lacks USAGE on schema public; review schema grants before deploying Mobile identity objects.';
  END IF;

  IF pg_catalog.to_regclass('public.mobile_user_public_keys') IS NOT NULL THEN
    RAISE EXCEPTION 'public.mobile_user_public_keys already exists; inspect it and stop rather than replacing it.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS existing_type
    WHERE existing_type.typnamespace = 'public'::pg_catalog.regnamespace
      AND existing_type.typname = 'mobile_user_public_keys'
  ) THEN
    RAISE EXCEPTION 'The planned mobile_user_public_keys row type name is already occupied.';
  END IF;

  -- CREATE TABLE would also create this primary-key index; fail clearly if its
  -- relation name is already occupied anywhere in the public schema.
  IF pg_catalog.to_regclass('public.mobile_user_public_keys_pkey') IS NOT NULL THEN
    RAISE EXCEPTION 'The planned mobile_user_public_keys_pkey relation name is already occupied.';
  END IF;

  -- Reject every overload of this RPC name so PostgREST cannot encounter an
  -- ambiguous or pre-existing implementation during Mobile identity setup.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS existing_function
    WHERE existing_function.pronamespace = 'public'::pg_catalog.regnamespace
      AND existing_function.proname = 'register_mobile_public_key'
  ) THEN
    RAISE EXCEPTION 'A public.register_mobile_public_key function already exists; inspect its signature and grants before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS existing_policy
    WHERE existing_policy.schemaname = 'public'
      AND existing_policy.tablename = 'mobile_user_public_keys'
      AND existing_policy.policyname = 'mobile_user_public_keys_authenticated_select'
  ) THEN
    RAISE EXCEPTION 'The planned Mobile public-key policy already exists; inspect it before continuing.';
  END IF;
END;
$preflight$;

CREATE TABLE public.mobile_user_public_keys (
  user_id uuid PRIMARY KEY
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  public_key jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT mobile_user_public_keys_public_jwk_check CHECK (
    COALESCE(
      pg_catalog.jsonb_typeof(public_key) = 'object'
      AND public_key ->> 'kty' = 'EC'
      AND public_key ->> 'crv' = 'P-256'
      AND pg_catalog.jsonb_typeof(public_key -> 'x') = 'string'
      AND (public_key ->> 'x') ~ '^[A-Za-z0-9_-]{43}$'
      AND pg_catalog.jsonb_typeof(public_key -> 'y') = 'string'
      AND (public_key ->> 'y') ~ '^[A-Za-z0-9_-]{43}$'
      AND NOT (public_key ? 'd'),
      false
    )
  )
);

ALTER TABLE public.mobile_user_public_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY mobile_user_public_keys_authenticated_select
  ON public.mobile_user_public_keys
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.mobile_user_public_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mobile_user_public_keys TO authenticated;

-- Only a public JWK is accepted. The authenticated account ID comes from the
-- Supabase JWT, so a caller cannot register a key for a different user.
CREATE FUNCTION public.register_mobile_public_key(p_public_key jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_canonical_key jsonb;
  v_registered_key jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '28000';
  END IF;

  IF NOT COALESCE(
    pg_catalog.jsonb_typeof(p_public_key) = 'object'
    AND p_public_key ->> 'kty' = 'EC'
    AND p_public_key ->> 'crv' = 'P-256'
    AND pg_catalog.jsonb_typeof(p_public_key -> 'x') = 'string'
    AND (p_public_key ->> 'x') ~ '^[A-Za-z0-9_-]{43}$'
    AND pg_catalog.jsonb_typeof(p_public_key -> 'y') = 'string'
    AND (p_public_key ->> 'y') ~ '^[A-Za-z0-9_-]{43}$'
    AND NOT (p_public_key ? 'd'),
    false
  ) THEN
    RAISE EXCEPTION 'A public P-256 JWK is required.' USING ERRCODE = '22023';
  END IF;

  -- This SQL check validates public-JWK shape and Base64URL length, not that
  -- the coordinates lie on P-256. The official Mobile client verifies its
  -- generated pair locally; a hostile direct RPC caller can still submit a
  -- syntactically shaped but invalid point. Server-side curve validation is
  -- a separate hardening requirement before treating this registry as trusted.

  -- Keep only public coordinates. Optional JWK metadata and property order do
  -- not affect identity equality, and private scalar material is never stored.
  v_canonical_key := pg_catalog.jsonb_build_object(
    'kty', 'EC', 'crv', 'P-256',
    'x', p_public_key ->> 'x',
    'y', p_public_key ->> 'y'
  );

  -- A repeated identical registration is safe. A different key can never
  -- replace the original; the comparison below rejects that conflict.
  INSERT INTO public.mobile_user_public_keys (user_id, public_key)
  VALUES (v_user_id, v_canonical_key)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT key_row.public_key
    INTO v_registered_key
  FROM public.mobile_user_public_keys AS key_row
  WHERE key_row.user_id = v_user_id;

  IF v_registered_key IS DISTINCT FROM v_canonical_key THEN
    RAISE EXCEPTION 'A different Mobile identity is already registered for this account.'
      USING ERRCODE = '23505';
  END IF;

  RETURN v_registered_key;
END;
$function$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; revoke that default and
-- allow only authenticated Mobile clients to invoke this identity RPC.
REVOKE ALL ON FUNCTION public.register_mobile_public_key(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_mobile_public_key(jsonb)
  TO authenticated;

COMMIT;
