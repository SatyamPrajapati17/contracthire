import { NextRequest } from "next/server";
import { getCtx, canEdit, canManageMembers } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq, isNull } from "drizzle-orm";
import { audit, contentHash } from "@/lib/audit";
import { z } from "zod";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: ctId } = await params;
  const rows = await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId), isNull(contracts.deletedAt)))
    .limit(1);
  if (!rows[0]) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  return Response.json(rows[0]);
}

const Body = z.object({
  title: z.string().optional(),
  counterparty_name: z.string().optional(),
  status: z.enum(["draft", "in_review", "negotiating", "approved", "executed", "active", "renewing", "expiring", "expired", "terminated", "archived"]).optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: ctId } = await params;
  const rows = await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId), isNull(contracts.deletedAt)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  // Approval gate: zero open critical/high flags required (FR-RK-04).
  if (parse.data.status === "approved") {
    const gate = await db.execute<{ open: number }>(await import("drizzle-orm").then(({ sql }) =>
      sql`SELECT count(*)::int AS open FROM risk_flags WHERE contract_id = ${ctId} AND status = 'open' AND severity IN ('critical','high')`
    ));
    if ((gate.rows[0]?.open ?? 0) > 0) {
      return Response.json({
        error: { code: "conflict", message: "Approval blocked: open critical or high severity flags.", details: { open_flags: gate.rows[0].open } }
      }, { status: 409 });
    }
    const gate2 = await db.execute<{ open: number }>(await import("drizzle-orm").then(({ sql }) =>
      sql`SELECT count(*)::int AS open FROM obligations WHERE contract_id = ${ctId} AND status = 'needs_assumption'`
    ));
    if ((gate2.rows[0]?.open ?? 0) > 0) {
      return Response.json({
        error: { code: "conflict", message: "Approval blocked: obligations need an assumption before approval.", details: { needs_assumption: gate2.rows[0].open } }
      }, { status: 409 });
    }
  }

  const before = contentHash(existing);
  await db.update(contracts).set({ ...parse.data, updatedAt: new Date() }).where(eq(contracts.id, ctId));
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: parse.data.status === "approved" ? "contract.approve" : "contract.update",
    resourceType: "contract", resourceId: ctId,
    beforeHash: before, afterHash: contentHash({ ...existing, ...parse.data }),
    metadata: parse.data.status === "approved" ? { status: "approved" } : undefined
  });
  return Response.json({ ok: true });
}

/** Admin-only hard delete (permission matrix, phase 8). Rows cascade via FK. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: ctId } = await params;
  const rows = await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Hard-deleting a contract requires workspace admin." } }, { status: 403 });

  const before = contentHash({ id: existing.id, title: existing.title, status: existing.status });
  await db.delete(contracts).where(eq(contracts.id, ctId));
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "contract.delete", resourceType: "contract", resourceId: ctId,
    beforeHash: before, metadata: { title: existing.title, hard_delete: true }
  });
  return new Response(null, { status: 204 });
}
