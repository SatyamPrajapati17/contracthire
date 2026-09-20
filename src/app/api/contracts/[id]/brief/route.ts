import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { extractedFields, citations } from "@/lib/db/extraction-schema";
import { obligations } from "@/lib/db/obligations-schema";
import { riskFlags } from "@/lib/db/risk-schema";
import { and, eq, desc } from "drizzle-orm";
import { storage } from "@/lib/ports";

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

const DISCLAIMER = "AI assistance. Verify before relying. This is not legal advice.";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: ctId } = await params;
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!ct) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const dvId = ct.currentVersionId;
  const fields = dvId
    ? await db.select().from(extractedFields).where(eq(extractedFields.documentVersionId, dvId))
    : [];

  const citIds = [...new Set(fields.map((f) => f.primaryCitationId).filter((x): x is string => Boolean(x)))];
  const citRows = citIds.length > 0
    ? await db.select().from(citations).where(eq(citations.workspaceId, ctx.workspaceId))
    : [];
  const citById = new Map(citRows.map((c) => [c.id, c]));

  const citationOf = (id: string | null) => {
    if (!id) return null;
    const c = citById.get(id);
    if (!c) return null;
    return {
      id: c.id, page: c.page, section_ref: c.sectionRef, section_title: c.sectionTitle,
      quoted_text: c.quotedText.slice(0, 200), resolvable: c.resolvable, ocr_derived: c.ocrDerived
    };
  };

  const facts = fields
    .filter((f) => f.extractionKind === "factual")
    .sort((a, b) => a.fieldGroup.localeCompare(b.fieldGroup))
    .map((f) => ({
      field_id: f.id, key: f.fieldKey, label: f.label, group: f.fieldGroup,
      value: f.valueText, value_normalized: safeParse(f.valueNormalized),
      confidence: f.confidence, validation_status: f.validationStatus,
      citation: citationOf(f.primaryCitationId),
      alt_citations: (f.altCitationIds ?? []).map(citationOf).filter(Boolean),
      searched_sections: f.searchedSections
    }));

  // Brief prose (interpretation + open questions) persisted by the summarize stage.
  let interpretation: unknown[] = [];
  let openQuestions: unknown[] = [];
  if (dvId) {
    try {
      const raw = await storage.get(`w/${ctx.workspaceId}/c/${ctId}/v/${dvId}/brief.json`);
      const brief = JSON.parse(raw.toString("utf8")) as {
        interpretation: { text: string; field_ids: string[]; self_confidence: number }[];
        open_questions: { question: string; field_ids: string[] }[];
      };
      interpretation = brief.interpretation.map((i) => ({ text: i.text, field_ids: i.field_ids, extraction_kind: "interpretation", confidence: i.self_confidence }));
      openQuestions = brief.open_questions.map((q) => ({ question: q.question, field_ids: q.field_ids }));
    } catch { /* grid-only fallback when brief.json absent */ }
  }

  const flags = await db.select().from(riskFlags)
    .where(eq(riskFlags.contractId, ctId)).orderBy(desc(riskFlags.createdAt)).limit(20);
  const obs = await db.select().from(obligations)
    .where(eq(obligations.contractId, ctId)).orderBy(desc(obligations.createdAt)).limit(30);

  return Response.json({
    contract: {
      id: ct.id, title: ct.title, status: ct.status, counterparty: ct.counterpartyName,
      type: ct.contractType, expiration_date: ct.expirationDate, renewal_notice_by: ct.renewalNoticeBy,
      current_version_id: dvId
    },
    facts,
    interpretation,
    open_questions: openQuestions,
    risks: flags.filter((f) => f.status !== "superseded").map((f) => ({
      id: f.id, title: f.title, severity: f.severity, category: f.category,
      confidence: f.confidence, citation_id: f.citationId, recommended_step: f.recommendedStep, status: f.status
    })),
    obligations_count: obs.length,
    disclaimer: DISCLAIMER
  });
}
