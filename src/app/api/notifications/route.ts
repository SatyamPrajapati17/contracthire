import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { notifications } from "@/lib/db/risk-schema";
import { and, eq, isNull, desc } from "drizzle-orm";

export async function GET(_req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const rows = await db.select().from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return Response.json({ data: rows });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { id?: string };
  if (body.id) {
    await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.id, body.id), eq(notifications.userId, ctx.userId)));
  }
  return NextResponse.json({ ok: true });
}
