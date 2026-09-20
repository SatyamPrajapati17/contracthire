import "dotenv/config";

/* Extra demo portfolio: a second fictional company pair so the workspace
   shows a lived-in register. Idempotent — skips if the contract exists.
   All citations are sliced from the actual stored text, so they resolve. */
import { db } from "../src/lib/db/client";
import { sql, eq as drizzleEq } from "drizzle-orm";
import * as t from "../src/lib/db/index";

const SUPPLIER = "Vertex Logistics GmbH";
const BUYER = "Harbourline Foods Ltd.";

const CONTRACT_TITLE = "vertex-freight-framework";

const PAGE_TEXT = `FREIGHT SERVICES FRAMEWORK AGREEMENT

This Framework Agreement ("Agreement") is entered into between ${SUPPLIER}, a company registered in Germany ("Supplier"), and ${BUYER}, a company registered in England and Wales ("Customer"), effective 1 March 2026.

1. SCOPE
1.1 The Supplier shall provide road freight and warehousing services across the EU and UK as described in Annex A.

2. TERM AND RENEWAL
2.1 This Agreement runs for twenty-four (24) months from the Effective Date and renews automatically for twelve (12) month periods unless either party gives written notice of non-renewal at least ninety (90) days before the end of the then-current term.

3. RATES AND PAYMENT
3.1 Rates are as set out in Annex B. Invoices are payable within thirty (30) days of invoice date.
3.2 Late payments accrue interest at two percent (2%) per month above the ECB base rate.

4. INSURANCE
4.1 The Supplier shall maintain cargo liability insurance of not less than EUR 5,000,000 per occurrence and employer liability insurance as required by law.

5. CONFIDENTIALITY
5.1 Each party shall keep confidential information secret for three (3) years after termination.

6. TERMINATION
6.1 Either party may terminate for material breach not cured within twenty (20) days of written notice.
6.2 The Customer may terminate for convenience on sixty (60) days written notice.

7. LIABILITY
7.1 The Supplier's aggregate liability under this Agreement shall not exceed the total charges paid in the preceding six (6) months. Neither party is liable for indirect or consequential loss, except in cases of gross negligence or willful misconduct.

8. GOVERNING LAW
8.1 This Agreement is governed by the laws of England and Wales.`;

function slice(needle: string): { start: number; end: number } {
  const idx = PAGE_TEXT.indexOf(needle);
  if (idx < 0) throw new Error(`seed-extra: cannot locate ${needle}`);
  return { start: idx, end: idx + needle.length };
}

