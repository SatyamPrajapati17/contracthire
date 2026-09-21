-- Migration 0008: app-level key/value settings.
-- Used to store the Gmail REST sender's OAuth refresh token captured by the
-- one-time consent flow (/api/auth/google/start → callback), so no manual
-- env editing or redeploy is needed on PaaS hosts.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
