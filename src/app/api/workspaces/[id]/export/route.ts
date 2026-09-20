import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { extractedFields } from "@/lib/db/extraction-schema";
import { obligations } from "@/lib/db/obligations-schema";
import { riskFlags } from "@/lib/db/risk-schema";
import { and, desc, eq } from "drizzle-orm";
import { sheets, toCsv, type SheetRange } from "@/lib/sheets";
import { audit } from "@/lib/audit";

/* GET /api/workspaces/[id]/export?format=sheet|csv&contract=<contractId?>
   Exports fields, obligations, and open risk flags for the workspace (optionally
   one contract) to Google Sheets (service account) or a downloadable CSV.
   Every factual row carries its citation span so the sheet stays auditable. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: wsId } = await params;
  if (ctx.workspaceId !== wsId) {
    return Response.json({ error: { code: "forbidden", message: "Cross-workspace export is not allowed." } }, { status: 403 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "csv").toLowerCase();
  const contractId = url.searchParams.get("contract");

  const ctRows = contractId
    ? await db.select().from(contracts)
        .where(and(eq(contracts.id, contractId), eq(contracts.workspaceId, wsId))).limit(1)
    : await db.select().from(contracts).where(eq(contracts.workspaceId, wsId)).orderBy(desc(contracts.createdAt));
  if (ctRows.length === 0) return Response.json({ error: { code: "not_found", message: "No contracts to export." } }, { status: 404 });

  const fieldsByDv = new Map<string, typeof extractedFields.$inferSelect[]>();
  for (const ct of ctRows) {
    if (!ct.currentVersionId) continue;
    const rows = await db.select().from(extractedFields)
      .where(and(eq(extractedFields.documentVersionId, ct.currentVersionId), eq(extractedFields.workspaceId, wsId)));
    fieldsByDv.set(ct.currentVersionId, rows);
  }

  const contractById = new Map(ctRows.map((c) => [c.id, c]));
  const labelOf = (ctId: string) => contractById.get(ctId)?.title ?? ctId;

  const fieldRows = ctRows.filter((c) => c.currentVersionId).map((ct) => {
    const key = ct.currentVersionId as string;
    return { contract: ct, fields: fieldsByDv.get(key) ?? [] };
  });

  const factsRange: SheetRange = {
    sheetName: "Fields",
    values: [
      ["Contract", "Field", "Label", "Group", "Value", "Confidence", "Status", "Citation (page/section/quote)", "AI assistance, not legal advice"],
      ...fieldRows.flatMap(({ contract, fields }) =>
        fields
          .filter((f) => f.extractionKind === "factual")
          .map((f) => [
            contract.title,
            f.fieldKey,
            f.label,
            f.fieldGroup,
            f.valueText ?? "",
            f.confidence ?? null,
            f.validationStatus,
            f.primaryCitationId ?? ""
          ])
      )
    ]
  };

  const obsRows = await db.select().from(obligations)
    .where(eq(obligations.workspaceId, wsId)).orderBy(desc(obligations.createdAt)).limit(500);
  const obligationsRange: SheetRange = {
    sheetName: "Obligations",
    values: [
      ["Contract", "Title", "Description", "Rule (LLM, verbatim)", "Due date (computed by code)", "due_date_math", "Priority", "Status", "Needs assumption"],
      ...obsRows
        .filter((o) => !contractId || o.contractId === contractId)
        .map((o) => [
          labelOf(o.contractId),
          o.title,
          o.description ?? "",
          o.dueRuleDetail,
          o.dueDate ?? "",
          o.dueDateMath ?? "",
          o.priority,
          o.status,
          o.status === "needs_assumption" ? "yes" : "no"
        ])
    ]
  };

  const flagRows = await db.select().from(riskFlags)
    .where(eq(riskFlags.workspaceId, wsId)).orderBy(desc(riskFlags.createdAt)).limit(500);
  const risksRange: SheetRange = {
    sheetName: "Risk flags",
    values: [
      ["Contract", "Title", "Severity", "Category", "Confidence", "Status", "Recommended step"],
      ...flagRows
        .filter((f) => !contractId || f.contractId === contractId)
        .filter((f) => f.status !== "superseded")
        .map((f) => [
          labelOf(f.contractId),
          f.title,
          f.severity,
          f.category ?? "",
          f.confidence ?? null,
          f.status,
          f.recommendedStep ?? ""
        ])
    ]
  };

  const ranges = [factsRange, obligationsRange, risksRange];

  if (format === "csv") {
    const body = toCsv(ranges);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="contractlens-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store"
      }
    });
  }

  // format=sheet → Google Sheets via service account.
  if (sheets().provider !== "google") {
    return Response.json({
      error: {
        code: "sheets_not_configured",
        message: "Google Sheets export needs SHEETS_PROVIDER=google, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env (see README → Google Sheets). Use format=csv meanwhile."
      }
    }, { status: 501 });
  }
  try {
    const result = await sheets().writeRanges(ranges, process.env.GOOGLE_SHEETS_ID || undefined);
    await audit({
      workspaceId: wsId,
      ctx,
      action: "workspace.export",
      resourceType: "workspace",
      resourceId: wsId,
      metadata: { format: "sheet", contracts: ctRows.length, spreadsheet_url: result.url }
    });
    return Response.json({ exported: true, spreadsheet_url: result.url, spreadsheet_id: result.spreadsheetId });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "sheets_write_failed";
    return Response.json({ error: { code: "sheets_write_failed", message } }, { status: 502 });
  }
}
