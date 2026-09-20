import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { enqueueJob } from "@/lib/jobs";
import { audit } from "@/lib/audit";

const Body = z.object({
  resolution: z.enum(["link_as_version", "keep_separate"]),
  existing_document_version_id: z.string().optional()
});

/** Duplicate resolution endpoint (doc 06 §4.3): link as a new version of the
 *  existing contract, or keep as a separate contract. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: dvId } = await params;
  const dv = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, dvId), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!dv) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  if (parse.data.resolution === "link_as_version" && parse.data.existing_document_version_id) {
    const existing = (await db.select().from(documentVersions)
      .where(and(eq(documentVersions.id, parse.data.existing_document_version_id), eq(documentVersions.workspaceId, ctx.workspaceId))).limit(1))[0];
    if (!existing) return Response.json({ error: { code: "not_found" } }, { status: 404 });

    // Move this version under the existing contract with the next version number.
    const nextNum = await db.execute<{ n: number }>(
      (await import("drizzle-orm")).sql`
        SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM document_versions WHERE contract_id = ${existing.contractId}
      `
    );
    const versionNumber = nextNum.rows[0]?.n ?? existing.versionNumber + 1;
    await db.update(documentVersions).set({
      contractId: existing.contractId,
      versionNumber,
      versionLabel: `v${versionNumber}`
    }).where(eq(documentVersions.id, dvId));
    await audit({ workspaceId: ctx.workspaceId, ctx, action: "document.link_version", resourceType: "document_version", resourceId: dvId, metadata: { target_contract: existing.contractId } });
    await enqueueJob("intake", { documentVersionId: dvId, workspaceId: ctx.workspaceId, contractId: existing.contractId });
    return Response.json({ linked: true, contract_id: existing.contractId });
  }

  // keep_separate → just start processing under its own contract.
  await enqueueJob("intake", { documentVersionId: dvId, workspaceId: ctx.workspaceId, contractId: dv.contractId });
  return Response.json({ started: true });
}
