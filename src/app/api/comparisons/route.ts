import { NextRequest } from "next/server";
import { getCtx, canUpload } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { comparisons } from "@/lib/db/risk-schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs";
import { z } from "zod";

const Body = z.object({
  base_version_id: z.string(),
  target_version_id: z.string()
});

export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canUpload(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const base = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, parse.data.base_version_id), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  const target = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, parse.data.target_version_id), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!base || !target || base.contractId !== target.contractId) {
    return Response.json({ error: { code: "validation_failed", message: "Both versions must belong to the same contract in your workspace." } }, { status: 422 });
  }

  const existing = (await db.select().from(comparisons)
    .where(and(eq(comparisons.baseVersionId, base.id), eq(comparisons.targetVersionId, target.id))).limit(1))[0];
  if (existing && existing.status !== "failed") {
    return Response.json({ comparison_id: existing.id, status: existing.status, existing: true });
  }

  const cmpId = existing?.id ?? id("cmp");
  if (!existing) {
    await db.insert(comparisons).values({
      id: cmpId,
      workspaceId: ctx.workspaceId,
      contractId: base.contractId,
      baseVersionId: base.id,
      targetVersionId: target.id,
      createdBy: ctx.userId
    });
  } else {
    await db.update(comparisons).set({ status: "computing" }).where(eq(comparisons.id, cmpId));
  }
  await audit({ workspaceId: ctx.workspaceId, ctx, action: "comparison.create", resourceType: "comparison", resourceId: cmpId, metadata: { base: base.id, target: target.id } });
  await enqueueJob("diff", {
    baseVersionId: base.id, targetVersionId: target.id,
    workspaceId: ctx.workspaceId, contractId: base.contractId, userId: ctx.userId
  });
  return Response.json({ comparison_id: cmpId, status: "computing" }, { status: 202 });
}
