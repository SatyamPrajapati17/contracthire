import { NextRequest } from "next/server";
import { getCtx, canEdit } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts, documentVersions } from "@/lib/db/contracts-schema";
import { obligations, obligationEvents } from "@/lib/db/obligations-schema";
import { and, eq, desc } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: ctId } = await params;
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ct) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const rows = await db.select().from(obligations)
    .where(eq(obligations.contractId, ctId))
    .orderBy(desc(obligations.createdAt));
  return Response.json({ data: rows });
}

const Body = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  obligor: z.string().min(1),
  obligee: z.string().min(1),
  due_rule: z.enum(["fixed", "relative", "event_triggered", "recurring"]),
  due_rule_detail: z.record(z.unknown()),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium")
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });
  const { id: ctId } = await params;
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ct || !ct.currentVersionId) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const obId = id("ob");
  const detail = parse.data.due_rule_detail as { anchor?: string; anchor_value?: string; offset_days?: number };
  let dueDate: string | null = null;
  let math: string | null = null;
  let status: "suggested" | "needs_assumption" = "suggested";
  if (parse.data.due_rule === "fixed" && detail.anchor_value) {
    dueDate = detail.anchor_value;
    math = `fixed date ${detail.anchor_value} = ${detail.anchor_value}`;
  } else if (detail.anchor_value) {
    dueDate = detail.anchor_value;
    math = `fixed date ${detail.anchor_value} = ${detail.anchor_value}`;
  } else {
    status = "needs_assumption";
  }

  await db.insert(obligations).values({
    id: obId,
    workspaceId: ctx.workspaceId,
    contractId: ctId,
    sourceVersionId: ct.currentVersionId,
    title: parse.data.title,
    description: parse.data.description ?? null,
    obligor: parse.data.obligor,
    obligee: parse.data.obligee,
    dueRule: parse.data.due_rule,
    dueRuleDetail: JSON.stringify(parse.data.due_rule_detail),
    dueDate,
    dueDateMath: math,
    priority: parse.data.priority,
    status,
    ownerUserId: ctx.userId
  });
  await db.insert(obligationEvents).values({
    id: id("oe"), workspaceId: ctx.workspaceId, obligationId: obId,
    eventType: "created_manual", actorUserId: ctx.userId, payload: "{}"
  });
  await audit({ workspaceId: ctx.workspaceId, ctx, action: "obligation.create", resourceType: "obligation", resourceId: obId });
  return Response.json({ id: obId }, { status: 201 });
}
