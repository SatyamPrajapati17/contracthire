import "dotenv/config";

/* ═══════════════════════════════════════════════════════════════════════
   Demo seed (doc 09): Harbourline Foods workspace, Northwind MSA v2 + v3
   (fictional, authored for testing), playbook with 10 rules, two supporting
   contracts, obligations with code-computed dates, alerts, audit trail.
   All citations are located by slicing the actual seeded text, so every
   span genuinely resolves.
   ═══════════════════════════════════════════════════════════════════════ */

const VENDOR = "Northwind Systems Ltd.";
const CUSTOMER = "Harbourline Foods Ltd.";

function msaText(v: 2 | 3): string {
  const notice = v === 2 ? "sixty (60) days" : "ninety (90) days";
  const net = v === 2 ? "thirty (30)" : "fifteen (15)";
  const cap = v === 2 ? "twelve (12) months" : "three (3) months";
  return `MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is entered into between ${VENDOR}, a company registered in England and Wales ("Vendor"), and ${CUSTOMER}, a company registered in England and Wales ("Customer").

1. DEFINITIONS
1.1 "Services" means the managed logistics software services described in Schedule 1.
1.2 "Commencement Date" means the date on which the Vendor first makes the Services available to the Customer.

2. TERM
2.1 This Agreement commences on 1 December 2025 and continues for an initial term of twelve (12) months, expiring on 30 November 2026 (the "Term").
2.2 The Agreement renews automatically for successive twelve (12) month terms unless either party gives written notice of non-renewal at least ${notice} before the end of the then-current Term, as set out in clause 9.2.

3. SERVICES AND SERVICE LEVELS
3.1 The Vendor shall provide the Services in accordance with Schedule 1.
3.2 The Vendor warrants a monthly uptime of ninety-nine point five percent (99.5%) for the Services. Service credits for missed uptime are set out in Schedule 2.

4. SUPPORT
4.1 The Vendor shall provide support during business hours in accordance with Schedule 2.

5. FEES AND PAYMENT
5.1 The annual fee is USD 120,000 per year, billed quarterly in advance. Invoices are payable Net ${net} from invoice date.
5.2 The Vendor may adjust fees on renewal by no more than the UK Consumer Prices Index.

6. DATA PROTECTION
6.1 Each party shall comply with applicable UK data protection legislation in connection with personal data processed under this Agreement.

7. REPORTING
7.1 The Vendor shall deliver a monthly uptime report by the 5th day of each month covering the previous month.

8. SECURITY
8.1 The Vendor shall maintain information security controls consistent with ISO 27001 and shall notify the Customer without undue delay after becoming aware of a personal data breach.

9. TERMINATION AND RENEWAL
9.1 Either party may terminate this Agreement for material breach not cured within thirty (30) days of written notice.
9.2 For non-renewal, either party must give written notice at least ${notice} before the end of the then-current Term.
9.3 The Customer may terminate for convenience on ninety (90) days written notice, paying all fees accrued to the termination date.

10. CONFIDENTIALITY
10.1 Each party shall keep the other party's confidential information secret for five (5) years after termination.

11. LIMITATION OF LIABILITY
11.3 Subject to clause 12.1, each party's aggregate liability under this Agreement shall not exceed the fees paid in the preceding ${cap}. Neither party is liable for indirect or consequential loss.

12. INDEMNITY
12.1 The Customer shall indemnify the Vendor against all losses, damages, and expenses arising from claims by third parties relating to data the Customer supplies to the Services. This indemnity is not subject to the cap in clause 11.3 and is uncapped in amount.

13. INSURANCE
13.1 The Vendor shall maintain professional indemnity insurance of at least GBP 2,000,000 and shall provide certificates of insurance within fifteen (15) days of the Commencement Date and on renewal.

14. ANNUAL SECURITY REVIEW
14.1 The Vendor shall complete an annual security review within thirty (30) days of each anniversary of the Commencement Date and provide a summary to the Customer.

15. GENERAL
15.1 Governing law: this Agreement is governed by the laws of England and Wales, and the courts of England and Wales have exclusive jurisdiction.
15.2 Neither party may assign this Agreement without the other party's prior written consent.

Schedule 1 — Managed logistics software services. The Commencement Date for scheduling purposes is the signature date of this Agreement.
Schedule 2 — Service levels and service credits: 99.5% monthly uptime; credits of 5% of the monthly fee per full percentage point below target, up to 25%.`;
}

const CLEANING_TEXT = `CLEANING SERVICES AGREEMENT between Ravenscourt Facilities Ltd and Harbourline Foods Ltd.
1. The Supplier shall clean the Customer's premises at 12 Dock Road, London, each business day.
2. The monthly fee is GBP 3,400 payable Net 30 from invoice date.
3. Either party may terminate on thirty (30) days written notice.
4. The Supplier shall hold public liability insurance of at least GBP 1,000,000.
5. This agreement is governed by the laws of England and Wales.`;

const NDA_TEXT = `MUTUAL NON-DISCLOSURE AGREEMENT between Helix Software Ltd and Harbourline Foods Ltd.
1. Each party may disclose confidential information to the other for the purpose of evaluating a potential supply agreement.
2. Confidential information must be protected with reasonable care for three (3) years from disclosure.
3. The obligations of confidentiality do not apply to information that is public or independently developed.
4. Governing law: England and Wales.`;

