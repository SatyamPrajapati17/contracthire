/* Serverless cron tick (Vercel Cron → /api/cron/tick): does everything the
   localhost worker's idle loop does — claims up to N queued pipeline jobs and
   runs the periodic alert + Sheets sweep on the same cron schedule. Protect
   with CRON_SECRET (Vercel sends `Authorization: Bearer $CRON_SECRET`). */
import { claimJob, completeJob, failJob } from "@/lib/jobs";

export const maxDuration = 60;

type Stage = string;

async function dispatch(stage: Stage, payload: Record<string, unknown>) {
  const stages = await import("@/lib/pipeline/stages");
  switch (stage) {
    case "intake": return stages.runIntake(payload.documentVersionId as string);
    case "parse": return stages.runParse(payload.documentVersionId as string);
    case "segment": return stages.runSegment(payload.documentVersionId as string);
    case "embed": return stages.runEmbed(payload.documentVersionId as string);
    case "extract": return stages.runExtract(payload.documentVersionId as string);
    case "obligations": return stages.runObligations(payload.documentVersionId as string);
    case "risk": return stages.runRisk(payload.documentVersionId as string);
    case "summarize": return stages.runSummarize(payload.documentVersionId as string);
    case "diff": return stages.runDiff(payload as never);
    case "recompute": return stages.recomputeDependents(payload.fieldId as string);
    case "alerts": return (await import("@/lib/alerts")).runAlertSweep();
    default: throw new Error(`unknown stage: ${stage}`);
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  const maxJobs = Math.min(Number(new URL(req.url).searchParams.get("max") ?? 3), 10);
  const processed: Array<{ id: string; stage: string; ok: boolean; error?: string }> = [];

  for (let i = 0; i < maxJobs; i++) {
    let job: Awaited<ReturnType<typeof claimJob>> = null;
    try {
      job = await claimJob();
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : "claim failed" }, { status: 500 });
    }
    if (!job) break;
    try {
      await dispatch(job.stage, job.payload);
      await completeJob(job.id);
      processed.push({ id: job.id, stage: job.stage, ok: true });
    } catch (err) {
      await failJob(job.id, err instanceof Error ? err : new Error(String(err)));
      processed.push({ id: job.id, stage: job.stage, ok: false, error: err instanceof Error ? err.message.slice(0, 160) : "failed" });
    }
  }

  // Periodic sweep piggybacks on the same tick (cheap when nothing is due).
  let sweep: { ok: boolean; error?: string } = { ok: true };
  try {
    const alerts = await import("@/lib/alerts");
    await alerts.runAlertSweep();
  } catch (e) {
    sweep = { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "sweep failed" };
  }

  return Response.json({ ok: true, processed, sweep });
}
