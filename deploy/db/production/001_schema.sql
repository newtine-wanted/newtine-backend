-- NEWTINE production baseline schema.
-- Apply only to an empty production database after reviewing the target and backup policy.
-- Generated from the current application-owned schema and intentionally excludes
-- local smoke_environment_marker and MikroORM migration bookkeeping tables.
-- Prerequisite: PostgreSQL with the pgvector extension available.
BEGIN;
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';
CREATE FUNCTION public.issue_card_summary_lines_valid(value jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  line jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(value) <> 3 then
    return false;
  end if;
  for line in
    select element
      from jsonb_array_elements(value) as element
  loop
    if jsonb_typeof(line) <> 'string' or length(btrim(line #>> '{}')) = 0 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
SET default_tablespace = '';
SET default_table_access_method = heap;
CREATE TABLE public.ai_usage_records (
    id uuid NOT NULL,
    pipeline_run_id uuid,
    issue_content_job_id uuid,
    run_attempt integer NOT NULL,
    operation text NOT NULL,
    purpose text NOT NULL,
    prompt_version text,
    prompt_hash text,
    provider text NOT NULL,
    status text NOT NULL,
    model text,
    provider_request_id text,
    input_tokens integer,
    output_tokens integer,
    actual_cost numeric,
    error_code text,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    weekly_report_id uuid
);
CREATE TABLE public.articles (
    id uuid NOT NULL,
    publisher_id uuid,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    article_url text NOT NULL,
    naver_url text,
    publisher_name text DEFAULT 'unknown'::text NOT NULL,
    published_at timestamp with time zone,
    source_status text DEFAULT 'AVAILABLE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.entities (
    id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    subtitle text,
    aliases text[] DEFAULT ARRAY[]::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.feed_batch_items (
    feed_session_id uuid NOT NULL,
    batch_no integer NOT NULL,
    "position" integer NOT NULL,
    issue_id uuid NOT NULL,
    selection_type text NOT NULL,
    reason_codes jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.feed_batches (
    feed_session_id uuid NOT NULL,
    batch_no integer NOT NULL,
    continuation text NOT NULL,
    created_at timestamp with time zone NOT NULL
);
CREATE TABLE public.feed_sessions (
    id uuid NOT NULL,
    user_id uuid,
    algorithm_version text NOT NULL,
    next_batch_no integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_topic text,
    last_representative_entity_id uuid,
    topic_run integer DEFAULT 0 NOT NULL,
    entity_run integer DEFAULT 0 NOT NULL,
    guest_token_hash text,
    candidate_budget integer DEFAULT 100 NOT NULL,
    high_score_threshold numeric DEFAULT 0.7 NOT NULL
);
CREATE TABLE public.issue_articles (
    issue_id uuid NOT NULL,
    article_id uuid NOT NULL,
    sort_order integer
);
CREATE TABLE public.issue_categories (
    display_name text CONSTRAINT issue_categories_name_not_null NOT NULL,
    code text NOT NULL,
    display_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.issue_content_jobs (
    id uuid NOT NULL,
    issue_id uuid NOT NULL,
    pipeline_run_id uuid,
    status text NOT NULL,
    stage text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    failure_kind text,
    validation_status text,
    validation_reason text,
    last_error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.issue_detail_views (
    view_id uuid NOT NULL,
    user_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    session_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    active_ms integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.issue_details (
    id uuid NOT NULL,
    issue_id uuid NOT NULL,
    integrated_summary text NOT NULL,
    summary_lines jsonb NOT NULL,
    viewpoints jsonb,
    glossary jsonb DEFAULT '[]'::jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.issue_embedding_tasks (
    id uuid NOT NULL,
    issue_id uuid NOT NULL,
    pipeline_run_id uuid NOT NULL,
    issue_content_job_id uuid NOT NULL,
    run_attempt integer NOT NULL,
    run_execution_id uuid,
    input_hash text NOT NULL,
    model text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    claim_token uuid,
    claimed_by_process_execution_id uuid,
    claimed_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.issue_embeddings (
    id uuid NOT NULL,
    issue_id uuid NOT NULL,
    embedding public.vector(1536) NOT NULL,
    model text NOT NULL,
    dimension integer NOT NULL,
    input_hash text NOT NULL,
    input_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.issue_entities (
    issue_entities_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    entity_id uuid NOT NULL
);
CREATE TABLE public.issue_impacts (
    id uuid NOT NULL,
    issue_id uuid NOT NULL,
    target_type text NOT NULL,
    target_value text NOT NULL,
    description text NOT NULL,
    article_ids jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.issue_relations (
    from_issue_id uuid NOT NULL,
    to_issue_id uuid NOT NULL,
    relation_type text NOT NULL,
    reason text NOT NULL,
    evidence_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    verified_at timestamp with time zone NOT NULL
);
CREATE TABLE public.issue_seed_articles (
    issue_id uuid NOT NULL,
    article_id uuid NOT NULL
);
CREATE TABLE public.issues (
    id uuid NOT NULL,
    category_code text NOT NULL,
    title text NOT NULL,
    publication_status text NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    event_at timestamp with time zone,
    sub_category text,
    freshness_score numeric DEFAULT 0 NOT NULL,
    importance_score numeric DEFAULT 0 NOT NULL,
    main_topic text,
    representative_entity_id uuid
);
CREATE TABLE public.pipeline_runs (
    id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    request_json jsonb NOT NULL,
    status text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    retry_scope text,
    retry_job_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    execution_id uuid,
    current_stage text,
    candidate_counts jsonb DEFAULT '{"created": 0, "duplicate": 0, "uncertain": 0, "discovered": 0, "skippedByLimit": 0}'::jsonb NOT NULL,
    embedding_pending_count integer DEFAULT 0 NOT NULL,
    last_error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.publishers (
    id uuid NOT NULL,
    name text NOT NULL,
    homepage_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.refresh_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);
CREATE TABLE public.regions (
    code text NOT NULL,
    name text NOT NULL,
    display_order integer NOT NULL
);
CREATE TABLE public.user_category_preferences (
    user_category_preferences_id uuid NOT NULL,
    user_id uuid NOT NULL,
    weight numeric NOT NULL,
    category_code text NOT NULL
);
CREATE TABLE public.user_entity_preferences (
    user_entity_preferences_id uuid NOT NULL,
    user_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    weight numeric NOT NULL
);
CREATE TABLE public.user_interaction_events (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    dwell_time integer,
    previous_action text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_order bigint NOT NULL
);
CREATE SEQUENCE public.user_interaction_events_accepted_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.user_interaction_events_accepted_order_seq OWNED BY public.user_interaction_events.accepted_order;
CREATE TABLE public.user_issue_contributions (
    user_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    category_code text NOT NULL,
    action_score numeric DEFAULT 0 NOT NULL,
    credited_dwell_ms integer DEFAULT 0 NOT NULL,
    dwell_score numeric DEFAULT 0 NOT NULL,
    last_action_event_id uuid,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
CREATE TABLE public.user_region_preferences (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    region_code text NOT NULL,
    weight numeric NOT NULL
);
CREATE TABLE public.users (
    id uuid NOT NULL,
    email text,
    onboarding_status text DEFAULT 'PENDING'::text NOT NULL,
    onboarding_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    age_group text,
    password_hash text,
    role text DEFAULT 'USER'::text NOT NULL
);
CREATE TABLE public.weekly_reports (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text NOT NULL,
    input_snapshot jsonb NOT NULL,
    input_version integer DEFAULT 1 NOT NULL,
    input_captured_at timestamp with time zone NOT NULL,
    input_hash text NOT NULL,
    candidates jsonb,
    content jsonb,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    last_error_code text,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    model text,
    prompt_version text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retryable boolean DEFAULT false NOT NULL
);
ALTER TABLE ONLY public.user_interaction_events ALTER COLUMN accepted_order SET DEFAULT nextval('public.user_interaction_events_accepted_order_seq'::regclass);
ALTER TABLE ONLY public.ai_usage_records
    ADD CONSTRAINT ai_usage_records_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_article_url_key UNIQUE (article_url);
ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.feed_batch_items
    ADD CONSTRAINT feed_batch_items_pkey PRIMARY KEY (feed_session_id, batch_no, "position");
ALTER TABLE ONLY public.feed_batches
    ADD CONSTRAINT feed_batches_pkey PRIMARY KEY (feed_session_id, batch_no);
ALTER TABLE ONLY public.feed_sessions
    ADD CONSTRAINT feed_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_articles
    ADD CONSTRAINT issue_articles_pkey PRIMARY KEY (issue_id, article_id);
ALTER TABLE ONLY public.issue_categories
    ADD CONSTRAINT issue_categories_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.issue_content_jobs
    ADD CONSTRAINT issue_content_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_detail_views
    ADD CONSTRAINT issue_detail_views_pkey PRIMARY KEY (view_id);
ALTER TABLE ONLY public.issue_details
    ADD CONSTRAINT issue_details_issue_id_key UNIQUE (issue_id);
ALTER TABLE ONLY public.issue_details
    ADD CONSTRAINT issue_details_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_embedding_tasks
    ADD CONSTRAINT issue_embedding_tasks_issue_id_key UNIQUE (issue_id);
ALTER TABLE ONLY public.issue_embedding_tasks
    ADD CONSTRAINT issue_embedding_tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_embeddings
    ADD CONSTRAINT issue_embeddings_issue_id_key UNIQUE (issue_id);
ALTER TABLE ONLY public.issue_embeddings
    ADD CONSTRAINT issue_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_entities
    ADD CONSTRAINT issue_entities_pkey PRIMARY KEY (issue_entities_id);
ALTER TABLE ONLY public.issue_impacts
    ADD CONSTRAINT issue_impacts_issue_id_target_type_target_value_key UNIQUE (issue_id, target_type, target_value);
ALTER TABLE ONLY public.issue_impacts
    ADD CONSTRAINT issue_impacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_relations
    ADD CONSTRAINT issue_relations_pkey PRIMARY KEY (from_issue_id, to_issue_id, relation_type);
ALTER TABLE ONLY public.issue_seed_articles
    ADD CONSTRAINT issue_seed_articles_pkey PRIMARY KEY (issue_id, article_id);
ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.publishers
    ADD CONSTRAINT publishers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_token_hash_unique UNIQUE (token_hash);
ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.user_category_preferences
    ADD CONSTRAINT user_category_preferences_pkey PRIMARY KEY (user_category_preferences_id);
ALTER TABLE ONLY public.user_category_preferences
    ADD CONSTRAINT user_category_preferences_user_category_code_unique UNIQUE (user_id, category_code);
ALTER TABLE ONLY public.user_entity_preferences
    ADD CONSTRAINT user_entity_preferences_pkey PRIMARY KEY (user_entity_preferences_id);
ALTER TABLE ONLY public.user_entity_preferences
    ADD CONSTRAINT user_entity_preferences_user_entity_unique UNIQUE (user_id, entity_id);
ALTER TABLE ONLY public.user_interaction_events
    ADD CONSTRAINT user_interaction_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_issue_contributions
    ADD CONSTRAINT user_issue_contributions_pkey PRIMARY KEY (user_id, issue_id);
ALTER TABLE ONLY public.user_region_preferences
    ADD CONSTRAINT user_region_preferences_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_region_preferences
    ADD CONSTRAINT user_region_preferences_user_region_unique UNIQUE (user_id, region_code);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.weekly_reports
    ADD CONSTRAINT weekly_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.weekly_reports
    ADD CONSTRAINT weekly_reports_user_period_unique UNIQUE (user_id, period_start);
CREATE INDEX ai_usage_records_run_idx ON public.ai_usage_records USING btree (pipeline_run_id, run_attempt, started_at);
CREATE INDEX ai_usage_records_weekly_report_idx ON public.ai_usage_records USING btree (weekly_report_id, started_at, id) WHERE (weekly_report_id IS NOT NULL);
CREATE INDEX feed_sessions_member_active_idx ON public.feed_sessions USING btree (user_id, status, expires_at) WHERE (user_id IS NOT NULL);
CREATE INDEX issue_content_jobs_run_idx ON public.issue_content_jobs USING btree (pipeline_run_id, created_at, id);
CREATE INDEX issue_detail_views_user_issue_idx ON public.issue_detail_views USING btree (user_id, issue_id);
CREATE INDEX issue_embedding_tasks_claim_owner_idx ON public.issue_embedding_tasks USING btree (status, claimed_by_process_execution_id) WHERE (status = 'RUNNING'::text);
CREATE INDEX issue_embedding_tasks_pending_idx ON public.issue_embedding_tasks USING btree (status, updated_at, id);
CREATE INDEX issue_entities_entity_idx ON public.issue_entities USING btree (entity_id, issue_id);
CREATE INDEX issue_relations_from_verified_idx ON public.issue_relations USING btree (from_issue_id, verified_at, to_issue_id) WHERE ((relation_type = 'FOLLOW_UP'::text) AND (verified_at IS NOT NULL));
CREATE UNIQUE INDEX pipeline_runs_one_active_idx ON public.pipeline_runs USING btree ((1)) WHERE (status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));
CREATE INDEX refresh_sessions_user_id_idx ON public.refresh_sessions USING btree (user_id);
CREATE INDEX user_interaction_events_user_created_idx ON public.user_interaction_events USING btree (user_id, created_at DESC);
CREATE INDEX user_interaction_events_user_issue_order_idx ON public.user_interaction_events USING btree (user_id, issue_id, accepted_order DESC, id DESC);
CREATE UNIQUE INDEX users_email_canonical_unique ON public.users USING btree (lower(btrim(email))) WHERE (email IS NOT NULL);
CREATE INDEX weekly_reports_claim_idx ON public.weekly_reports USING btree (status, next_attempt_at, requested_at, id) WHERE (status = 'QUEUED'::text);
CREATE INDEX weekly_reports_expired_lease_idx ON public.weekly_reports USING btree (lease_expires_at, id) WHERE (status = 'RUNNING'::text);
ALTER TABLE ONLY public.ai_usage_records
    ADD CONSTRAINT ai_usage_records_weekly_report_fk FOREIGN KEY (weekly_report_id) REFERENCES public.weekly_reports(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.feed_batch_items
    ADD CONSTRAINT feed_batch_items_feed_session_id_batch_no_fkey FOREIGN KEY (feed_session_id, batch_no) REFERENCES public.feed_batches(feed_session_id, batch_no) ON DELETE CASCADE;
ALTER TABLE ONLY public.feed_batches
    ADD CONSTRAINT feed_batches_feed_session_id_fkey FOREIGN KEY (feed_session_id) REFERENCES public.feed_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.feed_sessions
    ADD CONSTRAINT feed_sessions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.issue_detail_views
    ADD CONSTRAINT issue_detail_views_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_category_preferences
    ADD CONSTRAINT user_category_preferences_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_entity_preferences
    ADD CONSTRAINT user_entity_preferences_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_interaction_events
    ADD CONSTRAINT user_interaction_events_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_issue_contributions
    ADD CONSTRAINT user_issue_contributions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_region_preferences
    ADD CONSTRAINT user_region_preferences_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.weekly_reports
    ADD CONSTRAINT weekly_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
COMMIT;
