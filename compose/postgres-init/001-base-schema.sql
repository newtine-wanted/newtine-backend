-- Local-only disposable base schema for the Compose acceptance environment.
-- Production databases keep the G12-A contract: this schema is owned by the
-- existing base-schema owner and is not replaced by this fixture.

BEGIN;

CREATE TABLE users (
  id uuid NOT NULL,
  kakao_id text,
  email text,
  onboarding_status text NOT NULL DEFAULT 'PENDING',
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_onboarding_status_check
    CHECK (onboarding_status IN ('PENDING', 'COMPLETED', 'SKIPPED'))
);

CREATE TABLE entities (
  id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  subtitle text,
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_pkey PRIMARY KEY (id)
);

CREATE TABLE issue_categories (
  id uuid NOT NULL,
  name text NOT NULL,
  CONSTRAINT issue_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE user_category_preferences (
  user_category_preferences_id uuid NOT NULL,
  user_id uuid NOT NULL,
  category_id uuid NOT NULL,
  weight numeric NOT NULL,
  CONSTRAINT user_category_preferences_pkey PRIMARY KEY (user_category_preferences_id),
  CONSTRAINT user_category_preferences_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT user_category_preferences_category_fk
    FOREIGN KEY (category_id) REFERENCES issue_categories (id) ON DELETE CASCADE
);

CREATE TABLE user_entity_preferences (
  user_entity_preferences_id uuid NOT NULL,
  user_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  weight numeric NOT NULL,
  CONSTRAINT user_entity_preferences_pkey PRIMARY KEY (user_entity_preferences_id),
  CONSTRAINT user_entity_preferences_entity_fk
    FOREIGN KEY (entity_id) REFERENCES entities (id) ON DELETE CASCADE,
  CONSTRAINT user_entity_preferences_user_fk
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

COMMIT;
