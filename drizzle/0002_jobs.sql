CREATE TABLE IF NOT EXISTS jobs (
  id            text PRIMARY KEY,
  stage         text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  run_at        timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_poll ON jobs(status, run_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage, status);
