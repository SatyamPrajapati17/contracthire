import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { parsedPages, textLayout } from "@/lib/db/text-schema";
import { and, eq, asc } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: dvId } = await params;
  const dv = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, dvId), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!dv) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const page = parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10);
  const rows = await db.select().from(parsedPages)
    .where(and(eq(parsedPages.documentVersionId, dvId), eq(parsedPages.pageNumber, page)))
    .limit(1);
  const pg = rows[0];
  if (!pg) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const boxes = await db.select({
    charStart: textLayout.charStart, charEnd: textLayout.charEnd,
    x: textLayout.x, y: textLayout.y, w: textLayout.w, h: textLayout.h
  }).from(textLayout)
    .where(and(eq(textLayout.documentVersionId, dvId), eq(textLayout.pageNumber, page)))
    .orderBy(asc(textLayout.charStart));

  return Response.json({
    document_version_id: dvId,
    page,
    page_count: dv.pageCount,
    text: pg.text,
    char_start: pg.charStart,
    char_end: pg.charEnd,
    ocr_derived: pg.ocrDerived,
    boxes
  });
}
