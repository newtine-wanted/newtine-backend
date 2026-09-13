CREATE TABLE IF NOT EXISTS feed_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NULL,
  guest_token_hash text NULL,
  algorithm_version text NOT NULL,
  next_batch_no integer NOT NULL DEFAULT 0 CHECK (next_batch_no >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_topic text NULL,
  last_representative_entity_id uuid NULL,
  topic_run integer NOT NULL DEFAULT 0 CHECK (topic_run >= 0),
  entity_run integer NOT NULL DEFAULT 0 CHECK (entity_run >= 0),
  CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS feed_sessions_expires_at_idx ON feed_sessions (expires_at);
CREATE INDEX IF NOT EXISTS feed_sessions_user_active_idx
  ON feed_sessions (user_id, status, expires_at)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS feed_batches (
  feed_session_id uuid NOT NULL REFERENCES feed_sessions (id) ON DELETE CASCADE,
  batch_no integer NOT NULL CHECK (batch_no >= 0),
  continuation text NOT NULL CHECK (continuation IN ('CONTINUE', 'EXHAUSTED', 'CONSTRAINT_LIMITED', 'SEARCH_LIMITED')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (feed_session_id, batch_no)
);

CREATE TABLE IF NOT EXISTS feed_batch_items (
  feed_session_id uuid NOT NULL,
  batch_no integer NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 10),
  issue_id uuid NOT NULL,
  selection_type text NOT NULL CHECK (selection_type IN ('PERSONALIZED', 'MAJOR', 'CONNECTED', 'EXPLORATION', 'OPPOSITE')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (feed_session_id, batch_no, position),
  UNIQUE (feed_session_id, issue_id),
  FOREIGN KEY (feed_session_id, batch_no) REFERENCES feed_batches (feed_session_id, batch_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS feed_batch_items_issue_idx ON feed_batch_items (issue_id);
