import { NextRequest } from "next/server";
import { getCtx, canEdit } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { comparisons, comparisonChanges } from "@/lib/db/risk-schema";
import { and, eq, desc } from "drizzle-orm";
import { audit } from "@/lib/audit";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: cmpId } = await params;
  const cmp = (await db.select().from(comparisons)
    .where(and(eq(comparisons.id, cmpId), eq(comparisons.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!cmp) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const changes = await db.select().from(comparisonChanges)
    .where(eq(comparisonChanges.comparisonId, cmpId))
    .orderBy(desc(comparisonChanges.isMaterial), comparisonChanges.impactCategory);

  return Response.json({
    id: cmp.id,
    contract_id: cmp.contractId,
    base_version_id: cmp.baseVersionId,
    target_version_id: cmp.targetVersionId,
    status: cmp.status,
    material_count: cmp.materialCount,

    cosmetic_count: cmp.cosmeticCount,
    changes
  });
}

/** Delete an old comparison (permission matrix, phase 8): contributor and above. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: cmpId } = await params;
  const cmp = (await db.select().from(comparisons)
    .where(and(eq(comparisons.id, cmpId), eq(comparisons.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!cmp) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });

  await db.delete(comparisonChanges).where(eq(comparisonChanges.comparisonId, cmpId));
  await db.delete(comparisons).where(eq(comparisons.id, cmpId));
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "comparison.delete", resourceType: "comparison", resourceId: cmpId,
    metadata: { contract_id: cmp.contractId, base: cmp.baseVersionId, target: cmp.targetVersionId }
  });
  return new Response(null, { status: 204 });
}
