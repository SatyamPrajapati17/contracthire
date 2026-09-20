-- Migration 0007: DB-backed object storage (Vercel serverless filesystem is
-- ephemeral; STORAGE_DRIVER=db keeps uploaded contract bytes in Postgres).
CREATE TABLE IF NOT EXISTS object_store (
  key        text PRIMARY KEY,
  data       bytea NOT NULL,
  size       integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
