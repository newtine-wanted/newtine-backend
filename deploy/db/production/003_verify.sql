-- NEWTINE production schema/seed verification.
-- Read-only checks. Run after 001_schema.sql and 002_seed.sql.

SELECT current_database() AS database_name,
       current_user AS database_user,
       current_schema() AS schema_name;

DO $$
DECLARE
  required_table text;
  required_tables constant text[] := ARRAY[
    'ai_usage_records',
    'articles',
    'entities',
    'feed_batch_items',
    'feed_batches',
    'feed_sessions',
    'issue_articles',
    'issue_categories',
    'issue_content_jobs',
    'issue_detail_views',
    'issue_details',
    'issue_embedding_tasks',
    'issue_embeddings',
    'issue_entities',
    'issue_impacts',
    'issue_relations',
    'issue_seed_articles',
    'issues',
    'pipeline_runs',
    'publishers',
    'refresh_sessions',
    'regions',
    'user_category_preferences',
    'user_entity_preferences',
    'user_interaction_events',
    'user_issue_contributions',
    'user_region_preferences',
    'users',
    'weekly_reports'
  ];
  required_index text;
  required_indexes constant text[] := ARRAY[
    'users_email_canonical_unique',
    'user_interaction_events_user_issue_created_idx',
    'user_interaction_events_user_issue_order_idx',
    'weekly_reports_claim_idx'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'Required extension vector is missing';
  END IF;

  FOREACH required_table IN ARRAY required_tables LOOP
    IF to_regclass(format('public.%I', required_table)) IS NULL THEN
      RAISE EXCEPTION 'Required table is missing: %', required_table;
    END IF;
  END LOOP;

  FOREACH required_index IN ARRAY required_indexes LOOP
    IF to_regclass(format('public.%I', required_index)) IS NULL THEN
      RAISE EXCEPTION 'Required index is missing: %', required_index;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'issue_embeddings'
       AND column_name = 'embedding'
       AND udt_name = 'vector'
  ) THEN
    RAISE EXCEPTION 'issue_embeddings.embedding must use the vector type';
  END IF;

  IF (SELECT count(*) FROM public.issue_categories) <> 10 THEN
    RAISE EXCEPTION 'Expected exactly 10 issue categories, found %',
      (SELECT count(*) FROM public.issue_categories);
  END IF;

  IF (SELECT count(*) FROM public.regions) <> 17 THEN
    RAISE EXCEPTION 'Expected exactly 17 regions, found %',
      (SELECT count(*) FROM public.regions);
  END IF;
END
$$;

SELECT 'issue_categories' AS seed_name, count(*) AS row_count
  FROM public.issue_categories
UNION ALL
SELECT 'regions', count(*)
  FROM public.regions;

SELECT code, display_name, display_order
  FROM public.issue_categories
 ORDER BY display_order, code;

SELECT code, name, display_order
  FROM public.regions
 ORDER BY display_order, code;
