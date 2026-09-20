import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { citations } from "@/lib/db/extraction-schema";
import { textLayout } from "@/lib/db/text-schema";
import { and, eq, gt, lt, asc } from "drizzle-orm";

/** Citation resolve: ACL re-checked against the workspace, never trusts the ID
 *  (doc 02 §10.1 — citation-based exfiltration control). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: citId } = await params;

  const cit = (await db.select().from(citations)
    .where(and(eq(citations.id, citId), eq(citations.workspaceId, ctx.workspaceId)))
    .limit(1))[0];
  if (!cit) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  // Find layout boxes overlapping the span on the citation's page.
  const rects = await db.select({
    x: textLayout.x, y: textLayout.y, w: textLayout.w, h: textLayout.h,
    charStart: textLayout.charStart, charEnd: textLayout.charEnd
  }).from(textLayout)
    .where(and(
      eq(textLayout.documentVersionId, cit.documentVersionId),
      eq(textLayout.pageNumber, cit.page),
      lt(textLayout.charStart, cit.charEnd),
      gt(textLayout.charEnd, cit.charStart)
    ))
    .orderBy(asc(textLayout.charStart));

  const nPages = await db.execute<{ n: number }>(
    (await import("drizzle-orm")).sql`
      SELECT count(*)::int AS n FROM parsed_pages WHERE document_version_id = ${cit.documentVersionId}
    `
  );

  return Response.json({
    document_version_id: cit.documentVersionId,
    page: cit.page,
    page_count: nPages.rows[0]?.n ?? 0,
    section_ref: cit.sectionRef,
    section_title: cit.sectionTitle,
    quoted_text: cit.quotedText,
    resolvable: cit.resolvable && rects.length > 0,
    ocr_derived: cit.ocrDerived,
    match_confidence: cit.matchConfidence,
    rects
  });
}
