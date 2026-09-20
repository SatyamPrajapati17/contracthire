import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { and, eq, asc } from "drizzle-orm";
import { processingStages } from "@/lib/db/risk-schema";

export const dynamic = "force-dynamic";

/** Server-sent events for processing status; client falls back to 3s polling
 *  of /documents/:id/status when this stream drops. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: dvId } = await params;
  const dv = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, dvId), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!dv) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let lastJson = "";
      const tick = async () => {
        if (closed) return;
        const stages = await db.select().from(processingStages)
          .where(eq(processingStages.documentVersionId, dvId))
          .orderBy(asc(processingStages.id));
        const dvNow = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
        const payload = {
          status: dvNow?.status,
          has_ocr_pages: dvNow?.hasOcrPages ?? false,
          page_count: dvNow?.pageCount,
          failure_reason: dvNow?.failureReason,
          stages: stages.map((s) => ({ stage: s.stage, status: s.status, attempt: s.attempt, error_message_safe: s.errorMessageSafe }))
        };
        const json = JSON.stringify(payload);
        if (json !== lastJson) {
          lastJson = json;
          send("status", payload);
        }
        if (dvNow && (dvNow.status === "ready" || dvNow.status === "failed" || dvNow.status === "degraded")) {
          send("done", { status: dvNow.status });
          closed = true;
          controller.close();
          return true;
        }
        return false;
      };

      if (await tick()) return;
      const interval = setInterval(async () => {
        try {
          const stop = await tick();
          if (stop) clearInterval(interval);
        } catch {
          clearInterval(interval);
          if (!closed) { closed = true; controller.close(); }
        }
      }, 1000);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      });
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