async function main() {
  const wsId = (await db.execute<{ id: string }>(sql`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  if (!wsId) throw new Error("no workspace — run the main seed first");

  // Idempotency: key on a completed seed (fields exist), not just the contract,
  // so a partial run re-runs cleanly after a purge.
  const exists = (await db.execute<{ id: string }>(sql
    `SELECT ef.id FROM extracted_fields ef JOIN contracts c ON c.id = ef.contract_id
     WHERE c.title = ${CONTRACT_TITLE} AND c.workspace_id = ${wsId} LIMIT 1`)).rows[0];
  if (exists) {
    console.log("seed-extra: vertex contract already present — nothing to do");
    process.exit(0);
  }

  const priya = (await db.execute<{ id: string }>(sql`SELECT id FROM users WHERE email = 'priya@harbourline.example'`)).rows[0];
  const mira = (await db.execute<{ id: string }>(sql`SELECT id FROM users WHERE email = 'mira@harbourline.example'`)).rows[0];
  const ownerId = (priya ?? mira)?.id ?? null;

  const { id } = await import("../src/lib/ids");
  const ctId = id("ct");
  const dvId = id("dv");

  // Contract first (no current version yet), then the version, then link.
  await db.insert(t.contracts).values({
    id: ctId,
    workspaceId: wsId,
    title: CONTRACT_TITLE,
    counterpartyName: SUPPLIER,
    contractType: "framework",
    status: "active",
    ownerId,
    effectiveDate: "2026-03-01",
    expirationDate: "2028-02-29",
    renewalNoticeBy: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    totalValueMinor: 9600000,
    currency: "EUR",
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);

  await db.insert(t.documentVersions).values({
    id: dvId,
    workspaceId: wsId,
    contractId: ctId,
    versionLabel: "v1",
    versionNumber: 1,
    filename: "vertex-freight-framework.pdf",
    mimeType: "application/pdf",
    byteSize: Buffer.byteLength(PAGE_TEXT),
    sha256: "seed-extra-vertex",
    pageCount: 1,
    language: "en",
    storageKey: `contracts/${ctId}/${dvId}.txt`,
    status: "ready",
    uploadedBy: ownerId!,
    createdAt: new Date()
  } as never);

  await db.update(t.contracts).set({ currentVersionId: dvId }).where(drizzleEq(t.contracts.id, ctId));

  // Store the text in the DB object store so the viewer works everywhere.
  await (await import("../src/lib/db/client")).pool.query(
    `INSERT INTO object_store (key, data, size, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO NOTHING`,
    [`contracts/${ctId}/${dvId}.txt`, Buffer.from(PAGE_TEXT, "utf8"), Buffer.byteLength(PAGE_TEXT)]
  );

  await db.insert(t.parsedPages).values({
    id: id("pp"),
    workspaceId: wsId,
    documentVersionId: dvId,
    pageNumber: 1,
    text: PAGE_TEXT,
    charStart: 0,
    charEnd: PAGE_TEXT.length,
    ocrDerived: false,
    createdAt: new Date()
  } as never);

  await db.insert(t.chunks).values({
    id: id("chk"),
    workspaceId: wsId,
    contractId: ctId,
    documentVersionId: dvId,
    seq: 0,
    pageStart: 1,
    pageEnd: 1,
    text: PAGE_TEXT.slice(0, 1800),
    charStart: 0,
    charEnd: 1800,
    sectionRef: null,
    ocrDerived: false,
    createdAt: new Date()
  } as never);

  /* Fields with genuine citations */
  const fields: Array<{ key: string; label: string; group: string; value: string; norm: unknown; conf: number; quote: string }> = [
    { key: "payment_terms", label: "Payment terms", group: "payment", value: "Net 30 from invoice date", norm: { net_days: 30 }, conf: 0.93, quote: "Invoices are payable within thirty (30) days of invoice date." },
    { key: "termination_notice", label: "Termination for convenience", group: "termination", value: "60 days written notice", norm: { notice_days: 60 }, conf: 0.94, quote: "The Customer may terminate for convenience on sixty (60) days written notice." },
    { key: "insurance", label: "Insurance", group: "insurance", value: "EUR 5,000,000 cargo liability per occurrence", norm: { amount: 5000000, currency: "EUR" }, conf: 0.92, quote: "maintain cargo liability insurance of not less than EUR 5,000,000 per occurrence" },
    { key: "confidentiality_term", label: "Confidentiality", group: "confidentiality", value: "3 years after termination", norm: { years: 3 }, conf: 0.95, quote: "keep confidential information secret for three (3) years after termination" },
    { key: "liability_cap", label: "Liability cap", group: "liability", value: "6 months of charges", norm: { months: 6 }, conf: 0.91, quote: "shall not exceed the total charges paid in the preceding six (6) months" }
  ];

  const fieldIds: Record<string, string> = {};
  for (const f of fields) {
    const span = slice(f.quote);
    const citId = id("cit");
    const fid = id("ef");
    fieldIds[f.key] = fid;
    await db.insert(t.citations).values({
      id: citId,
      workspaceId: wsId,
      documentVersionId: dvId,
      page: 1,
      sectionRef: f.quote.startsWith("The Customer") ? "§6.2" : f.key === "payment_terms" ? "§3.1" : f.key === "insurance" ? "§4.1" : f.key === "confidentiality_term" ? "§5.1" : "§7.1",
      charStart: span.start,
      charEnd: span.end,
      quotedText: f.quote,
      matchConfidence: 1.0,
      resolvable: true,
      ocrDerived: false,
      createdAt: new Date()
    } as never);
    await db.insert(t.extractedFields).values({
      id: fid,
      documentVersionId: dvId,
      workspaceId: wsId,
      contractId: ctId,
      fieldKey: f.key,
      label: f.label,
      fieldGroup: f.group,
      valueText: f.value,
      valueNormalized: JSON.stringify(f.norm),
      extractionKind: "factual",
      confidence: f.conf,
      selfConfidence: f.conf,
      groundingScore: 1.0,
      validationStatus: "found",
      primaryCitationId: citId,
      modelVersion: "seed-extra",
      promptVersion: "seed-extra-1",
      createdAt: new Date()
    } as never);
  }

  /* Obligations: one live with computed date, one gated on an assumption */
  const payCitId = (await db.execute<{ id: string }>(sql`SELECT id FROM citations WHERE document_version_id = ${dvId} AND section_ref = '§3.1' LIMIT 1`)).rows[0]?.id;
  const renewCitId = (await db.execute<{ id: string }>(sql`SELECT id FROM citations WHERE document_version_id = ${dvId} LIMIT 1 OFFSET 1`)).rows[0]?.id;
  const obLive = id("ob");
  await db.insert(t.obligations).values({
    id: obLive,
    workspaceId: wsId,
    contractId: ctId,
    sourceVersionId: dvId,
    title: "Pay Vertex freight invoices (Net 30)",
    description: "Customer pays Supplier invoices within thirty (30) days of invoice date.",
    obligor: "our_entity",
    obligee: SUPPLIER,
    dueRule: "relative",
    dueRuleDetail: { anchor: "invoice_date", offsetDays: 30, note: "first cycle anchored on effective_date 2026-03-01" },
    dueDate: "2026-04-30",
    dueDateMath: "invoice_date + 30 days",
    priority: "high",
    status: "active",
    ownerUserId: ownerId,
    citationId: payCitId,
    confidence: 0.9,
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);

  await db.insert(t.obligations).values({
    id: id("ob"),
    workspaceId: wsId,
    contractId: ctId,
    sourceVersionId: dvId,
    title: "Give non-renewal notice to Vertex (90 days)",
    description: "Either party must give written notice of non-renewal at least ninety (90) days before the end of the then-current term.",
    obligor: "our_entity",
    obligee: SUPPLIER,
    dueRule: "relative",
    dueRuleDetail: { anchor: "expiration_date", offsetDays: -90, note: "waiting on confirmed expiration anchor" },
    dueDate: null,
    dueDateMath: null,
    priority: "critical",
    status: "needs_assumption",
    ownerUserId: ownerId,
    citationId: renewCitId,
    confidence: 0.88,
    createdAt: new Date(),
    updatedAt: new Date()
  } as never);

  /* Risk flags: one open high, one decided medium */
  await db.insert(t.riskFlags).values({
    id: id("rf"),
    workspaceId: wsId,
    contractId: ctId,
    documentVersionId: dvId,
    category: "legal",
    flagType: "limitation_cap",
    severity: "high",
    title: "Liability cap limited to 6 months of charges",
    explanation: "Below the playbook minimum of 12 months for freight frameworks.",
    expectedText: "aggregate liability not exceed fees paid in the preceding 12 months",
    foundText: "shall not exceed the total charges paid in the preceding six (6) months",
    confidence: 0.9,
    status: "open",
    recommendedStep: "Negotiate a 12-month cap or add a super-cap for data breaches.",
    suggestedReviewerRole: "legal_reviewer",
    citationId: (await db.execute<{ id: string }>(sql`SELECT id FROM citations WHERE document_version_id = ${dvId} AND section_ref = '§7.1' LIMIT 1`)).rows[0]?.id,
    createdAt: new Date()
  } as never);

  const rf2 = id("rf");
  await db.insert(t.riskFlags).values({
    id: rf2,
    workspaceId: wsId,
    contractId: ctId,
    documentVersionId: dvId,
    category: "financial",
    flagType: "late_payment_interest",
    severity: "medium",
    title: "Late payment interest at 2% per month",
    explanation: "Above the 1.5% playbook ceiling; acceptable with finance sign-off.",
    expectedText: "interest at 1.5% per month",
    foundText: "interest at two percent (2%) per month above the ECB base rate",
    confidence: 0.87,
    status: "decided",
    decision: "accepted",
    decidedBy: ownerId,
    decidedAt: new Date(),
    decisionNote: "Finance accepted; invoices are paid Net 30 without late events in practice.",
    recommendedStep: "Accept with finance sign-off.",
    suggestedReviewerRole: "legal_reviewer",
    citationId: (await db.execute<{ id: string }>(sql`SELECT id FROM citations WHERE document_version_id = ${dvId} AND section_ref = '§3.2' LIMIT 1`)).rows[0]?.id,
    createdAt: new Date()
  } as never);

  // audit_events.id is DB-generated (bigint) — omit it.
  await db.insert(t.auditEvents).values([
    {
      workspaceId: wsId, actorUserId: ownerId,
      action: "contract.create", resourceType: "contract", resourceId: ctId,
      metadata: JSON.stringify({ seeded: true, source: "seed-extra" }), createdAt: new Date()
    },
    {
      workspaceId: wsId, actorUserId: (mira?.id ?? ownerId), actorRole: "legal_reviewer",
      action: "risk.decide", resourceType: "risk_flag", resourceId: rf2,
      metadata: JSON.stringify({ seeded: true, decision: "accepted" }), createdAt: new Date()
    }
  ] as never);

  console.log("seed-extra: Vertex Logistics framework added (5 cited fields, 2 obligations, 2 risk flags)");
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-extra failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
