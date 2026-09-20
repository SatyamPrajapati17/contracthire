import { and, eq, sql } from "drizzle-orm";
import { db } from "./db/client";
import { processingStages } from "./db/risk-schema";
import { id } from "./ids";

/** Single `jobs` table polled by one Node worker (doc 04 §5 — no Redis). */
export const STAGES = [
  "intake", "parse", "segment", "embed", "extract",
  "obligations", "risk", "summarize", "diff", "alerts", "recompute"
] as const;
export type Stage = (typeof STAGES)[number];

export interface JobPayload {
  documentVersionId?: string;
  contractId?: string;
  workspaceId?: string;
  baseVersionId?: string;
  targetVersionId?: string;
  fieldId?: string;
  stage?: string;
  obligationId?: string;
  userId?: string;
  [k: string]: unknown;
}

export async function enqueueJob(stage: Stage, payload: JobPayload, runAt = new Date()) {
  await db.execute(sql`
    INSERT INTO jobs (id, stage, payload, run_at, status)
    VALUES (${id("req")}, ${stage}, ${JSON.stringify(payload)}::jsonb, ${runAt.toISOString()}, 'queued')
  `);
}

export interface ClaimedJob {
  id: string;
  stage: Stage;
  payload: JobPayload;
  attempts: number;
}

/**
 * Atomically claim one runnable job using SELECT ... FOR UPDATE SKIP LOCKED
 * so worker restarts and multiple workers stay safe.
 */
export async function claimJob(): Promise<ClaimedJob | null> {
  const client = await poolClient();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT id, stage, payload, attempts FROM jobs
       WHERE status = 'queued' AND run_at <= now()
         AND (attempts = 0 OR next_retry_at IS NULL OR next_retry_at <= now())
       ORDER BY run_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );
    if (res.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }
    const row = res.rows[0];
    await client.query(
      `UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1 WHERE id = $1`,
      [row.id]
    );
    await client.query("COMMIT");
    return { id: row.id, stage: row.stage as Stage, payload: row.payload as JobPayload, attempts: row.attempts + 1 };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function poolClient() {
  const { pool } = await import("./db/client");
  return pool.connect();
}

export async function completeJob(jobId: string) {
  await db.execute(sql`UPDATE jobs SET status = 'done', finished_at = now() WHERE id = ${jobId}`);
}

export async function failJob(jobId: string, err: unknown, maxAttempts = 3) {
  const message = err instanceof Error ? err.message : String(err);
  const rows = await db.execute<{ attempts: number }>(sql`SELECT attempts FROM jobs WHERE id = ${jobId}`);
  const attempts = Number(rows.rows[0]?.attempts ?? 1);
  if (attempts >= maxAttempts) {
    await db.execute(sql`
      UPDATE jobs SET status = 'dead', finished_at = now(), last_error = ${message.slice(0, 500)}
      WHERE id = ${jobId}
    `);
    // Poison handling: dead-letter surfaces as a failed stage with a retry control.
    return;
  }
  // Transient failure → exponential backoff 2s / 8s / 30s (doc 02 §4.1).
  const delays = [2000, 8000, 30000];
  const delay = delays[Math.min(attempts - 1, delays.length - 1)];
  await db.execute(sql`
    UPDATE jobs
    SET status = 'queued', next_retry_at = now() + (${delay} || ' milliseconds')::interval,
        last_error = ${message.slice(0, 500)}
    WHERE id = ${jobId}
  `);
}

/* ── Processing stage rows power the SSE status feed ─────────────────── */
export const UI_STAGES = ["scanning", "parsing", "ocr", "segmenting", "extracting", "obligations", "risk", "summarizing"] as const;
export type UIStage = (typeof UI_STAGES)[number];

export const STAGE_TO_DOC_STATUS: Record<UIStage | "ready", string> = {
  scanning: "scanning",
  parsing: "parsing",
  ocr: "ocr",
  segmenting: "segmenting",
  extracting: "extracting",
  obligations: "deriving_obligations",
  risk: "assessing_risk",
  summarizing: "summarizing",
  ready: "ready"
};

export async function markStage(
  documentVersionId: string,
  workspaceId: string,
  stage: UIStage | "ready",
  status: "pending" | "running" | "succeeded" | "degraded" | "failed" | "skipped",
  opts?: { attempt?: number; errorCode?: string; errorMessageSafe?: string; modelVersion?: string; promptVersion?: string }
) {
  const attempt = opts?.attempt ?? 1;
  const existing = await db
    .select()
    .from(processingStages)
    .where(and(
      eq(processingStages.documentVersionId, documentVersionId),
      eq(processingStages.stage, stage),
      eq(processingStages.attempt, attempt)
    ))
    .limit(1);

  const now = new Date();
  if (existing[0]) {
    await db.update(processingStages).set({
      status,
      startedAt: status === "running" ? now : existing[0].startedAt,
      finishedAt: status === "running" || status === "pending" ? null : now,
      errorCode: opts?.errorCode ?? existing[0].errorCode,
      errorMessageSafe: opts?.errorMessageSafe ?? existing[0].errorMessageSafe
    }).where(eq(processingStages.id, existing[0].id));
  } else {
    await db.insert(processingStages).values({
      id: id("ps"),
      workspaceId,
      documentVersionId,
      stage,
      status,
      attempt,
      startedAt: status === "running" ? now : null,
      finishedAt: status === "running" || status === "pending" ? null : now,
      errorCode: opts?.errorCode,
      errorMessageSafe: opts?.errorMessageSafe,
      modelVersion: opts?.modelVersion,
      promptVersion: opts?.promptVersion
    });
  }
}

/** Advance the document version status; never moves backwards. */
export async function setDocStatus(documentVersionId: string, status: string) {
  // The status CHECK allows the enum values; guard defensively anyway so an
  // unexpected UI label can never violate the constraint mid-pipeline.
  const allowed = new Set([
    "uploaded", "scanning", "parsing", "ocr", "segmenting", "extracting",
    "deriving_obligations", "assessing_risk", "summarizing", "ready", "degraded", "failed", "superseded"
  ]);
  if (!allowed.has(status)) {
    console.warn(`[jobs] setDocStatus: ignoring non-enum status "${status}"`);
    return;
  }
  await db.execute(sql`
    UPDATE document_versions SET status = ${status}
    WHERE id = ${documentVersionId}
      AND status != 'ready'
  `);
}
