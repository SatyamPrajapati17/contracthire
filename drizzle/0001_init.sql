-- ContractLens initial schema (doc 06). Forward-only.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Tenancy and identity ────────────────────────────────────────────────
CREATE TABLE workspaces (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  timezone              text NOT NULL DEFAULT 'UTC',
  region                text NOT NULL DEFAULT 'eu-central-1',
  allow_model_training  boolean NOT NULL DEFAULT false,
  retention_days        integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  display_name  text,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN CREATE TYPE role_t AS ENUM
  ('workspace_admin','legal_reviewer','contract_owner','contributor','viewer','external_signer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE memberships (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('workspace_admin','legal_reviewer','contract_owner','contributor','viewer','external_signer')),
  manager_id    text REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX idx_memberships_ws ON memberships(workspace_id, role);

CREATE TABLE magic_tokens (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_magic_tokens_hash ON magic_tokens(token_hash);

CREATE TABLE sessions (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ── Contracts and documents ─────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE contract_status_t AS ENUM
  ('draft','in_review','negotiating','approved','executed','active',
   'renewing','expiring','expired','terminated','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE doc_status_t AS ENUM
  ('uploaded','scanning','parsing','ocr','segmenting','extracting',
   'deriving_obligations','assessing_risk','summarizing','ready','degraded','failed','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE contracts (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title              text NOT NULL,
  contract_type      text,
  counterparty_name  text,
  owner_user_id      text REFERENCES users(id),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','negotiating','approved','executed','active','renewing','expiring','expired','terminated','archived')),
  parent_contract_id text REFERENCES contracts(id),
  relationship       text,
  current_version_id text,
  currency           char(3),
  total_value_minor  bigint,
  effective_date     date,
  expiration_date    date,
  renewal_notice_by  date,
  tags               text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX idx_contracts_ws_status      ON contracts(workspace_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_ws_expiry      ON contracts(workspace_id, expiration_date);
CREATE INDEX idx_contracts_ws_notice      ON contracts(workspace_id, renewal_notice_by);
CREATE INDEX idx_contracts_ws_counterparty ON contracts(workspace_id, lower(counterparty_name));

CREATE TABLE document_versions (
  id               text PRIMARY KEY,
  workspace_id     text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contract_id      text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version_label    text NOT NULL,
  version_number   integer NOT NULL,
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  byte_size        bigint NOT NULL,
  sha256           char(64) NOT NULL,
  page_count       integer,
  language         text,
  storage_key      text NOT NULL,
  normalized_key   text,
  has_ocr_pages    boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','scanning','parsing','ocr','segmenting','extracting','deriving_obligations','assessing_risk','summarizing','ready','degraded','failed','superseded')),
  failure_reason   text,
  uploaded_by      text NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version_number)
);
CREATE INDEX idx_dv_ws_sha   ON document_versions(workspace_id, sha256);
CREATE INDEX idx_dv_contract ON document_versions(contract_id, version_number DESC);

ALTER TABLE contracts
  ADD CONSTRAINT fk_current_version FOREIGN KEY (current_version_id) REFERENCES document_versions(id);

CREATE TABLE contract_parties (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL,
  contract_id       text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  legal_name        text NOT NULL,
  role              text,
  is_our_entity     boolean NOT NULL DEFAULT false,
  signatory_name    text,
  signatory_title   text,
  citation_id       text
);

-- ── Parsing and text anchoring ──────────────────────────────────────────
CREATE TABLE parsed_pages (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL,
  document_version_id  text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  page_number          integer NOT NULL,
  char_start           integer NOT NULL,
  char_end             integer NOT NULL,
  text                 text NOT NULL,
  ocr_derived          boolean NOT NULL DEFAULT false,
  ocr_confidence       real,
  render_key           text,
  UNIQUE (document_version_id, page_number)
);

CREATE TABLE text_layout (
  id                   bigserial PRIMARY KEY,
  document_version_id  text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  page_number          integer NOT NULL,
  char_start           integer NOT NULL,
  char_end             integer NOT NULL,
  x                    real NOT NULL, y real NOT NULL, w real NOT NULL, h real NOT NULL
);
CREATE INDEX idx_layout_lookup ON text_layout(document_version_id, page_number, char_start);

CREATE TABLE clauses (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL,
  document_version_id  text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  section_ref          text,
  section_title        text,
  depth                integer NOT NULL DEFAULT 1,
  parent_clause_id     text REFERENCES clauses(id),
  page_start           integer NOT NULL,
  page_end             integer NOT NULL,
  char_start           integer NOT NULL,
  char_end             integer NOT NULL,
  clause_type          text,
  text                 text NOT NULL
);
CREATE INDEX idx_clauses_dv   ON clauses(document_version_id, char_start);
CREATE INDEX idx_clauses_type ON clauses(workspace_id, clause_type);

CREATE TABLE chunks (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL,
  contract_id          text NOT NULL,
  document_version_id  text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  clause_id            text REFERENCES clauses(id),
  seq                  integer NOT NULL,
  page_start           integer NOT NULL,
  page_end             integer NOT NULL,
  char_start           integer NOT NULL,
  char_end             integer NOT NULL,
  section_ref          text,
  ocr_derived          boolean NOT NULL DEFAULT false,
  token_count          integer,
  text                 text NOT NULL,
  embedding            vector(1536),
  tsv                  tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX idx_chunks_vec  ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_fts  ON chunks USING gin (tsv);
CREATE INDEX idx_chunks_scope ON chunks(workspace_id, document_version_id);

-- ── Citations ───────────────────────────────────────────────────────────
CREATE TABLE citations (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL,
  document_version_id  text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  clause_id            text REFERENCES clauses(id),
  page                 integer NOT NULL,
  section_ref          text,
  section_title        text,
  char_start           integer NOT NULL,
  char_end             integer NOT NULL,
  quoted_text          text NOT NULL,
  match_confidence     real NOT NULL,
  resolvable           boolean NOT NULL DEFAULT true,
  ocr_derived          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_span CHECK (char_end > char_start)
);
CREATE INDEX idx_citations_dv ON citations(document_version_id, page);

-- ── Extraction and corrections ──────────────────────────────────────────
DO $$ BEGIN CREATE TYPE extraction_kind_t AS ENUM ('factual','interpretation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE validation_status_t AS ENUM
  ('unreviewed','confirmed','corrected','rejected','not_found','conflicting',
   'needs_confirmation','superseded_extraction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE extracted_fields (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL,
  contract_id          text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  document_version_id  text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  field_key            text NOT NULL,
  field_group          text NOT NULL,
  label                text NOT NULL,
  value_text           text,
  value_normalized     jsonb,
  extraction_kind      text NOT NULL CHECK (extraction_kind IN ('factual','interpretation')),
  confidence           real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  validation_status    text NOT NULL DEFAULT 'unreviewed' CHECK (validation_status IN ('unreviewed','confirmed','corrected','rejected','not_found','conflicting','needs_confirmation','superseded_extraction')),
  primary_citation_id  text REFERENCES citations(id),
  alt_citation_ids     text[] NOT NULL DEFAULT '{}',
  searched_sections    text[],
  model_version        text NOT NULL,
  prompt_version       text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, field_key, prompt_version)
);
CREATE INDEX idx_ef_contract ON extracted_fields(contract_id, field_group);
CREATE INDEX idx_ef_review   ON extracted_fields(workspace_id, validation_status)
  WHERE validation_status IN ('needs_confirmation','conflicting','unreviewed');

CREATE TABLE field_corrections (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL,
  extracted_field_id text NOT NULL REFERENCES extracted_fields(id) ON DELETE CASCADE,
  previous_value     text,
  previous_normalized jsonb,
  new_value          text,
  new_normalized     jsonb,
  reason             text,
  corrected_by       text NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corrections_field ON field_corrections(extracted_field_id, created_at DESC);

-- ── Obligations and alerts ──────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE due_rule_t AS ENUM ('fixed','relative','event_triggered','recurring');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE obl_status_t AS ENUM
  ('suggested','active','needs_assumption','snoozed','completed','overdue','rejected','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE channel_t AS ENUM ('in_app','email','slack','teams','webhook','calendar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE obligations (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL,
  contract_id        text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  source_version_id  text NOT NULL REFERENCES document_versions(id),
  title              text NOT NULL,
  description        text,
  obligor            text NOT NULL,
  obligee            text NOT NULL,
  trigger_text       text,
  due_rule           text NOT NULL CHECK (due_rule IN ('fixed','relative','event_triggered','recurring')),
  due_rule_detail    jsonb NOT NULL,
  due_date           date,
  due_date_math      text,
  recurrence_rrule   text,
  grace_period_days  integer NOT NULL DEFAULT 0,
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  risk_note          text,
  status             text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','active','needs_assumption','snoozed','completed','overdue','rejected','void')),
  owner_user_id      text REFERENCES users(id),
  citation_id        text REFERENCES citations(id),
  confidence         real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  derived_from_field_ids text[] NOT NULL DEFAULT '{}',
  completed_at       timestamptz,
  completed_by       text REFERENCES users(id),
  evidence_keys      text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_obl_due_or_assumption CHECK (due_date IS NOT NULL OR status IN ('needs_assumption','suggested','rejected','void'))
);
CREATE INDEX idx_obl_due     ON obligations(workspace_id, due_date) WHERE status IN ('active','overdue');
CREATE INDEX idx_obl_owner   ON obligations(owner_user_id, status);
CREATE INDEX idx_obl_contract ON obligations(contract_id, status);

CREATE TABLE obligation_events (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL,
  obligation_id  text NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  actor_user_id  text REFERENCES users(id),
  payload        jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_obl_events_obl ON obligation_events(obligation_id, created_at);

CREATE TABLE alert_schedules (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL,
  obligation_id  text NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
  offset_days    integer NOT NULL,
  channel        text NOT NULL CHECK (channel IN ('in_app','email','slack','teams','webhook','calendar')),
  recipient_user_id text REFERENCES users(id),
  scheduled_for  timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'scheduled',
  cancelled_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alerts_idem_uq UNIQUE (obligation_id, offset_days, channel)
);
CREATE INDEX idx_alerts_due ON alert_schedules(scheduled_for) WHERE status = 'scheduled';

CREATE TABLE alert_deliveries (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL,
  alert_schedule_id text NOT NULL REFERENCES alert_schedules(id) ON DELETE CASCADE,
  attempt           integer NOT NULL DEFAULT 1,
  delivered_at      timestamptz,
  status            text NOT NULL,
  error             text,
  idempotency_key   text NOT NULL UNIQUE
);
CREATE INDEX idx_deliveries_schedule ON alert_deliveries(alert_schedule_id);

-- ── Risk and playbook ───────────────────────────────────────────────────
CREATE TABLE playbook_rules (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  clause_type    text NOT NULL,
  rule_name      text NOT NULL,
  expectation    text NOT NULL,
  evaluator      jsonb NOT NULL,
  outcome_if_violated text NOT NULL,
  reviewer_role  text NOT NULL,
  severity       text NOT NULL,
  active         boolean NOT NULL DEFAULT true
);

DO $$ BEGIN CREATE TYPE flag_status_t AS ENUM ('open','in_review','decided','superseded','reopened');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE risk_flags (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL,
  contract_id        text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  document_version_id text NOT NULL REFERENCES document_versions(id),
  playbook_rule_id   text REFERENCES playbook_rules(id),
  category           text NOT NULL,
  flag_type          text NOT NULL,
  title              text NOT NULL,
  explanation        text NOT NULL,
  expected_text      text,
  found_text         text,
  severity           text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  confidence         real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  recommended_step   text NOT NULL,
  suggested_reviewer_role text,
  citation_id        text REFERENCES citations(id),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','decided','superseded','reopened')),
  superseded_by      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flags_queue ON risk_flags(workspace_id, status, severity, created_at);

CREATE TABLE risk_decisions (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL,
  risk_flag_id   text NOT NULL REFERENCES risk_flags(id) ON DELETE CASCADE,
  decision       text NOT NULL CHECK (decision IN ('accepted_risk','needs_negotiation','escalated','not_a_risk')),
  note           text,
  decided_by     text NOT NULL REFERENCES users(id),
  decided_role   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_decisions_flag ON risk_decisions(risk_flag_id, created_at);

-- ── Comparison ──────────────────────────────────────────────────────────
CREATE TABLE comparisons (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL,
  contract_id       text NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  base_version_id   text NOT NULL REFERENCES document_versions(id),
  target_version_id text NOT NULL REFERENCES document_versions(id),
  status            text NOT NULL DEFAULT 'computing',
  material_count    integer NOT NULL DEFAULT 0,
  cosmetic_count    integer NOT NULL DEFAULT 0,
  created_by        text NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_version_id, target_version_id)
);

CREATE TABLE comparison_changes (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL,
  comparison_id       text NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  change_type         text NOT NULL,
  impact_category     text NOT NULL,
  is_material         boolean NOT NULL,
  clause_ref          text,
  before_text         text,
  after_text          text,
  business_impact     text NOT NULL,
  risk_delta          text,
  suggested_reviewer_role text,
  base_citation_id    text REFERENCES citations(id),
  target_citation_id  text REFERENCES citations(id),
  confidence          real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);
CREATE INDEX idx_changes_material ON comparison_changes(comparison_id, is_material DESC, impact_category);

-- ── Q&A ─────────────────────────────────────────────────────────────────
CREATE TABLE chat_sessions (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL,
  contract_id  text REFERENCES contracts(id) ON DELETE CASCADE,
  scope        jsonb NOT NULL,
  created_by   text NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL,
  session_id    text NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          text NOT NULL,
  content       text NOT NULL,
  answer_kind   text,
  confidence    real CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  citation_ids  text[] NOT NULL DEFAULT '{}',
  evidence      jsonb,
  feedback      text,
  model_version text,
  prompt_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_session ON chat_messages(session_id, created_at);

-- ── Observability and audit ─────────────────────────────────────────────
CREATE TABLE processing_stages (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL,
  document_version_id text NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  stage               text NOT NULL,
  status              text NOT NULL,
  attempt             integer NOT NULL DEFAULT 1,
  started_at          timestamptz,
  finished_at         timestamptz,
  error_code          text,
  error_message_safe  text,
  model_version       text,
  prompt_version      text,
  UNIQUE (document_version_id, stage, attempt)
);

CREATE TABLE ai_invocations (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL,
  subject_type   text NOT NULL,
  subject_id     text NOT NULL,
  agent          text NOT NULL,
  model_version  text NOT NULL,
  prompt_version text NOT NULL,
  prompt_hash    char(64) NOT NULL,
  input_tokens   integer,
  output_tokens  integer,
  latency_ms     integer,
  cost_usd       numeric(10,5),
  validation_outcome text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_cost ON ai_invocations(workspace_id, created_at);

CREATE TABLE audit_events (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL,
  actor_user_id text REFERENCES users(id),
  actor_role    text,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   text NOT NULL,
  before_hash   char(64),
  after_hash    char(64),
  metadata      jsonb NOT NULL DEFAULT '{}',
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_ws_time ON audit_events(workspace_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_events(resource_type, resource_id);

-- ── In-app notifications (alerts centre) ────────────────────────────────
CREATE TABLE notifications (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL,
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  title             text NOT NULL,
  body              text,
  link              text,
  alert_schedule_id text,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
