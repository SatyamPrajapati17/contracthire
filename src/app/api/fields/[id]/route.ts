import { NextRequest } from "next/server";
import { getCtx, canEdit } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { extractedFields } from "@/lib/db/extraction-schema";
import { fieldCorrections } from "@/lib/db/extraction-schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs";
import { z } from "zod";

const Body = z.object({
  value: z.string().min(0),
  value_normalized: z.unknown().optional(),
  reason: z.string().optional()
});

/** Field correction (US-03): old/new + actor recorded; dependents recompute. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: fieldId } = await params;
  const field = (await db.select().from(extractedFields)
    .where(and(eq(extractedFields.id, fieldId), eq(extractedFields.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!field) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const previousNormalized = field.valueNormalized;
  await db.insert(fieldCorrections).values({
    id: id("fc"),
    workspaceId: ctx.workspaceId,
    extractedFieldId: fieldId,
    previousValue: field.valueText,
    previousNormalized,
    newValue: parse.data.value,
    newNormalized: parse.data.value_normalized !== undefined ? JSON.stringify(parse.data.value_normalized) : null,
    reason: parse.data.reason ?? null,
    correctedBy: ctx.userId
  });

  await db.update(extractedFields).set({
    valueText: parse.data.value,
    valueNormalized: parse.data.value_normalized !== undefined ? JSON.stringify(parse.data.value_normalized) : field.valueNormalized,
    validationStatus: "corrected"
  }).where(eq(extractedFields.id, fieldId));

  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "field.correct", resourceType: "extracted_field", resourceId: fieldId,
    metadata: { old: field.valueText, new: parse.data.value, reason: parse.data.reason ?? null }
  });

  // Recompute dependent obligations + alert schedules (doc 04 §7).
  await enqueueJob("recompute", { fieldId, workspaceId: ctx.workspaceId });

  return Response.json({
    field: { id: fieldId, value: parse.data.value, validation_status: "corrected" },
    recomputed: { queued: true }
  });
}
