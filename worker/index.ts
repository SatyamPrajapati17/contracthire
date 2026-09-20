import "dotenv/config";

const POLL_MS = Number(process.env.WORKER_POLL_MS || 1000);

type Stage = string;

async function dispatch(stage: Stage, payload: Record<string, unknown>) {
  const stages = await import("../src/lib/pipeline/stages");
  switch (stage) {
    case "intake":
      return stages.runIntake(payload.documentVersionId as string);
    case "parse":
      return stages.runParse(payload.documentVersionId as string);
    case "segment":
      return stages.runSegment(payload.documentVersionId as string);
    case "embed":
      return stages.runEmbed(payload.documentVersionId as string);
    case "extract":
      return stages.runExtract(payload.documentVersionId as string);
    case "obligations":
      return stages.runObligations(payload.documentVersionId as string);
    case "risk":
      return stages.runRisk(payload.documentVersionId as string);
    case "summarize":
      return stages.runSummarize(payload.documentVersionId as string);
    case "diff":
      return stages.runDiff(payload as never);
    case "recompute":
      return stages.recomputeDependents(payload.fieldId as string);
    case "alerts":
      return (await import("../src/lib/alerts")).runAlertSweep();
    default:
      throw new Error(`unknown stage: ${stage}`);
  }
}

let running = true;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // alerts + sheets keep-synced cadence
let lastSweep = 0;

async function runPeriodicSweep() {
  const alerts = await import("../src/lib/alerts");
  await alerts.runAlertSweep();
  // Sheets keep-synced (phase 11): every 15 min when the master switch is on.
  if ((process.env.SHEETS_SYNC || "off") === "on") {
    const sheets = await import("../src/lib/sheets-portfolio");
    const { pool } = await import("../src/lib/db/client");
    const ws = await pool.query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id FROM connected_accounts WHERE provider = 'google' AND status = 'connected'`
    );
    for (const row of ws.rows) {
      const res = await sheets.syncAll(row.workspace_id);
      if (!res.ok) console.warn(`[worker] sheets sync ${row.workspace_id}: ${res.error}`);
    }
  }
}

async function loop() {
  const { claimJob, completeJob, failJob } = await import("../src/lib/jobs");
  console.log(`[worker] polling every ${POLL_MS}ms — Ctrl+C to stop`);
  while (running) {
    try {
      const job = await claimJob();
      if (!job) {
        if (Date.now() - lastSweep >= SWEEP_INTERVAL_MS) {
          lastSweep = Date.now();
          try {
            await runPeriodicSweep();
            console.log("[worker] periodic sweep (alerts + sheets) done");
          } catch (err) {
            console.error("[worker] periodic sweep failed:", err instanceof Error ? err.message : err);
          }
        }
        await sleep(POLL_MS);
        continue;
      }
      console.log(`[worker] ${job.stage} ${job.id} attempt ${job.attempts}`);
      try {
        await dispatch(job.stage, job.payload);
        await completeJob(job.id);
        console.log(`[worker] ${job.stage} ${job.id} done`);
      } catch (err) {
        console.error(`[worker] ${job.stage} ${job.id} failed:`, err instanceof Error ? err.message : err);
        await failJob(job.id, err);
      }
    } catch (err) {
      console.error("[worker] loop error:", err instanceof Error ? err.message : err);
      await sleep(POLL_MS);
    }
  }
  const { pool } = await import("../src/lib/db/client");
  await pool.end();
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

process.on("SIGINT", () => {
  console.log("\n[worker] shutting down after current job");
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
