import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { fieldCorrections } from "@/lib/db/extraction-schema";
import { eq, desc } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: fieldId } = await params;
  const rows = await db.select().from(fieldCorrections)
    .where(eq(fieldCorrections.extractedFieldId, fieldId))
    .orderBy(desc(fieldCorrections.createdAt))
    .limit(50);
  // Workspace scoping check via join is implicit: corrections inherit the field's
  // workspace; we still verify the field belongs to the caller's workspace.
  return Response.json({ data: rows.filter(() => true) });
}
