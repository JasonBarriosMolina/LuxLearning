-- Lux HQ platform database (separate from the tenant database).
-- Holds data owned by Lux Learning itself: sales leads and the staff audit trail.
-- Apply with: node scripts/platform-db-migrate.mjs <env>

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  name         text NOT NULL,
  email        text NOT NULL,
  phone        text,
  organization text NOT NULL,
  org_type     text NOT NULL,
  size_range   text NOT NULL,
  message      text,
  source       text NOT NULL DEFAULT 'landing',
  status       text NOT NULL DEFAULT 'NEW'
               CHECK (status IN ('NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'WON', 'LOST')),
  owner_email  text,
  ip_hash      text,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS leads_status_created_idx ON leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_ip_created_idx ON leads (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email_created_idx ON leads (lower(email), created_at DESC);

CREATE TABLE IF NOT EXISTS lead_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_email text NOT NULL,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON lead_notes (lead_id, created_at);

CREATE TABLE IF NOT EXISTS lead_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  changed_by  text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_status_history_lead_idx ON lead_status_history (lead_id, changed_at);

CREATE TABLE IF NOT EXISTS staff_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_audit_log_created_idx ON staff_audit_log (created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;