/* ── helpers ─────────────────────────────────────────────────────────── */
async function main() {
  const { pool, db } = await import("../src/lib/db/client");
  const drizzle = await import("drizzle-orm");
  const { sql } = drizzle;
  const tables = await import("../src/lib/db/index");
  const { id, sha256Hex } = await import("../src/lib/ids");
  const { storage } = await import("../src/lib/ports");
  const { computeDueDate, addDays } = await import("../src/lib/dates");
  const { embeddings } = await import("../src/lib/ports");
  const { eq } = await import("drizzle-orm");

  // Idempotency: re-seeding wipes demo data.
  console.log("→ clearing previous demo data");
  await db.execute(sql`TRUNCATE notifications, alert_deliveries, alert_schedules, obligation_events, obligations,
    risk_decisions, risk_flags, comparison_changes, comparisons, chat_messages, chat_sessions,
    field_corrections, extracted_fields, citations, chunks, clauses, text_layout, parsed_pages,
    processing_stages, ai_invocations, document_versions, contracts, playbook_rules, memberships,
    magic_tokens, sessions, users, workspaces CASCADE`);
  await db.execute(sql`TRUNCATE jobs`);
  await db.execute(sql`TRUNCATE audit_events RESTART IDENTITY CASCADE`);

  /* ── Workspace + users ────────────────────────────────────────────── */
  const wsId = id("ws");
  const priyaId = id("usr");
  const miraId = id("usr");
  await db.insert(tables.workspaces).values({
    id: wsId, name: "Harbourline Foods", timezone: "Europe/London"
  });
  await db.insert(tables.users).values([
    { id: priyaId, email: "priya@harbourline.example", displayName: "Priya (Ops)" },
    { id: miraId, email: "mira@harbourline.example", displayName: "Mira (Legal)" }
  ]);
  await db.insert(tables.memberships).values([
    { id: id("mem"), workspaceId: wsId, userId: priyaId, role: "contract_owner" },
    { id: id("mem"), workspaceId: wsId, userId: miraId, role: "legal_reviewer" }
  ]);
  console.log("→ workspace Harbourline Foods created (priya@harbourline.example, mira@harbourline.example)");

  /* ── Playbook: 10 seeded rules ────────────────────────────────────── */
  const indemnityRuleId = id("pbr");
  const playbook: (typeof tables.playbookRules.$inferInsert)[] = [
    { id: indemnityRuleId, workspaceId: wsId, clauseType: "indemnity", ruleName: "Indemnity must sit under the general liability cap", expectation: "Indemnity obligations are subject to the aggregate liability cap", evaluator: JSON.stringify({ type: "threshold", field: "liability.indemnity_capped", op: "==", value: true }), outcomeIfViolated: "unacceptable", reviewerRole: "legal", severity: "high", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "liability", ruleName: "Liability cap at least 12 months of fees", expectation: "liability cap >= 12 months of fees", evaluator: JSON.stringify({ type: "threshold", field: "liability.cap_months", op: ">=", value: 12 }), outcomeIfViolated: "review_required", reviewerRole: "legal", severity: "high", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "payment", ruleName: "Payment terms Net 30 or longer", expectation: "payment terms >= Net 30", evaluator: JSON.stringify({ type: "threshold", field: "commercial.payment_net_days", op: ">=", value: 30 }), outcomeIfViolated: "review_required", reviewerRole: "finance", severity: "medium", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "renewal", ruleName: "Renewal notice window at least 60 days", expectation: "notice period >= 60 days", evaluator: JSON.stringify({ type: "threshold", field: "renewal.notice_period_days", op: ">=", value: 60 }), outcomeIfViolated: "review_required", reviewerRole: "business", severity: "medium", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "termination", ruleName: "Termination for convenience available", expectation: "either party may terminate for convenience", evaluator: JSON.stringify({ type: "presence", field: "termination.for_convenience", op: "==", value: true }), outcomeIfViolated: "review_required", reviewerRole: "business", severity: "medium", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "sla", ruleName: "Uptime at least 99.5%", expectation: "uptime commitment >= 99.5% with service credits", evaluator: JSON.stringify({ type: "threshold", field: "sla.uptime_pct", op: ">=", value: 99.5 }), outcomeIfViolated: "review_required", reviewerRole: "business", severity: "low", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "data", ruleName: "Data protection compliance required", expectation: "explicit data protection clause present", evaluator: JSON.stringify({ type: "presence", field: "data.protection", op: "==", value: true }), outcomeIfViolated: "unacceptable", reviewerRole: "privacy", severity: "high", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "security", ruleName: "Breach notification without undue delay", expectation: "security incident notice present", evaluator: JSON.stringify({ type: "presence", field: "security.requirements", op: "==", value: true }), outcomeIfViolated: "review_required", reviewerRole: "security", severity: "medium", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "insurance", ruleName: "Insurance cover at least GBP 1m", expectation: "insurance requirement present", evaluator: JSON.stringify({ type: "presence", field: "insurance.requirement", op: "==", value: true }), outcomeIfViolated: "review_required", reviewerRole: "procurement", severity: "low", active: true },
    { id: id("pbr"), workspaceId: wsId, clauseType: "confidentiality", ruleName: "Confidentiality at least 3 years", expectation: "confidentiality term >= 3 years", evaluator: JSON.stringify({ type: "threshold", field: "confidentiality.years", op: ">=", value: 3 }), outcomeIfViolated: "review_required", reviewerRole: "legal", severity: "low", active: true }
  ];
  await db.insert(tables.playbookRules).values(playbook);

  /* ── Citation factory: locate a quote in seeded text, store citation ── */
  let pageOffsets: { page: number; start: number; end: number }[] = [];
  function pageOf(globalIdx: number): number {
    for (const p of pageOffsets) {
      if (globalIdx >= p.start && globalIdx < p.end) return p.page;
    }
    return pageOffsets[pageOffsets.length - 1]?.page ?? 1;
  }

  async function seedCitation(opts: {
    workspaceId: string; documentVersionId: string; fullText: string;
    quote: string; sectionRef: string; sectionTitle: string;
  }): Promise<{ id: string; page: number; section_ref: string }> {
    const idx = opts.fullText.indexOf(opts.quote);
    if (idx < 0) throw new Error(`seed citation quote not found: ${opts.quote.slice(0, 60)}`);
    const page = pageOf(idx);
    const citId = id("cit");
    await db.insert(tables.citations).values({
      id: citId,
      workspaceId: opts.workspaceId,
      documentVersionId: opts.documentVersionId,
      page,
      sectionRef: opts.sectionRef,
      sectionTitle: opts.sectionTitle,
      charStart: idx,
      charEnd: idx + opts.quote.length,
      quotedText: opts.quote,
      matchConfidence: 1,
      resolvable: true,
      ocrDerived: false
    });
    return { id: citId, page, section_ref: opts.sectionRef };
  }

  const PROMPT = "seed.v1";
  const MODEL = "seed-fixture";

  async function seedField(opts: {
    workspaceId: string; contractId: string; documentVersionId: string;
    key: string; label: string; group: string;
    valueText: string | null; valueNormalized: unknown;
    citation?: { id: string; page: number; section_ref: string } | null;
    status?: string; confidence?: number; searched?: string[];
  }) {
    await db.insert(tables.extractedFields).values({
      id: id("ef"),
      workspaceId: opts.workspaceId,
      contractId: opts.contractId,
      documentVersionId: opts.documentVersionId,
      fieldKey: opts.key,
      fieldGroup: opts.group,
      label: opts.label,
      valueText: opts.valueText,
      valueNormalized: opts.valueNormalized === null ? null : JSON.stringify(opts.valueNormalized),
      extractionKind: "factual",
      confidence: opts.confidence ?? (opts.valueText ? 0.93 : 0),
      validationStatus: (opts.status ?? "unreviewed") as "unreviewed",
      primaryCitationId: opts.citation?.id ?? null,
      searchedSections: opts.searched ?? null,
      modelVersion: MODEL,
      promptVersion: PROMPT
    });
  }

  async function seedDocument(opts: {
    workspaceId: string; contractId: string; versionNumber: number;
    filename: string; text: string; uploadedBy: string; status?: string;
  }): Promise<string> {
    const dvId = id("dv");
    const bytes = Buffer.from(opts.text, "utf8");
    const storageKey = `w/${opts.workspaceId}/c/${opts.contractId}/v/${dvId}/original.pdf`;
    await storage.put(storageKey, bytes);

    // Split into pages of ~2400 chars on paragraph boundaries.
    const pageLen = 2400;
    const pages: string[] = [];
    let rest = opts.text;
    while (rest.length > 0) {
      if (rest.length <= pageLen) { pages.push(rest); break; }
      let cut = rest.lastIndexOf("\n", pageLen);
      if (cut < pageLen * 0.5) cut = pageLen;
      pages.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }

    let offset = 0;
    pageOffsets = pages.map((t, i) => {
      const start = offset;
      offset += t.length;
      return { page: i + 1, start, end: offset };
    });

    const normalizedKey = `w/${opts.workspaceId}/c/${opts.contractId}/v/${dvId}/normalized.txt`;
    await db.insert(tables.documentVersions).values({
      id: dvId,
      workspaceId: opts.workspaceId,
      contractId: opts.contractId,
      versionLabel: `v${opts.versionNumber}`,
      versionNumber: opts.versionNumber,
      filename: opts.filename,
      mimeType: "application/pdf",
      byteSize: bytes.length,
      sha256: sha256Hex(bytes),
      pageCount: pages.length,
      language: "en",
      storageKey,
      normalizedKey,
      hasOcrPages: false,
      status: (opts.status ?? "ready") as "ready",
      uploadedBy: opts.uploadedBy
    });
    await storage.put(normalizedKey, bytes);

    for (let i = 0; i < pages.length; i++) {
      await db.insert(tables.parsedPages).values({
        id: id("pp"),
        workspaceId: opts.workspaceId,
        documentVersionId: dvId,
        pageNumber: i + 1,
        charStart: pageOffsets[i].start,
        charEnd: pageOffsets[i].end,
        text: pages[i],
        ocrDerived: false
      });
    }
    return dvId;
  }

  async function seedClausesFromHeadings(workspaceId: string, documentVersionId: string, fullText: string) {
    const headings: { start: number; ref: string; title: string; depth: number }[] = [];
    const re = /(?:^|\n)((?:[0-9]+(?:\.[0-9]+)*)\.?\s+)([^\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      const num = m[1].trim().replace(/\.$/, "");
      if (!/^[0-9]+(\.[0-9]+)*$/.test(num)) continue;
      headings.push({
        start: m.index + (m[0].startsWith("\n") ? 1 : 0),
        ref: num,
        title: m[2].trim().slice(0, 100),
        depth: num.split(".").length
      });
    }
    const rows: (typeof tables.clauses.$inferInsert)[] = [];
    const mk = (ref: string | null, title: string | null, depth: number, start: number, end: number, type: string | null) => {
      const text = fullText.slice(start, end);
      if (!text.trim()) return;
      rows.push({
        id: id("cl"), workspaceId, documentVersionId,
        sectionRef: ref, sectionTitle: title, depth, parentClauseId: null,
        pageStart: pageOf(start), pageEnd: pageOf(Math.max(start, end - 1)),
        charStart: start, charEnd: end, clauseType: type, text
      });
    };
    if (headings[0]?.start > 0) mk(null, "Preamble", 1, 0, headings[0].start, null);
    for (let i = 0; i < headings.length; i++) {
      const end = i + 1 < headings.length ? headings[i + 1].start : fullText.length;
      mk(headings[i].ref, headings[i].title, headings[i].depth, headings[i].start, end, null);
    }
    if (rows.length > 0) await db.insert(tables.clauses).values(rows);
    return rows;
  }

  function clauseTypeOf(title: string | null): string | null {
    if (!title) return null;
    const t = title.toLowerCase();
    if (t.includes("termin") || t.includes("renewal")) return "termination";
    if (t.includes("liabilit")) return "liability";
    if (t.includes("indemn")) return "indemnity";
    if (t.includes("payment") || t.includes("fees")) return "payment";
    if (t.includes("data")) return "data";
    if (t.includes("secur")) return "security";
    if (t.includes("insur")) return "insurance";
    if (t.includes("service level") || t.includes("services and service")) return "sla";
    if (t.includes("confidential")) return "confidentiality";
    return null;
  }

  /* ══ Contract A — Northwind MSA ═══════════════════════════════════ */
  const northwindId = id("ct");
  await db.insert(tables.contracts).values({
    id: northwindId,
    workspaceId: wsId,
    title: "Northwind Systems Ltd. — Master Services Agreement",
    contractType: "msa",
    counterpartyName: VENDOR,
    ownerUserId: priyaId,
    status: "in_review",
    currency: "USD",
    totalValueMinor: 12000000
  });

  // v2 (base)
  const v2Text = msaText(2);
  /** Mirror of the embed stage's chunking so seeded contracts have Q&A evidence
   *  immediately (runEmbed only runs in the worker on fresh uploads). */
  async function seedChunks(dvId: string) {
    const dv = (await db.select().from(tables.documentVersions)
      .where(eq(tables.documentVersions.id, dvId)).limit(1))[0];
    if (!dv) return;
    const pages = await db.select().from(tables.parsedPages)
      .where(eq(tables.parsedPages.documentVersionId, dvId)).orderBy(tables.parsedPages.pageNumber);
    const cls = await db.select().from(tables.clauses)
      .where(eq(tables.clauses.documentVersionId, dvId)).orderBy(tables.clauses.charStart);
    if (pages.length === 0 || cls.length === 0) return;
    const pageOf = (idx: number) => {
      for (const p of pages) if (idx >= p.charStart && idx < p.charEnd) return p.pageNumber;
      return pages[pages.length - 1]?.pageNumber ?? 1;
    };
    const TARGET = 800;
    const OVERLAP = 120;
    const rows: (typeof tables.chunks.$inferInsert)[] = [];
    let seq = 0;
    for (const clause of cls) {
      const words = clause.text.split(/\s+/).filter(Boolean);
      let start = 0;
      while (start < words.length) {
        const end = Math.min(start + TARGET, words.length);
        const sliceText = words.slice(start, end).join(" ");
        const relStart = clause.text.indexOf(words[start]);
        const charStart = clause.charStart + (relStart >= 0 ? relStart : 0);
        const charEnd = Math.min(charStart + sliceText.length, clause.charEnd);
        rows.push({
          id: id("chk"),
          workspaceId: wsId,
          contractId: dv.contractId,
          documentVersionId: dvId,
          clauseId: clause.id,
          seq: seq++,
          pageStart: pageOf(charStart),
          pageEnd: pageOf(Math.max(charStart, charEnd - 1)),
          charStart,
          charEnd,
          sectionRef: clause.sectionRef,
          ocrDerived: pages.some((p) => p.ocrDerived && charStart >= p.charStart && charStart < p.charEnd),
          tokenCount: end - start,
          text: sliceText,
          embedding: null
        });
        if (end >= words.length) break;
        start = end - OVERLAP;
      }
    }
    if (rows.length === 0) return;
    const emb = embeddings();
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      const vectors = await emb.embed(batch.map((r) => r.text as string));
      batch.forEach((r, j) => { r.embedding = vectors[j]; });
    }
    await db.delete(tables.chunks).where(eq(tables.chunks.documentVersionId, dvId));
    await db.insert(tables.chunks).values(rows);
    console.log(`→ seeded ${rows.length} chunks (embeddings via ${emb.provider}) for dv ${dvId}`);
  }

  const v2Id = await seedDocument({
    workspaceId: wsId, contractId: northwindId, versionNumber: 2,
    filename: "Northwind_MSA_v2.pdf", text: v2Text, uploadedBy: miraId
  });
  await seedClausesFromHeadings(wsId, v2Id, v2Text);
  await seedChunks(v2Id);

  // v3 (vendor's revision) — current
  const v3Text = msaText(3);
  const v3Id = await seedDocument({
    workspaceId: wsId, contractId: northwindId, versionNumber: 3,
    filename: "Northwind_MSA_v3.pdf", text: v3Text, uploadedBy: miraId
  });
  await seedClausesFromHeadings(wsId, v3Id, v3Text);
  await seedChunks(v3Id);

  await db.update(tables.contracts).set({
    currentVersionId: v3Id,
    effectiveDate: "2025-12-01",
    expirationDate: "2026-11-30",
    renewalNoticeBy: "2026-10-01",
    updatedAt: new Date()
  }).where(drizzle.eq(tables.contracts.id, northwindId));

  /* ── Extracted fields (v3, current) ───────────────────────────────── */
  const citVendor = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: `${VENDOR}, a company registered in England and Wales`, sectionRef: "Preamble", sectionTitle: "Preamble" });
  const citCustomer = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: `${CUSTOMER}, a company registered in England and Wales`, sectionRef: "Preamble", sectionTitle: "Preamble" });
  const citExpiration = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "expiring on 30 November 2026 (the \"Term\")", sectionRef: "2.1", sectionTitle: "TERM" });
  const citNotice = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "written notice of non-renewal at least ninety (90) days before the end of the then-current Term", sectionRef: "9.2", sectionTitle: "TERMINATION AND RENEWAL" });
  const citValue = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "The annual fee is USD 120,000 per year, billed quarterly in advance", sectionRef: "5.1", sectionTitle: "FEES AND PAYMENT" });
  const citPayment = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "Invoices are payable Net fifteen (15) from invoice date", sectionRef: "5.1", sectionTitle: "FEES AND PAYMENT" });
  const citCap = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "aggregate liability under this Agreement shall not exceed the fees paid in the preceding three (3) months", sectionRef: "11.3", sectionTitle: "LIMITATION OF LIABILITY" });
  const citIndemnity = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "This indemnity is not subject to the cap in clause 11.3 and is uncapped in amount", sectionRef: "12.1", sectionTitle: "INDEMNITY" });
  const citUptime = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "monthly uptime of ninety-nine point five percent (99.5%)", sectionRef: "3.2", sectionTitle: "SERVICES AND SERVICE LEVELS" });
  const citLaw = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "governed by the laws of England and Wales, and the courts of England and Wales have exclusive jurisdiction", sectionRef: "15.1", sectionTitle: "GENERAL" });
  const citCommencement = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "\"Commencement Date\" means the date on which the Vendor first makes the Services available to the Customer", sectionRef: "1.2", sectionTitle: "DEFINITIONS" });
  const citCommencement2 = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "The Commencement Date for scheduling purposes is the signature date of this Agreement", sectionRef: "Schedule 1", sectionTitle: "Schedule 1" });
  const citTermination = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "The Customer may terminate for convenience on ninety (90) days written notice", sectionRef: "9.3", sectionTitle: "TERMINATION AND RENEWAL" });
  const citCure = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "material breach not cured within thirty (30) days of written notice", sectionRef: "9.1", sectionTitle: "TERMINATION AND RENEWAL" });
  const citInsurance = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "professional indemnity insurance of at least GBP 2,000,000", sectionRef: "13.1", sectionTitle: "INSURANCE" });
  const citData = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "Each party shall comply with applicable UK data protection legislation", sectionRef: "6.1", sectionTitle: "DATA PROTECTION" });
  const citSecurity = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "maintain information security controls consistent with ISO 27001", sectionRef: "8.1", sectionTitle: "SECURITY" });
  const citConf = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "keep the other party's confidential information secret for five (5) years", sectionRef: "10.1", sectionTitle: "CONFIDENTIALITY" });
  const citReport = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "deliver a monthly uptime report by the 5th day of each month", sectionRef: "7.1", sectionTitle: "REPORTING" });
  const citAutoRenew = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: "renews automatically for successive twelve (12) month terms", sectionRef: "2.2", sectionTitle: "TERM" });

  const fields: Parameters<typeof seedField>[0][] = [
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "parties.vendor", label: "Vendor", group: "parties", valueText: VENDOR, valueNormalized: { text: VENDOR }, citation: citVendor, confidence: 0.97 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "parties.customer", label: "Customer", group: "parties", valueText: CUSTOMER, valueNormalized: { text: CUSTOMER }, citation: citCustomer, confidence: 0.97 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "dates.expiration", label: "Expiration", group: "dates", valueText: "30 November 2026", valueNormalized: { date: "2026-11-30" }, citation: citExpiration, confidence: 0.95 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "dates.effective", label: "Effective date", group: "dates", valueText: "1 December 2025", valueNormalized: { date: "2025-12-01" }, citation: citExpiration, confidence: 0.93 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "dates.commencement", label: "Commencement date", group: "dates", valueText: "Defined inconsistently — see open question", valueNormalized: null, citation: citCommencement, status: "conflicting", confidence: 0.55 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "dates.auto_renewal", label: "Auto-renewal", group: "dates", valueText: "Renews automatically for successive 12-month terms", valueNormalized: { renews: true, term_months: 12 }, citation: citAutoRenew, confidence: 0.94 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "renewal.notice_period_days", label: "Notice period", group: "term", valueText: "ninety (90) days", valueNormalized: { days: 90 }, citation: citNotice, confidence: 0.94 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "commercial.currency", label: "Currency", group: "commercial", valueText: "USD", valueNormalized: { currency: "USD" }, citation: citValue, confidence: 0.96 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "commercial.total_value", label: "Annual value", group: "commercial", valueText: "USD 120,000 per year", valueNormalized: { amount: 120000, currency: "USD" }, citation: citValue, confidence: 0.96 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "commercial.payment_cadence", label: "Payment cadence", group: "commercial", valueText: "Billed quarterly in advance", valueNormalized: { cadence: "quarterly" }, citation: citValue, confidence: 0.93 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "commercial.payment_terms", label: "Payment terms", group: "commercial", valueText: "Net fifteen (15)", valueNormalized: { net_days: 15 }, citation: citPayment, confidence: 0.9 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "commercial.late_fee", label: "Late payment interest", group: "commercial", valueText: null, valueNormalized: null, status: "not_found", searched: ["5", "9", "Schedule 2"] },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "liability.cap", label: "Liability cap", group: "liability", valueText: "fees paid in the preceding three (3) months", valueNormalized: { cap_months: 3, basis: "fees paid" }, citation: citCap, confidence: 0.93 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "liability.indemnity", label: "Indemnity", group: "liability", valueText: "Customer indemnifies Vendor; not subject to the cap in clause 11.3", valueNormalized: { capped: false }, citation: citIndemnity, confidence: 0.92 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "sla.uptime", label: "Service level", group: "sla", valueText: "99.5% monthly uptime with service credits", valueNormalized: { uptime_pct: 99.5 }, citation: citUptime, confidence: 0.92 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "termination.for_convenience", label: "Termination for convenience", group: "term", valueText: "Customer may terminate for convenience on 90 days written notice", valueNormalized: { allowed: true, notice_days: 90 }, citation: citTermination, confidence: 0.9 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "termination.cure_period_days", label: "Cure period", group: "term", valueText: "thirty (30) days", valueNormalized: { days: 30 }, citation: citCure, confidence: 0.93 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "confidentiality.term", label: "Confidentiality", group: "other", valueText: "five (5) years after termination", valueNormalized: { years: 5 }, citation: citConf, confidence: 0.93 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "ip.ownership", label: "IP ownership", group: "other", valueText: null, valueNormalized: null, status: "not_found", searched: ["1", "3", "15"] },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "data.protection", label: "Data protection", group: "data", valueText: "Each party complies with applicable UK data protection legislation", valueNormalized: { present: true }, citation: citData, confidence: 0.9 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "security.requirements", label: "Security", group: "data", valueText: "ISO 27001-aligned controls; breach notification without undue delay", valueNormalized: { present: true }, citation: citSecurity, confidence: 0.91 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "insurance.requirement", label: "Insurance", group: "liability", valueText: "Professional indemnity insurance of at least GBP 2,000,000", valueNormalized: { amount: 2000000, currency: "GBP" }, citation: citInsurance, confidence: 0.92 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "law.governing_law", label: "Governing law", group: "other", valueText: "England and Wales", valueNormalized: { jurisdiction: "England and Wales" }, citation: citLaw, confidence: 0.95 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "type.contract_type", label: "Contract type", group: "other", valueText: "Master Services Agreement", valueNormalized: { type: "msa" }, citation: citVendor, confidence: 0.95 },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "audit.rights", label: "Audit rights", group: "other", valueText: null, valueNormalized: null, status: "not_found", searched: ["8", "15"] },
    { workspaceId: wsId, contractId: northwindId, documentVersionId: v3Id, key: "assignment.rights", label: "Assignment", group: "other", valueText: "Neither party may assign without prior written consent", valueNormalized: { consent_required: true }, citation: citLaw, confidence: 0.88, status: "unreviewed" }
  ];
  for (const f of fields) await seedField(f);

  // One seeded correction (Mira corrected payment terms from the earlier draft)
  const paymentField = (await db.select().from(tables.extractedFields).where(
    drizzle.and(drizzle.eq(tables.extractedFields.documentVersionId, v3Id), drizzle.eq(tables.extractedFields.fieldKey, "commercial.payment_terms"))
  ).limit(1))[0];
  await db.insert(tables.fieldCorrections).values({
    id: id("fc"),
    workspaceId: wsId,
    extractedFieldId: paymentField.id,
    previousValue: "Net thirty (30)",
    previousNormalized: JSON.stringify({ net_days: 30 }),
    newValue: "Net fifteen (15)",
    newNormalized: JSON.stringify({ net_days: 15 }),
    reason: "v3 changed payment terms from Net 30 to Net 15",
    correctedBy: miraId
  });
  await db.update(tables.extractedFields).set({ validationStatus: "corrected" }).where(drizzle.eq(tables.extractedFields.id, paymentField.id));

  /* ── Obligations with code-computed dates (doc 09 §2.1) ───────────── */
  async function seedObligation(opts: {
    title: string; description: string; obligor: string; obligee: string;
    rule: Parameters<typeof computeDueDate>[0]; anchors: Record<string, string | null>;
    priority: string; citation: { id: string; page: number; section_ref: string };
    status?: string; confidence: number; derivedFrom?: string[];
    recurrence?: string;
  }): Promise<string> {
    const computed = computeDueDate(opts.rule, opts.anchors);
    const obId = id("ob");
    await db.insert(tables.obligations).values({
      id: obId,
      workspaceId: wsId,
      contractId: northwindId,
      sourceVersionId: v3Id,
      title: opts.title,
      description: opts.description,
      obligor: opts.obligor,
      obligee: opts.obligee,
      dueRule: opts.rule.anchor === "absolute" && opts.rule.recurrence ? "recurring" : opts.rule.anchor?.startsWith("event:") ? "event_triggered" : opts.rule.anchor === "absolute" ? "fixed" : "relative",
      dueRuleDetail: JSON.stringify({
        anchor: opts.rule.anchor, anchor_value: opts.rule.anchorValue ?? null,
        offset_days: opts.rule.offsetDays ?? null, calendar: opts.rule.calendar ?? "calendar",
        recurrence: opts.rule.recurrence ?? null
      }),
      dueDate: computed.needsAssumption ? null : computed.dueDate,
      dueDateMath: computed.math,
      recurrenceRrule: opts.rule.recurrence ?? null,
      priority: opts.priority,
      status: (opts.status ?? "suggested") as "suggested",
      citationId: opts.citation.id,
      confidence: opts.confidence,
      derivedFromFieldIds: opts.derivedFrom ?? []
    });
    return obId;
  }

  const expirationField = (await db.select().from(tables.extractedFields).where(
    drizzle.and(drizzle.eq(tables.extractedFields.documentVersionId, v3Id), drizzle.eq(tables.extractedFields.fieldKey, "dates.expiration"))
  ).limit(1))[0];
  const noticeField = (await db.select().from(tables.extractedFields).where(
    drizzle.and(drizzle.eq(tables.extractedFields.documentVersionId, v3Id), drizzle.eq(tables.extractedFields.fieldKey, "renewal.notice_period_days"))
  ).limit(1))[0];

  const renewalObId = await seedObligation({
    title: "Give notice of non-renewal",
    description: "Either party must give written notice of non-renewal before the initial term ends.",
    obligor: "our_entity", obligee: VENDOR,
    rule: { anchor: "expiration_date", offsetDays: -90, calendar: "calendar" },
    anchors: { expiration_date: "2026-11-30" },
    priority: "critical",
    citation: citNotice,
    confidence: 0.94,
    derivedFrom: [expirationField.id, noticeField.id]
  });

  const reportObId = await seedObligation({
    title: "Vendor delivers monthly uptime report",
    description: "Vendor shall deliver a monthly uptime report by the 5th day of each month.",
    obligor: VENDOR, obligee: "our_entity",
    rule: { anchor: "absolute", anchorValue: null, offsetDays: 0, calendar: "calendar", recurrence: "FREQ=MONTHLY;BYMONTHDAY=5" },
    anchors: {},
    priority: "medium",
    citation: citReport,
    confidence: 0.9,
    recurrence: "FREQ=MONTHLY;BYMONTHDAY=5"
  });

  const invoiceObId = await seedObligation({
    title: "Pay quarterly invoice",
    description: "Customer pays the quarterly invoice Net 15 from invoice date.",
    obligor: "our_entity", obligee: VENDOR,
    rule: { anchor: "invoice_date", offsetDays: 15, calendar: "calendar" },
    anchors: { invoice_date: null },
    priority: "high",
    citation: citPayment,
    confidence: 0.88,
    derivedFrom: [paymentField.id]
  });

  await seedObligation({
    title: "Vendor completes annual security review",
    description: "Vendor shall complete an annual security review within 30 days of each anniversary of the Commencement Date.",
    obligor: VENDOR, obligee: "our_entity",
    rule: { anchor: "commencement_date", offsetDays: 30, calendar: "calendar" },
    anchors: { commencement_date: null },
    priority: "medium",
    citation: citCommencement,
    status: "needs_assumption",
    confidence: 0.72
  });

  await seedObligation({
    title: "Vendor provides insurance certificates",
    description: "Vendor shall provide certificates of insurance within fifteen (15) days of the Commencement Date.",
    obligor: VENDOR, obligee: "our_entity",
    rule: { anchor: "commencement_date", offsetDays: 15, calendar: "calendar" },
    anchors: { commencement_date: "2025-12-01" },
    priority: "medium",
    citation: citInsurance,
    confidence: 0.87
  });

  // Accept the renewal obligation (demo shows active + scheduled alerts).
  await db.update(tables.obligations).set({
    status: "active", ownerUserId: priyaId
  }).where(drizzle.eq(tables.obligations.id, renewalObId));
  await db.insert(tables.obligationEvents).values({
    id: id("oe"), workspaceId: wsId, obligationId: renewalObId,
    eventType: "accepted", actorUserId: priyaId, payload: JSON.stringify({ seeded: true })
  });

  // Schedule alerts via the real scheduler logic.
  const { scheduleAlertsFor } = await import("../src/lib/alerts");
  const scheduled = await scheduleAlertsFor({
    id: renewalObId, workspaceId: wsId, dueDate: "2026-10-01",
    ownerUserId: priyaId, priority: "critical", gracePeriodDays: 0
  }, "in_app", "Europe/London");
  console.log(`→ renewal obligation active; ${scheduled} alerts scheduled`);

  /* ── Risk flags (playbook-linked) ─────────────────────────────────── */
  await db.insert(tables.riskFlags).values({
    id: id("rf"),
    workspaceId: wsId,
    contractId: northwindId,
    documentVersionId: v3Id,
    playbookRuleId: indemnityRuleId,
    category: "legal",
    flagType: "uncapped_liability",
    title: "Indemnity is uncapped",
    explanation: "Clause 12.1 requires the Customer to indemnify the Vendor without a monetary limit, and expressly places the indemnity outside the cap in clause 11.3.",
    expectedText: "Indemnity subject to the general liability cap",
    foundText: "This indemnity is not subject to the cap in clause 11.3 and is uncapped in amount",
    severity: "high",
    confidence: 0.88,
    recommendedStep: "Ask whether an aggregate cap on indemnity is acceptable before approval.",
    suggestedReviewerRole: "legal",
    citationId: citIndemnity.id,
    status: "open"
  });
  await db.insert(tables.riskFlags).values({
    id: id("rf"),
    workspaceId: wsId,
    contractId: northwindId,
    documentVersionId: v3Id,
    playbookRuleId: playbook[2].id,
    category: "finance",
    flagType: "non_standard",
    title: "Payment terms tighten from Net 30 to Net 15",
    explanation: "The revised draft shortens payment terms from Net 30 to Net 15, which affects cash flow against the workspace standard of Net 30 or longer.",
    expectedText: "payment terms >= Net 30",
    foundText: "Invoices are payable Net fifteen (15) from invoice date",
    severity: "medium",
    confidence: 0.85,
    recommendedStep: "Confirm whether Net 15 is operationally acceptable before approval.",
    suggestedReviewerRole: "finance",
    citationId: citPayment.id,
    status: "open"
  });

  /* ── Interpretation + open questions (brief agent output, seeded) ─── */
  await storage.put(
    `w/${wsId}/c/${northwindId}/v/${v3Id}/brief.json`,
    Buffer.from(JSON.stringify({
      interpretation: [
        {
          text: `The agreement renews automatically for successive 12-month terms unless either party gives notice at least 90 days before expiry — so the decision date is 1 October 2026.`,
          field_ids: [noticeField.id, expirationField.id],
          self_confidence: 0.9
        },
        {
          text: "The vendor's liability cap covers three months of fees, while the customer's indemnity sits outside the cap entirely.",
          field_ids: [paymentField.id],
          self_confidence: 0.86
        }
      ],
      open_questions: [
        {
          question: "Commencement Date is defined in §1.2 as the date services first become available, but Schedule 1 says it is the signature date. Which governs the insurance-certificate and security-review deadlines?",
          field_ids: []
        }
      ],
      suspicious_content: false
    }), "utf8")
  );

  /* ── Comparison v2 → v3 (seeded artifact) ─────────────────────────── */
  const cmpId = id("cmp");
  await db.insert(tables.comparisons).values({
    id: cmpId, workspaceId: wsId, contractId: northwindId,
    baseVersionId: v2Id, targetVersionId: v3Id, status: "ready",
    materialCount: 3, cosmeticCount: 11, createdBy: miraId
  });
  const changes = [
    {
      type: "modified", cat: "liability", material: true, ref: "11.3",
      before: "aggregate liability under this Agreement shall not exceed the fees paid in the preceding twelve (12) months",
      after: "aggregate liability under this Agreement shall not exceed the fees paid in the preceding three (3) months",
      impact: "The vendor's liability cap falls from 12 months of fees to 3 months, reducing recoverable damages by roughly 75%.",
      delta: "increased", role: "legal"
    },
    {
      type: "modified", cat: "renewal", material: true, ref: "9.2",
      before: "written notice of non-renewal at least sixty (60) days before the end of the then-current Term",
      after: "written notice of non-renewal at least ninety (90) days before the end of the then-current Term",
      impact: "The notice period extends from 60 to 90 days, moving the cancellation decision 30 days earlier.",
      delta: "increased", role: "legal"
    },
    {
      type: "modified", cat: "money", material: true, ref: "5.1",
      before: "Invoices are payable Net thirty (30) from invoice date",
      after: "Invoices are payable Net fifteen (15) from invoice date",
      impact: "Payment terms tighten from Net 30 to Net 15, a cash-flow impact for Harbourline.",
      delta: "increased", role: "finance"
    }
  ];
  for (const ch of changes) {
    const baseCit = await seedCitation({ workspaceId: wsId, documentVersionId: v2Id, fullText: v2Text, quote: ch.before, sectionRef: ch.ref, sectionTitle: ch.ref });
    const targetCit = await seedCitation({ workspaceId: wsId, documentVersionId: v3Id, fullText: v3Text, quote: ch.after, sectionRef: ch.ref, sectionTitle: ch.ref });
    await db.insert(tables.comparisonChanges).values({
      id: id("chg"), workspaceId: wsId, comparisonId: cmpId,
      changeType: ch.type, impactCategory: ch.cat, isMaterial: ch.material,
      clauseRef: ch.ref, beforeText: ch.before, afterText: ch.after,
      businessImpact: ch.impact, riskDelta: ch.delta, suggestedReviewerRole: ch.role,
      baseCitationId: baseCit.id, targetCitationId: targetCit.id, confidence: 0.95
    });
  }

  /* ══ Supporting contract 1 — cleaning agreement ═══════════════════ */
  const cleaningId = id("ct");
  await db.insert(tables.contracts).values({
    id: cleaningId, workspaceId: wsId,
    title: "Ravenscourt Cleaning Services Agreement",
    contractType: "other", counterpartyName: "Ravenscourt Facilities Ltd",
    ownerUserId: priyaId, status: "active", currency: "GBP", totalValueMinor: 4080000
  });
  const cleanDv = await seedDocument({
    workspaceId: wsId, contractId: cleaningId, versionNumber: 1,
    filename: "Ravenscourt_Cleaning_Agreement.pdf", text: CLEANING_TEXT, uploadedBy: priyaId
  });
  await seedClausesFromHeadings(wsId, cleanDv, CLEANING_TEXT);
  await seedChunks(cleanDv);
  const cleanTermCit = await seedCitation({ workspaceId: wsId, documentVersionId: cleanDv, fullText: CLEANING_TEXT, quote: "Either party may terminate on thirty (30) days written notice", sectionRef: "3", sectionTitle: "Termination" });
  await seedField({ workspaceId: wsId, contractId: cleaningId, documentVersionId: cleanDv, key: "parties.vendor", label: "Vendor", group: "parties", valueText: "Ravenscourt Facilities Ltd", valueNormalized: { text: "Ravenscourt Facilities Ltd" }, citation: cleanTermCit });
  await seedField({ workspaceId: wsId, contractId: cleaningId, documentVersionId: cleanDv, key: "commercial.total_value", label: "Annual value", group: "commercial", valueText: "GBP 3,400 per month", valueNormalized: { amount: 3400, currency: "GBP" }, citation: cleanTermCit });
  await db.update(tables.contracts).set({ currentVersionId: cleanDv }).where(drizzle.eq(tables.contracts.id, cleaningId));

  /* ══ Supporting contract 2 — NDA ══════════════════════════════════ */
  const ndaId = id("ct");
  await db.insert(tables.contracts).values({
    id: ndaId, workspaceId: wsId,
    title: "Helix Software — Mutual NDA",
    contractType: "nda", counterpartyName: "Helix Software Ltd",
    ownerUserId: priyaId, status: "in_review"
  });
  const ndaDv = await seedDocument({
    workspaceId: wsId, contractId: ndaId, versionNumber: 1,
    filename: "Helix_Mutual_NDA.pdf", text: NDA_TEXT, uploadedBy: miraId
  });
  await seedClausesFromHeadings(wsId, ndaDv, NDA_TEXT);
  await seedChunks(ndaDv);
  const ndaCit = await seedCitation({ workspaceId: wsId, documentVersionId: ndaDv, fullText: NDA_TEXT, quote: "protected with reasonable care for three (3) years from disclosure", sectionRef: "2", sectionTitle: "Confidentiality" });
  await seedField({ workspaceId: wsId, contractId: ndaId, documentVersionId: ndaDv, key: "confidentiality.term", label: "Confidentiality", group: "other", valueText: "three (3) years from disclosure", valueNormalized: { years: 3 }, citation: ndaCit });
  await db.update(tables.contracts).set({ currentVersionId: ndaDv }).where(drizzle.eq(tables.contracts.id, ndaId));

  /* ── Audit trail for the seeded actions ──────────────────────────── */
  for (const [resourceType, resourceId, action] of [
    ["workspace", wsId, "workspace.create"],
    ["contract", northwindId, "contract.create"],
    ["document_version", v2Id, "document.upload"],
    ["document_version", v3Id, "document.upload"],
    ["comparison", cmpId, "comparison.create"],
    ["obligation", renewalObId, "obligation.accept"]
  ] as const) {
    await db.insert(tables.auditEvents).values({
      workspaceId: wsId,
      actorUserId: action === "obligation.accept" ? priyaId : miraId,
      actorRole: action === "obligation.accept" ? "contract_owner" : "legal_reviewer",
      action, resourceType, resourceId, metadata: JSON.stringify({ seeded: true })
    });
  }

  const counts = await db.execute<{ contracts: number; fields: number; obligations: number; flags: number; citations: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM contracts) AS contracts,
      (SELECT count(*)::int FROM extracted_fields) AS fields,
      (SELECT count(*)::int FROM obligations) AS obligations,
      (SELECT count(*)::int FROM risk_flags) AS flags,
      (SELECT count(*)::int FROM citations) AS citations
  `);
  const c = counts.rows[0];
  console.log(`→ seed complete: ${c.contracts} contracts, ${c.fields} fields, ${c.obligations} obligations, ${c.flags} risk flags, ${c.citations} citations`);
  console.log("→ sign in at /signin with priya@harbourline.example (magic link prints to the server console)");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
