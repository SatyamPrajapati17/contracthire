import { NextRequest } from "next/server";
import { getCtx, canEdit, canManageMembers } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { obligations, obligationEvents } from "@/lib/db/obligations-schema";
import { and, eq, sql } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit, contentHash } from "@/lib/audit";
import { alertSchedules } from "@/lib/db/obligations-schema";
import { scheduleAlertsFor, rescheduleAlertsFor } from "@/lib/alerts";
import { computeDueDate, type DueRuleDetail } from "@/lib/dates";
import { z } from "zod";

const Body = z.object({
  action: z.enum(["accept", "edit", "reject", "assign", "snooze", "supply_anchor"]),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  owner_user_id: z.string().nullable().optional(),
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  snooze_until: z.string().optional()
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: obId } = await params;
  const ob = (await db.select().from(obligations)
    .where(and(eq(obligations.id, obId), eq(obligations.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ob) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  const events = await db.select().from(obligationEvents)
    .where(eq(obligationEvents.obligationId, obId));
  return Response.json({ obligation: ob, events });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: obId } = await params;
  // Existence is never disclosed: workspace-scoped fetch first, role check after.
  const ob = (await db.select().from(obligations)
    .where(and(eq(obligations.id, obId), eq(obligations.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ob) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });
  const body = parse.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  let eventType: string = body.action;

  if (body.action === "accept") {
    updates.status = "active";
    updates.ownerUserId = body.owner_user_id ?? ob.ownerUserId ?? ctx.userId;
  } else if (body.action === "reject") {
    updates.status = "rejected";
  } else if (body.action === "edit") {
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priority) updates.priority = body.priority;
  } else if (body.action === "assign") {
    if (body.owner_user_id) updates.ownerUserId = body.owner_user_id;
  } else if (body.action === "snooze") {
    updates.status = "snoozed";
  } else if (body.action === "supply_anchor") {
    if (!body.anchor_date) return Response.json({ error: { code: "validation_failed", message: "anchor_date required" } }, { status: 422 });
    const detail = JSON.parse(ob.dueRuleDetail) as DueRuleDetail;
    const computed = computeDueDate(detail, { [detail.anchor]: body.anchor_date, ...emptyAnchors(ob.dueRuleDetail) });
    if (computed.needsAssumption) {
      return Response.json({ error: { code: "validation_failed", message: computed.assumptionReason } }, { status: 422 });
    }
    updates.dueDate = computed.dueDate;
    updates.dueDateMath = computed.math;
    updates.status = "suggested"; // still needs explicit accept (G2)
    eventType = "anchor_supplied";
  }

  await db.update(obligations).set(updates).where(eq(obligations.id, obId));

  await db.insert(obligationEvents).values({
    id: id("oe"),
    workspaceId: ob.workspaceId,
    obligationId: obId,
    eventType,
    actorUserId: ctx.userId,
    payload: JSON.stringify({ prior_status: ob.status, updates: Object.keys(updates) })
  });
  await audit({
    workspaceId: ob.workspaceId, ctx,
    action: `obligation.${body.action}`,
    resourceType: "obligation", resourceId: obId,
    metadata: { prior_status: ob.status }
  });

  // Alert scheduling: only accepted obligations notify (G2); due-date changes reschedule.
  if (body.action === "accept") {
    const fresh = (await db.select().from(obligations).where(eq(obligations.id, obId)).limit(1))[0];
    const created = await scheduleAlertsFor({
      id: fresh.id, workspaceId: fresh.workspaceId, dueDate: fresh.dueDate,
      ownerUserId: fresh.ownerUserId, priority: fresh.priority, gracePeriodDays: fresh.gracePeriodDays
    });
    return Response.json({ ok: true, status: "active", alerts_scheduled: created });
  }
  if (body.action === "edit" || body.action === "supply_anchor") {
    const fresh = (await db.select().from(obligations).where(eq(obligations.id, obId)).limit(1))[0];
    await rescheduleAlertsFor(obId, fresh.dueDate, ob.workspaceId);
  }
  return Response.json({ ok: true, status: updates.status ?? ob.status });
}

/** Admin-only hard delete (permission matrix, phase 8). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: obId } = await params;
  const ob = (await db.select().from(obligations)
    .where(and(eq(obligations.id, obId), eq(obligations.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ob) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Deleting an obligation requires workspace admin." } }, { status: 403 });

  const before = { id: ob.id, title: ob.title, status: ob.status, due_date: ob.dueDate };
  // Deliveries hang off schedules; delete them via the schedule subquery.
  await db.execute(sql`DELETE FROM alert_deliveries WHERE alert_schedule_id IN (SELECT id FROM alert_schedules WHERE obligation_id = ${obId})`);
  await db.delete(alertSchedules).where(eq(alertSchedules.obligationId, obId));
  await db.delete(obligationEvents).where(eq(obligationEvents.obligationId, obId));
  await db.delete(obligations).where(eq(obligations.id, obId));
  await audit({
    workspaceId: ob.workspaceId, ctx, action: "obligation.delete", resourceType: "obligation", resourceId: obId,
    beforeHash: contentHash(before), metadata: { title: ob.title, prior_status: ob.status }
  });
  return new Response(null, { status: 204 });
}

function emptyAnchors(_detail: string): Record<string, string | null> {
  return { expiration_date: null, signature_date: null, effective_date: null, commencement_date: null, invoice_date: null };
}
