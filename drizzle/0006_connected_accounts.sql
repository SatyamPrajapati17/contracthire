-- Migration 0006: workspace-level connected accounts (phase 9).
-- OAuth tokens are stored encrypted (AES-256-GCM); refresh tokens never in
-- plaintext. One row per provider per workspace, with an owner.
CREATE TABLE connected_accounts (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('google')),
  owner_user_id     text NOT NULL REFERENCES users(id),
  scopes            text[] NOT NULL DEFAULT '{}',
  access_token_enc  text,
  refresh_token_enc text,
  expires_at        timestamptz,
  account_email     text,
  status            text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','revoked','error')),
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);
CREATE INDEX idx_connected_accounts_ws ON connected_accounts(workspace_id, provider);
