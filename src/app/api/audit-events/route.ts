import { NextRequest } from "next/server";
import { getCtx, canReadAudit } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/risk-schema";
import { users } from "@/lib/db/schema";
import { and, eq, desc, like, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canReadAudit(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Audit log requires admin or legal reviewer." } }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const action = sp.get("action");
  const resourceType = sp.get("resource_type");

  const conditions = [eq(auditEvents.workspaceId, ctx.workspaceId)];
  if (action) conditions.push(like(auditEvents.action, `${action}%`));
  if (resourceType) conditions.push(eq(auditEvents.resourceType, resourceType));

  const rows = await db.select({
    event: auditEvents,
    actorEmail: users.email
  }).from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);
  void sql;

  return Response.json({
    data: rows.map((r) => ({
      id: r.event.id,
      action: r.event.action,
      resource_type: r.event.resourceType,
      resource_id: r.event.resourceId,
      actor: r.actorEmail ?? "system",
      actor_role: r.event.actorRole,
      // metadata is jsonb — Drizzle already returns a parsed object.
      metadata: (r.event.metadata as Record<string, unknown> | string | null) ?? {},
      created_at: r.event.createdAt
    }))
  });
}
