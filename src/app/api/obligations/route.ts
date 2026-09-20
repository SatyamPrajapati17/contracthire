import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { obligations } from "@/lib/db/obligations-schema";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { addDays, toISODate } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const window = sp.get("window") ?? "30d";
  const days = window === "all" ? 3650 : parseInt(window.replace(/\D/g, ""), 10) || 30;
  const today = toISODate(new Date());
  const until = addDays(today, days);

  const rows = await db.select({
    obligation: obligations,
    contractTitle: contracts.title
  }).from(obligations)
    .innerJoin(contracts, eq(contracts.id, obligations.contractId))
    .where(and(
      eq(obligations.workspaceId, ctx.workspaceId),
      gte(obligations.dueDate, today),
      lte(obligations.dueDate, until)
    ))
    .orderBy(obligations.dueDate)
    .limit(200);
  void desc;

  return Response.json({ data: rows.map((r) => ({ ...r.obligation, contract_title: r.contractTitle })) });
}
