-- READ ONLY catalog preflight for the Mobile messaging and Desktop Realtime drafts.
-- Paste this SELECT into Supabase SQL Editor. It performs no database changes.
WITH
wanted_tables(table_name) AS (
  VALUES ('mobile_user_public_keys'), ('mobile_conversations'),
         ('mobile_conversation_members'), ('mobile_messages')
),
wanted_functions(function_name, arg_types, planned_signature) AS (
  VALUES ('is_current_user_mobile_member', ARRAY['uuid'::regtype::oid]::oid[], 'uuid'),
         ('register_mobile_public_key', ARRAY['jsonb'::regtype::oid]::oid[], 'jsonb'),
         ('search_mobile_users', ARRAY['text'::regtype::oid, 'integer'::regtype::oid]::oid[], 'text, integer'),
         ('create_mobile_direct_conversation', ARRAY['uuid'::regtype::oid]::oid[], 'uuid')
),
wanted_policies(table_name, policy_name) AS (
  VALUES ('mobile_user_public_keys', 'mobile_user_public_keys_authenticated_select'),
         ('mobile_conversations', 'mobile_conversations_member_select'),
         ('mobile_conversation_members', 'mobile_conversation_members_participant_select'),
         ('mobile_messages', 'mobile_messages_member_select'),
         ('mobile_messages', 'mobile_messages_member_sender_insert')
),
wanted_indexes(index_name) AS (
  VALUES ('mobile_conversation_members_user_id_idx'),
         ('mobile_conversations_created_by_idx'),
         ('mobile_messages_conversation_created_idx'),
         ('mobile_messages_sender_id_idx')
),
tables AS (
  SELECT w.table_name, c.oid, c.relkind, c.relowner, c.relrowsecurity, c.relforcerowsecurity
  FROM wanted_tables w
  LEFT JOIN pg_catalog.pg_class c
    ON c.relnamespace = 'public'::regnamespace AND c.relname = w.table_name
),
report AS (
  SELECT 'table'::text AS section, t.table_name AS object_name,
    jsonb_build_object(
      'exists', t.oid IS NOT NULL,
      'relation_kind', t.relkind,
      'owner', owner_role.rolname,
      'owner_bypasses_rls', owner_role.rolbypassrls,
      'owner_is_superuser', owner_role.rolsuper,
      'rls_enabled', t.relrowsecurity,
      'rls_forced', t.relforcerowsecurity,
      'columns', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
          'nullable', NOT a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
          'identity', a.attidentity, 'generated', a.attgenerated
        ) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
      ), '[]'::jsonb),
      'constraints', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', con.conname, 'type', con.contype,
          'definition', pg_get_constraintdef(con.oid, true)
        ) ORDER BY con.conname)
        FROM pg_catalog.pg_constraint con WHERE con.conrelid = t.oid
      ), '[]'::jsonb),
      'indexes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', idx.relname, 'definition', pg_get_indexdef(idx.oid)
        ) ORDER BY idx.relname)
        FROM pg_catalog.pg_index ix
        JOIN pg_catalog.pg_class idx ON idx.oid = ix.indexrelid
        WHERE ix.indrelid = t.oid
      ), '[]'::jsonb),
      'grants', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
          'privilege', acl.privilege_type, 'grantable', acl.is_grantable
        ) ORDER BY acl.grantee, acl.privilege_type)
        FROM pg_catalog.aclexplode(CASE WHEN c.oid IS NULL THEN NULL
          ELSE coalesce(c.relacl, acldefault('r', c.relowner)) END) acl
        LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = acl.grantee
      ), '[]'::jsonb)
    ) AS details
  FROM tables t
  LEFT JOIN pg_catalog.pg_class c ON c.oid = t.oid
  LEFT JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = t.relowner

  UNION ALL

  SELECT 'function'::text, w.function_name,
    jsonb_build_object(
      'planned_argument_types', w.planned_signature,
      'exact_signature_collision', EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc exact_p
        WHERE exact_p.pronamespace = 'public'::regnamespace
          AND exact_p.proname = w.function_name
          AND exact_p.proargtypes::oid[] = w.arg_types
      ),
      'same_name_overloads', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'identity_arguments', pg_get_function_identity_arguments(p.oid),
          'arguments', pg_get_function_arguments(p.oid),
          'result', pg_get_function_result(p.oid),
          'security_definer', p.prosecdef, 'settings', p.proconfig,
          'owner', owner_role.rolname,
          'owner_bypasses_rls', owner_role.rolbypassrls,
          'owner_is_superuser', owner_role.rolsuper,
          'grants', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grant_role.rolname END,
              'privilege', acl.privilege_type, 'grantable', acl.is_grantable
            ) ORDER BY acl.grantee, acl.privilege_type)
            FROM pg_catalog.aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            LEFT JOIN pg_catalog.pg_roles grant_role ON grant_role.oid = acl.grantee
          ), '[]'::jsonb)
        ) ORDER BY pg_get_function_identity_arguments(p.oid))
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.function_name
      ), '[]'::jsonb)
    )
  FROM wanted_functions w

  UNION ALL

  SELECT 'policy'::text, p.tablename || '.' || p.policyname,
    jsonb_build_object(
      'exists', true, 'permissive', p.permissive, 'roles', p.roles,
      'command', p.cmd, 'using', p.qual, 'with_check', p.with_check,
      'planned_name_collision', EXISTS (
        SELECT 1 FROM wanted_policies wp
        WHERE wp.table_name = p.tablename AND wp.policy_name = p.policyname
      )
    )
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN (SELECT table_name FROM wanted_tables)

  UNION ALL

  SELECT 'planned_policy_name'::text, wp.table_name || '.' || wp.policy_name,
    jsonb_build_object('exists', p.policyname IS NOT NULL)
  FROM wanted_policies wp
  LEFT JOIN pg_catalog.pg_policies p
    ON p.schemaname = 'public' AND p.tablename = wp.table_name
   AND p.policyname = wp.policy_name

  UNION ALL

  SELECT 'planned_index_name'::text, wi.index_name,
    jsonb_build_object(
      'exists_in_public_schema', idx.oid IS NOT NULL,
      'relation_using_name', table_row.relname
    )
  FROM wanted_indexes wi
  LEFT JOIN pg_catalog.pg_class idx
    ON idx.relnamespace = 'public'::regnamespace
   AND idx.relname = wi.index_name
   AND idx.relkind IN ('i', 'I')
  LEFT JOIN pg_catalog.pg_index ix ON ix.indexrelid = idx.oid
  LEFT JOIN pg_catalog.pg_class table_row ON table_row.oid = ix.indrelid

  UNION ALL

  SELECT 'schema_grant'::text, 'public',
    coalesce(jsonb_agg(jsonb_build_object(
      'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
      'privilege', acl.privilege_type, 'grantable', acl.is_grantable
    ) ORDER BY acl.grantee, acl.privilege_type), '[]'::jsonb)
  FROM pg_catalog.pg_namespace n
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
  ) acl
  LEFT JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT 'publication'::text, 'supabase_realtime',
    CASE WHEN pub.oid IS NULL THEN jsonb_build_object(
      'exists', false, 'published_tables', '[]'::jsonb
    ) ELSE jsonb_build_object(
      'exists', true, 'publish_all_tables', pub.puballtables,
      'publish_insert', pub.pubinsert, 'publish_update', pub.pubupdate,
      'publish_delete', pub.pubdelete, 'publish_truncate', pub.pubtruncate,
      'publish_via_partition_root', pub.pubviaroot,
      'published_tables', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'schema', pt.schemaname, 'table', pt.tablename,
          'desktop_repair_target', pt.schemaname = 'public'
            AND pt.tablename IN ('messages', 'message_reactions'),
          'mobile_migration_target', pt.schemaname = 'public'
            AND pt.tablename = 'mobile_messages',
          'unexpected_for_repair_preflight', NOT (
            pt.schemaname = 'public'
            AND pt.tablename IN ('messages', 'message_reactions', 'mobile_messages')
          )
        ) ORDER BY pt.schemaname, pt.tablename)
        FROM pg_catalog.pg_publication_tables pt
        WHERE pt.pubname = 'supabase_realtime'
      ), '[]'::jsonb)
    ) END
  FROM (SELECT 1) singleton
  LEFT JOIN pg_catalog.pg_publication pub ON pub.pubname = 'supabase_realtime'
)
SELECT section, object_name, details
FROM report
ORDER BY section, object_name;
