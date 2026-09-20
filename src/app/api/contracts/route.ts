import { NextRequest } from "next/server";
import { getCtx, canUpload } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq, sql, isNull, desc } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const conditions = [eq(contracts.workspaceId, ctx.workspaceId), isNull(contracts.deletedAt)];
  const status = sp.get("status");
  if (status) conditions.push(eq(contracts.status, status as "draft"));
  const type = sp.get("type");
  if (type) conditions.push(eq(contracts.contractType, type));
  const q = sp.get("q");
  if (q) {
    conditions.push(sql`to_tsvector('english', coalesce(${contracts.title},'') || ' ' || coalesce(${contracts.counterpartyName},'')) @@ websearch_to_tsquery('english', ${q})`);
  }
  const expiringBefore = sp.get("expiring_before");
  if (expiringBefore) conditions.push(sql`${contracts.expirationDate} <= ${expiringBefore}`);

  const rows = await db.select().from(contracts)
    .where(and(...conditions))
    .orderBy(desc(contracts.updatedAt))
    .limit(200);
  return Response.json({ data: rows });
}

const Body = z.object({
  title: z.string().min(1),
  contract_type: z.string().optional(),
  counterparty_name: z.string().optional()
});

export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canUpload(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const ctId = id("ct");
  await db.insert(contracts).values({
    id: ctId,
    workspaceId: ctx.workspaceId,
    title: parse.data.title,
    contractType: parse.data.contract_type ?? null,
    counterpartyName: parse.data.counterparty_name ?? null,
    ownerUserId: ctx.userId
  });
  await audit({ workspaceId: ctx.workspaceId, ctx, action: "contract.create", resourceType: "contract", resourceId: ctId });
  return Response.json({ contract_id: ctId }, { status: 201 });
}
