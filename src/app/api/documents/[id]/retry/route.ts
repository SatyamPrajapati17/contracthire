import { NextRequest } from "next/server";
import { getCtx, canUpload } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { and, eq, sql } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { enqueueJob, markStage } from "@/lib/jobs";
import { z } from "zod";

const STAGE_TO_JOB: Record<string, "intake" | "parse" | "segment" | "extract" | "obligations" | "risk" | "summarize"> = {
  scanning: "intake", parsing: "parse", ocr: "parse", segmenting: "segment",
  extracting: "extract", obligations: "obligations", risk: "risk", summarizing: "summarize"
};

const Body = z.object({ stage: z.string() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canUpload(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });
  const { id: dvId } = await params;
  const dv = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, dvId), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!dv) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const jobStage = STAGE_TO_JOB[parse.data.stage];
  if (!jobStage) return Response.json({ error: { code: "validation_failed", message: "Unknown stage." } }, { status: 422 });

  // Bump the attempt so stage rows stay unique per (dv, stage, attempt).
  const attemptRows = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(attempt), 0) + 1 AS n FROM processing_stages WHERE document_version_id = ${dvId} AND stage = ${parse.data.stage}
  `);
  const attempt = attemptRows.rows[0]?.n ?? 2;

  await markStage(dvId, ctx.workspaceId, parse.data.stage as "scanning", "pending", { attempt });
  await db.update(documentVersions).set({ status: "failed" }).where(eq(documentVersions.id, dvId));
  await audit({ workspaceId: ctx.workspaceId, ctx, action: "document.retry", resourceType: "document_version", resourceId: dvId, metadata: { stage: parse.data.stage, attempt } });
  await enqueueJob(jobStage, { documentVersionId: dvId, workspaceId: ctx.workspaceId, contractId: dv.contractId });
  return Response.json({ retrying: true, stage: parse.data.stage, attempt });
}
