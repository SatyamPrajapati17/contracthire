import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { and, eq, asc } from "drizzle-orm";
import { processingStages } from "@/lib/db/risk-schema";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: dvId } = await params;
  const dv = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, dvId), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!dv) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const stages = await db.select().from(processingStages)
    .where(eq(processingStages.documentVersionId, dvId))
    .orderBy(asc(processingStages.id));

  return Response.json({
    document_version_id: dvId,
    status: dv.status,
    page_count: dv.pageCount,
    has_ocr_pages: dv.hasOcrPages,
    failure_reason: dv.failureReason,
    stages: stages.map((s) => ({
      stage: s.stage,
      status: s.status,
      attempt: s.attempt,
      started_at: s.startedAt,
      finished_at: s.finishedAt,
      error_message_safe: s.errorMessageSafe
    }))
  });
}
