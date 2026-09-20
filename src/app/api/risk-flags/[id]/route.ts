import { NextRequest } from "next/server";
import { getCtx, canDecideRisk, canManageMembers } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { riskFlags, riskDecisions } from "@/lib/db/risk-schema";
import { and, eq, desc } from "drizzle-orm";
import { audit, contentHash } from "@/lib/audit";
import { id } from "@/lib/ids";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: flagId } = await params;
  const flag = (await db.select().from(riskFlags)
    .where(and(eq(riskFlags.id, flagId), eq(riskFlags.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!flag) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const decisions = await db.select().from(riskDecisions)
    .where(eq(riskDecisions.riskFlagId, flagId))
    .orderBy(desc(riskDecisions.createdAt));

  return Response.json({ flag, decisions });
}

/** Reopen a decided flag (permission matrix, phase 8): legal_reviewer / admin. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: flagId } = await params;
  const flag = (await db.select().from(riskFlags)
    .where(and(eq(riskFlags.id, flagId), eq(riskFlags.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!flag) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canDecideRisk(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Reopening a flag requires the Legal Reviewer role." } }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { note?: string };
  const before = { status: flag.status };
  await db.update(riskFlags).set({ status: "open", supersededBy: null }).where(eq(riskFlags.id, flagId));
  await db.insert(riskDecisions).values({
    id: id("rd"),
    workspaceId: ctx.workspaceId,
    riskFlagId: flagId,
    decision: "reopened",
    note: body.note ?? null,
    decidedBy: ctx.userId,
    decidedRole: ctx.role
  });
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "risk.reopen", resourceType: "risk_flag", resourceId: flagId,
    beforeHash: contentHash(before), afterHash: contentHash({ status: "open" }), metadata: { note: body.note ?? null }
  });
  return Response.json({ ok: true, status: "open" });
}

/** Admin-only hard delete (permission matrix, phase 8). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: flagId } = await params;
  const flag = (await db.select().from(riskFlags)
    .where(and(eq(riskFlags.id, flagId), eq(riskFlags.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!flag) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Deleting a risk flag requires workspace admin." } }, { status: 403 });

  const before = { id: flag.id, title: flag.title, status: flag.status, severity: flag.severity };
  await db.delete(riskDecisions).where(eq(riskDecisions.riskFlagId, flagId));
  await db.delete(riskFlags).where(eq(riskFlags.id, flagId));
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "risk.delete", resourceType: "risk_flag", resourceId: flagId,
    beforeHash: contentHash(before), metadata: { title: flag.title, severity: flag.severity }
  });
  return new Response(null, { status: 204 });
}
