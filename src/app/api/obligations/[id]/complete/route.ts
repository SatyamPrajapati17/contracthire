import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { obligations, obligationEvents } from "@/lib/db/obligations-schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

const Body = z.object({ evidence: z.string().optional(), note: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: obId } = await params;
  const ob = (await db.select().from(obligations)
    .where(and(eq(obligations.id, obId), eq(obligations.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ob) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  // Complete = owner or admin (doc 06 §3).
  const isOwner = ob.ownerUserId === ctx.userId || ob.ownerUserId === null;
  const isAdmin = ctx.role === "workspace_admin";
  const isLegal = ctx.role === "legal_reviewer";
  if (!isOwner && !isAdmin && !isLegal) {
    return Response.json({ error: { code: "forbidden", message: "Only the owner or an admin can complete this obligation." } }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { evidence?: string; note?: string };
  await db.update(obligations).set({
    status: "completed",
    completedAt: new Date(),
    completedBy: ctx.userId,
    evidenceKeys: body.evidence ? [body.evidence] : ob.evidenceKeys,
    updatedAt: new Date()
  }).where(eq(obligations.id, obId));

  await db.insert(obligationEvents).values({
    id: id("oe"), workspaceId: ob.workspaceId, obligationId: obId,
    eventType: "completed", actorUserId: ctx.userId,
    payload: JSON.stringify({ note: body.note ?? null })
  });
  await audit({ workspaceId: ob.workspaceId, ctx, action: "obligation.complete", resourceType: "obligation", resourceId: obId, metadata: { prior_status: ob.status } });
  return Response.json({ ok: true, status: "completed" });
}
