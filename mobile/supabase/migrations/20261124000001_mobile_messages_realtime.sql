-- Add only the Mobile message table to the existing Realtime publication.
-- Publication event flags are checked, never changed, because they affect every
-- table already published in this Supabase project.
BEGIN;

DO $migration$
DECLARE
  v_publication_all_tables boolean;
  v_publication_insert boolean;
BEGIN
  IF pg_catalog.to_regclass('public.mobile_messages') IS NULL THEN
    RAISE EXCEPTION 'Required table public.mobile_messages is missing; deploy the Mobile direct-messaging migration first.';
  END IF;

  SELECT puballtables, pubinsert
    INTO v_publication_all_tables, v_publication_insert
  FROM pg_catalog.pg_publication
  WHERE pubname = 'supabase_realtime';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication supabase_realtime is missing; create/review it through the approved database process.';
  END IF;
  IF NOT v_publication_insert THEN
    RAISE EXCEPTION 'Publication supabase_realtime does not publish INSERT events; this migration will not change its global event flags.';
  END IF;

  -- A FOR ALL TABLES publication already includes Mobile messages implicitly.
  IF NOT v_publication_all_tables AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mobile_messages'
  ) THEN
    -- Check catalog membership first so rerunning this block does not duplicate it.
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_messages';
  END IF;
END;
$migration$;

COMMIT;
