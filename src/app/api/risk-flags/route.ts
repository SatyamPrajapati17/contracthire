import { NextRequest } from "next/server";
import { getCtx, canEdit } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { riskFlags } from "@/lib/db/risk-schema";
import { contracts as contractsTbl } from "@/lib/db/contracts-schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const severity = sp.get("severity");
  const status = sp.get("status") ?? "open";

  const conditions = [eq(riskFlags.workspaceId, ctx.workspaceId)];
  if (status && status !== "all") conditions.push(eq(riskFlags.status, status as "open"));
  if (severity) conditions.push(eq(riskFlags.severity, severity as "high"));

  const rows = await db.select({
    flag: riskFlags,
    contractTitle: contractsTbl.title
  }).from(riskFlags)
    .innerJoin(contractsTbl, eq(contractsTbl.id, riskFlags.contractId))
    .where(and(...conditions))
    .orderBy(sql`case ${riskFlags.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(riskFlags.createdAt))
    .limit(200);

  return Response.json({ data: rows.map((r) => ({ ...r.flag, contract_title: r.contractTitle })) });
}

const ManualBody = z.object({
  contract_id: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  recommended_step: z.string().min(1)
});

/** Manual flag creation (permission matrix, phase 8): contributor and above. */
export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });
  const parse = ManualBody.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const ct = (await db.select().from(contractsTbl)
    .where(and(eq(contractsTbl.id, parse.data.contract_id), eq(contractsTbl.workspaceId, ctx.workspaceId), sql`${contractsTbl.deletedAt} is null`))
    .limit(1))[0];
  if (!ct || !ct.currentVersionId) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const flagId = id("rf");
  await db.insert(riskFlags).values({
    id: flagId,
    workspaceId: ctx.workspaceId,
    contractId: ct.id,
    documentVersionId: ct.currentVersionId,
    playbookRuleId: null,
    category: parse.data.category,
    flagType: "manual",
    title: parse.data.title,
    explanation: parse.data.explanation,
    severity: parse.data.severity,
    confidence: null,
    recommendedStep: parse.data.recommended_step,
    status: "open"
  });
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "risk.create", resourceType: "risk_flag", resourceId: flagId,
    metadata: { contract_id: ct.id, severity: parse.data.severity, source: "manual" }
  });
  return Response.json({ id: flagId }, { status: 201 });
}
