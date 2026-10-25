-- Teacher applications: professionals who want to join Lux (create courses, review
-- work, teach live). Kept apart from institution demo leads; HQ shows them in their
-- own CRM tray. `answers` holds the structured onboarding questionnaire so the form
-- can evolve (and an onboarding agent can read it) without schema changes.

CREATE TABLE IF NOT EXISTS teacher_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  name         text NOT NULL,
  email        text NOT NULL,
  phone        text,
  country      text NOT NULL,
  city         text,
  profile_url  text,
  answers      jsonb NOT NULL,
  form_version int NOT NULL DEFAULT 1,
  source       text NOT NULL DEFAULT 'landing',
  status       text NOT NULL DEFAULT 'NEW'
               CHECK (status IN ('NEW', 'REVIEWING', 'INTERVIEW', 'ONBOARDING', 'ACTIVE', 'REJECTED')),
  owner_email  text,
  ip_hash      text,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS teacher_apps_status_created_idx ON teacher_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS teacher_apps_ip_created_idx ON teacher_applications (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS teacher_apps_email_created_idx ON teacher_applications (lower(email), created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_application_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES teacher_applications(id) ON DELETE CASCADE,
  author_email   text NOT NULL,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_app_notes_app_idx ON teacher_application_notes (application_id, created_at);

CREATE TABLE IF NOT EXISTS teacher_application_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES teacher_applications(id) ON DELETE CASCADE,
  from_status    text,
  to_status      text NOT NULL,
  changed_by     text NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_app_history_app_idx ON teacher_application_status_history (application_id, changed_at);
