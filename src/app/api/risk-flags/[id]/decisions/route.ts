import { NextRequest } from "next/server";
import { getCtx, canDecideRisk } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { riskFlags, riskDecisions } from "@/lib/db/risk-schema";
import { and, eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

const Body = z.object({
  decision: z.enum(["accepted_risk", "needs_negotiation", "escalated", "not_a_risk"]),
  note: z.string().optional(),
  signature: z.object({
    method: z.enum(["typed", "drawn", "face"]),
    signer: z.string().min(1),
    signed_at: z.string(),
    sig_hash: z.string()
  }).optional()
});

/** Append-only decision recording (FR-RK-05). Decisions are never updated or deleted. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canDecideRisk(ctx.role)) {
    return Response.json({ error: { code: "forbidden", message: "Recording a risk decision requires the Legal Reviewer role." } }, { status: 403 });
  }
  const { id: flagId } = await params;
  const flag = (await db.select().from(riskFlags)
    .where(and(eq(riskFlags.id, flagId), eq(riskFlags.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!flag) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const decId = id("rd");
  const sig = parse.data.signature;
  await db.insert(riskDecisions).values({
    id: decId,
    workspaceId: ctx.workspaceId,
    riskFlagId: flagId,
    decision: parse.data.decision,
    note: sig
      ? `[e-sign ${sig.method} by ${sig.signer} @ ${sig.signed_at} hash ${sig.sig_hash.slice(0, 16)}] ${parse.data.note ?? ""}`.trim()
      : parse.data.note ?? null,
    decidedBy: ctx.userId,
    decidedRole: ctx.role
  });
  await db.update(riskFlags).set({ status: "decided" }).where(eq(riskFlags.id, flagId));

  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "risk.decide", resourceType: "risk_flag", resourceId: flagId,
    metadata: {
      decision: parse.data.decision, note: parse.data.note ?? null, role: ctx.role,
      e_signature: sig ? { method: sig.method, signer: sig.signer, hash: sig.sig_hash } : null
    }
  });

  const remaining = await db.execute<{ open: number }>(
    (await import("drizzle-orm")).sql`
      SELECT count(*)::int AS open FROM risk_flags
      WHERE contract_id = ${flag.contractId} AND status = 'open' AND severity IN ('critical','high')
    `
  );
  return Response.json({
    decision_id: decId,
    approval_gate: (remaining.rows[0]?.open ?? 0) === 0 ? "unblocked" : "blocked",
    open_critical_high: remaining.rows[0]?.open ?? 0
  }, { status: 201 });
}
