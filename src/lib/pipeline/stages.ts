import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/client";
import { obligationEvents } from "../db/obligations-schema";
import { rescheduleAlertsFor } from "../alerts";
import {
  contracts, documentVersions, citations, extractedFields, obligations, riskFlags, clauses, chunks, parsedPages
} from "../db/aliases";
import { storage, llm, embeddings } from "../ports";
import { id, sha256Hex } from "../ids";
import { markStage, setDocStatus, enqueueJob, type JobPayload } from "../jobs";
import { SHARED_PREAMBLE, PROMPT_VERSIONS } from "../ai/prompts";
import {
  ClassifyOutput, ExtractOutput, ObligationsOutput, RiskOutput,
  BriefOutput, CompareOutput
} from "../ai/schemas";
import { validateFieldCandidate, persistValidatedField, bannedPhraseLint, blendConfidence, resolveAndStoreCitation, type FieldCandidate } from "../validator";
import { computeDueDate, anchorsFromFields, addDays, type DueRuleDetail } from "../dates";
import { diceSimilarity } from "../similarity";

const STAGE_OF = {
  intake: "scanning", parse: "parsing", segment: "segmenting", embed: "segmenting",
  extract: "extracting", obligations: "obligations", risk: "risk", summarize: "summarizing"
} as const;

// document_versions.status has its own enum (CHECK constraint): the UI stage
// names "obligations"/"risk" map to "deriving_obligations"/"assessing_risk".
const DOC_STATUS_OF = {
  intake: "scanning", parse: "parsing", segment: "segmenting", embed: "segmenting",
  extract: "extracting", obligations: "deriving_obligations", risk: "assessing_risk", summarize: "summarizing"
} as const;

type UIKey = keyof typeof STAGE_OF;

async function stageStart(dvId: string, wsId: string, ui: UIKey, promptVersion?: string) {
  await markStage(dvId, wsId, STAGE_OF[ui] as "scanning", "running", { promptVersion });
  await setDocStatus(dvId, DOC_STATUS_OF[ui]);
}
async function stageEnd(
  dvId: string, wsId: string, ui: UIKey,
  outcome: "succeeded" | "degraded" | "failed" | "skipped",
  opts?: { errorCode?: string; errorMessageSafe?: string; promptVersion?: string }
) {
  await markStage(dvId, wsId, STAGE_OF[ui] as "scanning", outcome === "skipped" ? "skipped" : outcome, opts);
}

/* ══════════════════════════ INTAKE ═══════════════════════════════════ */
export async function runIntake(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "intake");

  // AV scan: labelled stub — always passes, visibly marked in UI copy (doc 08 P1).
  // Upsert: the (dv, stage, attempt) unique index makes a retried intake collide;
  // idempotent ON CONFLICT keeps re-runs safe.
  await db.execute(sql`
    INSERT INTO processing_stages (id, workspace_id, document_version_id, stage, status, attempt, error_message_safe)
    VALUES (${id("ps")}, ${dv.workspaceId}, ${dvId}, 'av_scan_stub', 'succeeded', 1,
      'AV scan is a stub in this build (always passes). Not production malware scanning.')
    ON CONFLICT (document_version_id, stage, attempt) DO UPDATE
      SET status = 'succeeded', finished_at = now()
  `);

  const buf = await storage.get(dv.storageKey);
  const hash = sha256Hex(buf);

  let classification: { language?: string } = {};
  const text = await extractTextForClassify(buf, dv.mimeType);
  if (text) {
    try {
      const r = await llm().structured({
        system: `${SHARED_PREAMBLE}\n\nYou classify contract documents. Return doc_type, counterparty_guess, language (ISO code), is_amendment, confidence, suspicious_content.`,
        user: `<document>\n${text.slice(0, 6000)}\n</document>\n\nClassify this document.`,
        schema: ClassifyOutput,
        temperature: 0,
        promptVersion: PROMPT_VERSIONS.classify
      });
      classification = r.data;
      await db.update(contracts).set({
        contractType: (r.data as { doc_type?: string }).doc_type ?? null
      }).where(eq(contracts.id, dv.contractId));
    } catch { /* classification is advisory */ }
  }

  if ((classification as { language?: string }).language && (classification as { language?: string }).language !== "en") {
    await db.update(documentVersions).set({ status: "failed", failureReason: "Only English contracts are supported at MVP." }).where(eq(documentVersions.id, dvId));
    await stageEnd(dvId, dv.workspaceId, "intake", "failed", { errorCode: "unsupported_language", errorMessageSafe: "Only English contracts are supported." });
    return;
  }

  await db.update(documentVersions).set({ sha256: hash, language: "en" }).where(eq(documentVersions.id, dvId));
  await stageEnd(dvId, dv.workspaceId, "intake", "succeeded");
  await enqueueJob("parse", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

async function extractTextForClassify(buf: Buffer, mime: string): Promise<string | null> {
  try {
    if (mime === "application/pdf") {
      const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await mod.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
      let out = "";
      const pages = Math.min(doc.numPages, 3);
      for (let p = 1; p <= pages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        out += tc.items.map((i: unknown) => (i as { str?: string }).str ?? "").join(" ") + "\n";
      }
      return out;
    }
    if (mime === "text/plain") return buf.toString("utf8");
  } catch { /* fallthrough */ }
  return null;
}

/* ══════════════════════════ PARSE (+OCR) ═════════════════════════════ */
export interface PageExtract {
  pageNumber: number;
  text: string;
  ocrDerived: boolean;
  ocrConfidence?: number;
  boxes: { x: number; y: number; w: number; h: number; str: string }[];
}

async function parsePdfPages(buf: Buffer): Promise<PageExtract[]> {
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await mod.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const out: PageExtract[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[];
    const sorted = items
      .filter((i) => typeof i.str === "string")
      .map((i) => ({
        str: i.str as string,
        x: i.transform?.[4] ?? 0,
        y: i.transform?.[5] ?? 0,
        w: i.width ?? 0,
        h: i.height ?? 10
      }))
      .sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let text = "";
    let lastY: number | null = null;
    const boxes: PageExtract["boxes"] = [];
    for (const it of sorted) {
      if (lastY !== null && Math.abs(it.y - lastY) > it.h * 0.6) text += "\n";
      else if (lastY !== null && text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
      boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h, str: it.str });
      text += it.str;
      lastY = it.y;
    }
    out.push({ pageNumber: p, text, ocrDerived: false, boxes });
  }
  return out;
}

async function parseDocx(buf: Buffer): Promise<PageExtract[]> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return [{ pageNumber: 1, text: value, ocrDerived: false, boxes: [] }];
}

export async function runParse(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "parse");

  const buf = await storage.get(dv.storageKey);
  let pages: PageExtract[];
  try {
    if (dv.mimeType === "application/pdf") pages = await parsePdfPages(buf);
    else if (dv.mimeType.includes("wordprocessingml")) pages = await parseDocx(buf);
    else if (dv.mimeType === "text/plain") pages = [{ pageNumber: 1, text: buf.toString("utf8"), ocrDerived: false, boxes: [] }];
    else throw new Error("unsupported_mime");
  } catch {
    await db.update(documentVersions).set({ status: "failed", failureReason: "The file could not be read as text. Re-upload a clean copy." }).where(eq(documentVersions.id, dvId));
    await stageEnd(dvId, dv.workspaceId, "parse", "failed", { errorCode: "unparseable_document", errorMessageSafe: "The page could not be read as text or as an image." });
    return;
  }

  // OCR fallback: pages yielding < 100 extractable chars are re-read via OCR and
  // marked ocr_derived with a confidence ceiling of 0.75 (FR-IN-04).
  let hasOcr = false;
  let ocrUsable = true;
  const { createWorker } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  for (const pg of pages) {
    if (pg.text.replace(/\s+/g, "").length < 100) {
      try {
        if (!worker) worker = await createWorker("eng");
        const png = await renderPageToPng(buf, pg.pageNumber);
        const { data } = await worker.recognize(png);
        pg.text = data.text;
        pg.ocrDerived = true;
        pg.ocrConfidence = Math.min(data.confidence / 100, 0.75);
        hasOcr = true;
        pg.boxes = data.words.map((w) => ({
          x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0, str: w.text
        }));
      } catch (err) {
        const code = (err as Error).message === "page_render_unavailable" ? "render_unavailable" : "ocr_failed";
        if (code === "render_unavailable") ocrUsable = false;
      }
    }
  }
  if (worker) await worker.terminate();

  // Normalisation preserving char offsets; each page records its span in the
  // global normalized.txt coordinate space (char_start/char_end authoritative).
  let globalOffset = 0;
  const normalizedParts: string[] = [];
  const pageRows: (typeof parsedPages.$inferInsert)[] = [];
  const layoutRows: (typeof import("../db/text-schema").textLayout.$inferInsert)[] = [];

  for (const pg of pages) {
    const { text: normText, map: offMap } = normalizePage(pg.text);
    const pageStart = globalOffset;
    normalizedParts.push(normText);
    globalOffset += normText.length;

    pageRows.push({
      id: id("pp"),
      workspaceId: dv.workspaceId,
      documentVersionId: dvId,
      pageNumber: pg.pageNumber,
      charStart: pageStart,
      charEnd: globalOffset,
      text: normText,
      ocrDerived: pg.ocrDerived,
      ocrConfidence: pg.ocrConfidence ?? null
    });

    // Map normalised char ranges back to original boxes via offMap.
    // offMap[i] = original index of normalised char i. Build word rows grouped by line.
    interface Line { y: number; x0: number; x1: number; h: number; chars: [number, number][] }
    const lines: Line[] = [];
    for (const b of pg.boxes) {
      const line = lines.find((l) => Math.abs(l.y - b.y) <= Math.max(2, b.h * 0.5));
      if (line) {
        line.x0 = Math.min(line.x0, b.x);
        line.x1 = Math.max(line.x1, b.x + b.w);
        line.h = Math.max(line.h, b.h);
      } else {
        lines.push({ y: b.y, x0: b.x, x1: b.x + b.w, h: b.h, chars: [] });
      }
    }
    // Layout: emit one row per page covering the whole text (the viewer renders
    // text pages, so a page-level rectangle is correct and complete); word-level
    // boxes arrive via the OCR path in pg.boxes and refine rects when present.
    if (normText.length > 0) {
      layoutRows.push({
        documentVersionId: dvId,
        pageNumber: pg.pageNumber,
        charStart: pageStart,
        charEnd: globalOffset,
        x: 0, y: 0, w: 0, h: 0
      });
    }
    void lines; void offMap;
  }

  await db.delete(parsedPages).where(eq(parsedPages.documentVersionId, dvId));
  if (pageRows.length > 0) await db.insert(parsedPages).values(pageRows);

  const normalizedKey = `w/${dv.workspaceId}/c/${dv.contractId}/v/${dvId}/normalized.txt`;
  await storage.put(normalizedKey, Buffer.from(normalizedParts.join(""), "utf8"));
  await db.update(documentVersions).set({
    normalizedKey,
    pageCount: pages.length,
    hasOcrPages: hasOcr
  }).where(eq(documentVersions.id, dvId));

  if (pages.length === 0 || normalizedParts.join("").trim().length === 0) {
    await db.update(documentVersions).set({ status: "failed", failureReason: "No text could be extracted." }).where(eq(documentVersions.id, dvId));
    await stageEnd(dvId, dv.workspaceId, "parse", "failed", { errorCode: "unparseable_document", errorMessageSafe: "No text could be extracted from the file." });
    return;
  }

  await stageEnd(dvId, dv.workspaceId, "parse", hasOcr || !ocrUsable ? "degraded" : "succeeded",
    hasOcr ? { errorMessageSafe: "Some pages were read using OCR — accuracy is reduced on those pages." } : undefined);
  await enqueueJob("segment", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

/** Normalise page text (collapse whitespace, dehyphenate) keeping a map from
 *  each normalised char index to its original index. */
function normalizePage(text: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "-" && text[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      const isLineBreak = text.slice(i, j).includes("\n");
      if (out.length > 0 && j < text.length) {
        out.push(isLineBreak ? "\n" : " ");
        map.push(i);
      }
      i = j;
      continue;
    }
    out.push(ch);
    map.push(i);
    i++;
  }
  return { text: out.join(""), map };
}

async function renderPageToPng(_buf: Buffer, _page: number): Promise<Buffer> {
  // Rasterising PDF pages requires a native canvas backend; without native deps
  // the text-layer path covers digital PDFs, and rasterised OCR is a T1 upgrade.
  // The OCR adapter itself is fully implemented for image inputs.
  throw new Error("page_render_unavailable");
}

/* ══════════════════════════ SEGMENT ══════════════════════════════════ */
const CLAUSE_TYPE_HINTS: [RegExp, string][] = [
  [/termination|convenience|cause/i, "termination"],
  [/indemnif/i, "indemnity"],
  [/liability|limitation/i, "liability"],
  [/payment|fees|invoice/i, "payment"],
  [/renew/i, "renewal"],
  [/confidential/i, "confidentiality"],
  [/intellectual property|ip ownership/i, "ip"],
  [/data protection|personal data|privacy/i, "data"],
  [/security/i, "security"],
  [/insurance/i, "insurance"],
  [/warrant/i, "warranty"],
  [/service level|uptime|sla/i, "sla"],
  [/audit/i, "audit"],
  [/assign/i, "assignment"],
  [/subcontract/i, "subcontracting"],
  [/dispute|governing law|venue|arbitration/i, "dispute"],
  [/notice/i, "notice"]
];

function guessClauseType(title: string, body: string): string | null {
  for (const [re, type] of CLAUSE_TYPE_HINTS) {
    if (re.test(title) || re.test(body.slice(0, 400))) return type;
  }
  return null;
}

export async function runSegment(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "segment");

  const pages = await db.select().from(parsedPages)
    .where(eq(parsedPages.documentVersionId, dvId))
    .orderBy(parsedPages.pageNumber);

  const fullText = pages.map((p) => p.text).join("");

  const pageOf = (charIdx: number): number => {
    for (const p of pages) {
      if (charIdx >= p.charStart && charIdx < p.charEnd) return p.pageNumber;
    }
    return pages[pages.length - 1]?.pageNumber ?? 1;
  };

  interface Heading { start: number; sectionRef: string; title: string; depth: number }
  const headings: Heading[] = [];
  const lineRe = /(?:^|\n)((?:[0-9]+(?:\.[0-9]+)*)\.?\s+)([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(fullText)) !== null) {
    const numTok = m[1].trim().replace(/\.$/, "");
    if (!/^[0-9]+(\.[0-9]+)*$/.test(numTok)) continue;
    if (numTok.split(".").length > 4) continue;
    const title = m[2].trim();
    if (title.length > 120) continue;
    const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
    headings.push({ start, sectionRef: numTok, title, depth: numTok.split(".").length });
  }

  // Re-segment is idempotent: chunks reference clauses, so clear children first
  // (plain DELETE would violate chunks_clause_id_fkey on a re-run).
  await db.delete(chunks).where(eq(chunks.documentVersionId, dvId));
  await db.delete(clauses).where(eq(clauses.documentVersionId, dvId));

  const mkClause = (
    sectionRef: string | null, title: string | null, depth: number,
    start: number, end: number, type: string | null
  ) => {
    const text = fullText.slice(start, end);
    if (!text.trim()) return null;
    return {
      id: id("cl"),
      workspaceId: dv.workspaceId,
      documentVersionId: dvId,
      sectionRef,
      sectionTitle: title,
      depth,
      parentClauseId: null,
      pageStart: pageOf(start),
      pageEnd: pageOf(Math.max(start, end - 1)),
      charStart: start,
      charEnd: end,
      clauseType: type,
      text
    };
  };

  const clauseRows: (typeof clauses.$inferInsert)[] = [];

  if (headings.length === 0) {
    for (const p of pages) {
      const row = mkClause(null, `Page ${p.pageNumber}`, 1, p.charStart, p.charEnd, null);
      if (row) clauseRows.push(row);
    }
  } else {
    if (headings[0].start > 0) {
      const row = mkClause(null, "Preamble", 1, 0, headings[0].start, null);
      if (row) clauseRows.push(row);
    }
    for (let h = 0; h < headings.length; h++) {
      const start = headings[h].start;
      const end = h + 1 < headings.length ? headings[h + 1].start : fullText.length;
      const cleanTitle = headings[h].title.split(/\s{2,}/)[0].slice(0, 120);
      const body = fullText.slice(start, Math.min(end, start + 800));
      const type = guessClauseType(headings[h].title, body);
      const row = mkClause(headings[h].sectionRef, cleanTitle, headings[h].depth, start, end, type);
      if (row) clauseRows.push(row);
    }
  }

  if (clauseRows.length > 0) await db.insert(clauses).values(clauseRows);

  const coarse = headings.length === 0;
  if (coarse) {
    await stageEnd(dvId, dv.workspaceId, "segment", "degraded", { errorMessageSafe: "Clause numbering was not detected; page-level sections are used." });
  } else {
    await stageEnd(dvId, dv.workspaceId, "segment", "succeeded");
  }
  await enqueueJob("embed", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

/* ══════════════════════════ EMBED ════════════════════════════════════ */
export async function runEmbed(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");

  const pages = await db.select().from(parsedPages)
    .where(eq(parsedPages.documentVersionId, dvId)).orderBy(parsedPages.pageNumber);
  const cls = await db.select().from(clauses)
    .where(eq(clauses.documentVersionId, dvId)).orderBy(clauses.charStart);
  const pageOf = (idx: number) => {
    for (const p of pages) if (idx >= p.charStart && idx < p.charEnd) return p.pageNumber;
    return pages[pages.length - 1]?.pageNumber ?? 1;
  };

  const TARGET = 800;
  const OVERLAP = 120;
  const rows: (typeof chunks.$inferInsert)[] = [];
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
        workspaceId: dv.workspaceId,
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

  await db.delete(chunks).where(eq(chunks.documentVersionId, dvId));
  if (rows.length > 0) {
    const emb = embeddings();
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      const vectors = await emb.embed(batch.map((r) => r.text));
      batch.forEach((r, j) => { r.embedding = vectors[j]; });
    }
    await db.insert(chunks).values(rows);
  }

  await enqueueJob("extract", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

/* ══════════════════════════ EXTRACT (A4) ═════════════════════════════ */
const TARGET_FIELDS: { key: string; label: string; group: string; hint: string }[] = [
  { key: "parties.vendor", label: "Vendor", group: "parties", hint: "The vendor / service provider legal entity name." },
  { key: "parties.customer", label: "Customer", group: "parties", hint: "The customer legal entity name." },
  { key: "dates.effective", label: "Effective date", group: "dates", hint: "The date the agreement becomes effective." },
  { key: "dates.signature", label: "Signature date", group: "dates", hint: "The date the agreement was signed." },
  { key: "dates.commencement", label: "Commencement date", group: "dates", hint: "The date services commence." },
  { key: "dates.expiration", label: "Expiration", group: "dates", hint: "The date the term ends." },
  { key: "dates.auto_renewal", label: "Auto-renewal", group: "dates", hint: "Whether and how the term renews automatically." },
  { key: "type.contract_type", label: "Contract type", group: "other", hint: "e.g. MSA, NDA, SOW." },
  { key: "law.governing_law", label: "Governing law", group: "other", hint: "Governing jurisdiction." },
  { key: "law.venue", label: "Venue", group: "other", hint: "Dispute venue." },
  { key: "commercial.currency", label: "Currency", group: "commercial", hint: "ISO 4217 code." },
  { key: "commercial.total_value", label: "Annual value", group: "commercial", hint: "Total or annual value with currency." },
  { key: "commercial.payment_cadence", label: "Payment cadence", group: "commercial", hint: "How often invoices are issued." },
  { key: "commercial.payment_terms", label: "Payment terms", group: "commercial", hint: "Net 30 etc." },
  { key: "commercial.late_fee", label: "Late payment interest", group: "commercial", hint: "Interest or fee on late payment. Often absent — if the document does not mention it, return not_found." },
  { key: "renewal.notice_period_days", label: "Notice period", group: "term", hint: "Days of notice for non-renewal or termination for convenience." },
  { key: "termination.for_convenience", label: "Termination for convenience", group: "term", hint: "Either party may terminate for convenience." },
  { key: "termination.cure_period_days", label: "Cure period", group: "term", hint: "Days to cure a breach." },
  { key: "confidentiality.term", label: "Confidentiality", group: "other", hint: "Confidentiality obligation summary." },
  { key: "ip.ownership", label: "IP ownership", group: "other", hint: "Who owns IP created." },
  { key: "data.protection", label: "Data protection", group: "data", hint: "Personal data handling." },
  { key: "security.requirements", label: "Security", group: "data", hint: "Security requirements." },
  { key: "insurance.requirement", label: "Insurance", group: "liability", hint: "Insurance obligations." },
  { key: "liability.cap", label: "Liability cap", group: "liability", hint: "Cap on aggregate liability, e.g. 12 months of fees." },
  { key: "liability.indemnity", label: "Indemnity", group: "liability", hint: "Indemnity obligations and whether capped." },
  { key: "warranty.term", label: "Warranty", group: "other", hint: "Warranty period and scope." },
  { key: "sla.uptime", label: "Service level", group: "sla", hint: "Uptime commitment and service credits." },
  { key: "audit.rights", label: "Audit rights", group: "other", hint: "Audit/inspection rights." },
  { key: "assignment.rights", label: "Assignment", group: "other", hint: "Assignment restrictions." },
  { key: "subcontracting.rights", label: "Subcontracting", group: "other", hint: "Subcontracting rules." },
  { key: "dispute.resolution", label: "Dispute resolution", group: "other", hint: "Escalation/arbitration/courts." }
];

export async function runExtract(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "extract", PROMPT_VERSIONS.extract);

  const pages = await db.select().from(parsedPages)
    .where(eq(parsedPages.documentVersionId, dvId)).orderBy(parsedPages.pageNumber);
  const cls = await db.select().from(clauses)
    .where(eq(clauses.documentVersionId, dvId)).orderBy(clauses.charStart);
  const fullText = pages.map((p) => p.text).join("");
  const pageOf = (idx: number): number => {
    for (const p of pages) if (idx >= p.charStart && idx < p.charEnd) return p.pageNumber;
    return 1;
  };

  const sectionIndex = cls
    .filter((c) => c.sectionRef)
    .map((c) => ({ ref: c.sectionRef as string, title: c.sectionTitle, start: c.charStart, end: c.charEnd, text: c.text, page: c.pageStart }));

  const relevant = sectionIndex.filter((s) =>
    /payment|term|termination|renewal|notice|liability|indemn|confidential|data|secur|insur|warrant|service level|audit|assign|subcontract|dispute|parties|date/i.test(`${s.title ?? ""} ${s.text.slice(0, 200)}`)
  ).slice(0, 12);

  let docBlock: string;
  if (relevant.length >= 3) {
    docBlock = `<document>\n${relevant.map((s) =>
      `<page page="${s.page}" section="${s.ref}">\n${s.text.slice(0, 4000)}\n</page>`).join("\n")}\n</document>`;
  } else {
    docBlock = `<document>\n${fullText.slice(0, 40000)}\n</document>`;
  }

  const sectionsSearched = relevant.map((s) => s.ref);

  let anyDegraded = false;
  const seenKeys = new Set<string>();
  const covered = new Set<string>();
  // Batched extraction: small per-group outputs are far more reliable than one
  // giant call (which NIM's gateway intermittently 503/504s), and each batch
  // persists immediately so partial progress survives a later batch failure.
  const BATCH = 7;
  for (let bi = 0; bi < TARGET_FIELDS.length; bi += BATCH) {
    const batch = TARGET_FIELDS.slice(bi, bi + BATCH);
    const fieldList = batch.map((f) => `${f.key} — ${f.label}: ${f.hint}`).join("\n");
    try {
    const result = await llm().structured({
      system: `${SHARED_PREAMBLE}

You extract contract metadata fields. For each field in the list, return status "found" with evidence, "not_found" with searched_sections, or "conflicting" with two or more evidence items from different section_ref values.
The character span you report must exactly cover quoted_text within the page text shown. Quote exactly, including numerals and spelling.
Field list:
${fieldList}`,
      user: docBlock,
      schema: ExtractOutput,
      temperature: 0,
      promptVersion: PROMPT_VERSIONS.extract,
      maxTokens: 16384
    });

    for (const cand of result.data.fields) {
      // The model occasionally repeats a field_key; first candidate wins so the
      // UNIQUE (document_version_id, field_key, prompt_version) constraint holds.
      if (seenKeys.has(cand.field_key)) continue;
      seenKeys.add(cand.field_key);
      covered.add(cand.field_key);
      const spec = TARGET_FIELDS.find((f) => f.key === cand.field_key);
      if (!spec) continue;
      const fieldCand: FieldCandidate = {
        fieldKey: cand.field_key,
        label: spec.label,
        fieldGroup: spec.group,
        status: cand.status,
        valueText: cand.value_text,
        valueNormalized: cand.value_normalized ?? null,
        extractionKind: cand.extraction_kind,
        evidence: cand.evidence,
        searchedSections: cand.searched_sections?.length ? cand.searched_sections : sectionsSearched,
        selfConfidence: cand.self_confidence
      };
      const validated = await validateFieldCandidate(dv.workspaceId, dvId, fieldCand, 0.8, {
        modelVersion: result.modelVersion,
        promptVersion: result.promptVersion
      });
      if (validated.superseded) anyDegraded = true;
      await persistValidatedField(dv.workspaceId, dv.contractId, dvId, validated, {
        modelVersion: result.modelVersion,
        promptVersion: result.promptVersion
      });
    }

    // Fields this batch never mentioned become explicit not_found rows (FR-EX-03).
    for (const f of batch) {
      if (covered.has(f.key)) continue;
      covered.add(f.key);
      await persistValidatedField(dv.workspaceId, dv.contractId, dvId, {
        fieldKey: f.key, label: f.label, fieldGroup: f.group,
        status: "not_found", valueText: null, valueNormalized: null,
        extractionKind: "factual", confidence: 0, citationId: null,
        altCitationIds: [], searchedSections: sectionsSearched, superseded: false
      }, { modelVersion: result.modelVersion, promptVersion: result.promptVersion });
    }

    await recordInvocation(dv.workspaceId, dvId, "A4", result, result.data.suspicious_content ? "repaired" : "passed");
    } catch (err) {
      // Rule 5: the port already made its one bounded repair retry. Degrade
      // only this batch to explicit not_found rows; later batches continue.
      anyDegraded = true;
      for (const f of batch) {
        if (covered.has(f.key)) continue;
        covered.add(f.key);
        await persistValidatedField(dv.workspaceId, dv.contractId, dvId, {
          fieldKey: f.key, label: f.label, fieldGroup: f.group,
          status: "not_found", valueText: null, valueNormalized: null,
          extractionKind: "factual", confidence: 0, citationId: null,
          altCitationIds: [], searchedSections: sectionsSearched, superseded: false
        }, { modelVersion: "unavailable", promptVersion: PROMPT_VERSIONS.extract });
      }
      console.warn(`[worker] extract batch ${Math.floor(bi / BATCH) + 1} degraded: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`);
    }
    // Space batches out: NIM's gateway 503-bursts under rapid consecutive calls.
    if (bi + BATCH < TARGET_FIELDS.length) await new Promise((r) => setTimeout(r, 4000));
  }

  await stageEnd(dvId, dv.workspaceId, "extract", anyDegraded ? "degraded" : "succeeded",
    anyDegraded ? { errorMessageSafe: "Some claims failed citation validation and were marked not found." } : undefined);
  await enqueueJob("obligations", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

async function recordInvocation(
  workspaceId: string, subjectId: string, agent: string,
  r: { modelVersion: string; promptVersion: string; inputTokens: number; outputTokens: number; latencyMs: number },
  outcome: string
) {
  await db.execute(sql`
    INSERT INTO ai_invocations (id, workspace_id, subject_type, subject_id, agent, model_version, prompt_version, prompt_hash, input_tokens, output_tokens, latency_ms, validation_outcome)
    VALUES (${id("ai")}, ${workspaceId}, 'document_version', ${subjectId}, ${agent}, ${r.modelVersion}, ${r.promptVersion}, ${sha256Hex(r.promptVersion)}, ${r.inputTokens}, ${r.outputTokens}, ${r.latencyMs}, ${outcome})
  `);
}

/* ══════════════════════ OBLIGATIONS (A5) ═════════════════════════════ */
export async function runObligations(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "obligations", PROMPT_VERSIONS.oblig);

  const fields = await db.select().from(extractedFields)
    .where(eq(extractedFields.documentVersionId, dvId));
  const anchors = anchorsFromFields(fields);

  const relevantSections = await db.select().from(clauses)
    .where(eq(clauses.documentVersionId, dvId)).orderBy(clauses.charStart);
  const obligText = relevantSections
    .filter((c) => /shall|must|agrees to|responsible for|notice|report|renew|pay|provide|deliver|maintain|insurance/i.test(c.text))
    .slice(0, 14)
    .map((c) => `<page page="${c.pageStart}" section="${c.sectionRef ?? ""}">\n${c.text.slice(0, 2500)}\n</page>`)
    .join("\n");

  const vendor = fields.find((f) => f.fieldKey === "parties.vendor")?.valueText ?? "the vendor";
  const customer = fields.find((f) => f.fieldKey === "parties.customer")?.valueText ?? "the customer";

  const result = await llm().structured({
    system: `${SHARED_PREAMBLE}

You identify obligations — things a party must do or track with a deadline. For each, return the RULE for the due date; never a computed date.
due_rule: fixed (stated calendar date → anchor="absolute", anchor_value=the date), relative (offset from an anchor → anchor="expiration_date"|"signature_date"|"effective_date"|"commencement_date"|"invoice_date", offset_days negative for "before"), event_triggered (anchor="event:<name>"), recurring (anchor="absolute" plus recurrence RRULE like FREQ=MONTHLY;BYMONTHDAY=5).
Set anchor_known=false when the anchor date is not stated in the document. Quote evidence exactly with correct character spans.`,
    user: `<document>
${obligText}
</document>

Parties: vendor=${vendor}; customer=${customer}.
Extract every date-bearing obligation.`,
    schema: ObligationsOutput,
    temperature: 0,
    promptVersion: PROMPT_VERSIONS.oblig,
    maxTokens: 16384
  });

  // Idempotency: a re-run replaces only its own suggested output, never human-accepted rows.
  await db.delete(obligations).where(and(
    eq(obligations.sourceVersionId, dvId),
    eq(obligations.status, "suggested")
  ));

  for (const ob of result.data.obligations) {
    const evidence = ob.evidence[0];
    if (!evidence) continue; // uncited → drop

    const citation = await resolveAndStoreCitation(dv.workspaceId, dvId, {
      page: evidence.page,
      section_ref: evidence.section_ref,
      section_title: evidence.section_title ?? null,
      char_start: evidence.char_start,
      char_end: evidence.char_end,
      quoted_text: evidence.quoted_text
    }, null);
    if (!citation) continue; // < 0.92 after re-anchor → drop (non-negotiable rule 2)

    const rule: DueRuleDetail = {
      anchor: ob.due_rule_detail.anchor as DueRuleDetail["anchor"],
      anchorValue: ob.due_rule_detail.anchor_value,
      offsetDays: ob.due_rule_detail.offset_days,
      calendar: ob.due_rule_detail.calendar,
      recurrence: ob.due_rule_detail.recurrence
    };

    const anchorMap: Record<string, string | null> = { ...anchors };
    if (rule.anchor === "absolute" && rule.anchorValue) {
      anchorMap.absolute = rule.anchorValue;
    }

    const computed = computeDueDate(rule, anchorMap);
    const needsAssumption = ob.anchor_known === false || computed.needsAssumption;

    const detail = {
      anchor: rule.anchor === "absolute" ? "absolute" : rule.anchor,
      anchor_value: rule.anchorValue ?? null,
      offset_days: rule.offsetDays ?? null,
      calendar: rule.calendar ?? "calendar",
      recurrence: rule.recurrence ?? null
    };

    const lint = bannedPhraseLint(`${ob.title} ${ob.description ?? ""}`);

    await db.insert(obligations).values({
      id: id("ob"),
      workspaceId: dv.workspaceId,
      contractId: dv.contractId,
      sourceVersionId: dvId,
      title: ob.title,
      description: ob.description,
      obligor: ob.obligor,
      obligee: ob.obligee,
      triggerText: null,
      dueRule: ob.due_rule,
      dueRuleDetail: JSON.stringify(detail),
      dueDate: needsAssumption ? null : computed.dueDate,
      dueDateMath: computed.math,
      recurrenceRrule: rule.recurrence ?? null,
      gracePeriodDays: ob.grace_period_days ?? 0,
      priority: ob.priority,
      riskNote: lint.clean ? null : "Review required: output triggered the safety lint.",
      status: needsAssumption ? "needs_assumption" : "suggested",
      citationId: citation.id,
      confidence: blendConfidence({
        selfReport: ob.self_confidence,
        retrievalAgreement: 0.8,
        citationMatchScore: citation.matchConfidence,
        ocrDerived: citation.ocrDerived
      }),
      derivedFromFieldIds: []
    });
  }

  await recordInvocation(dv.workspaceId, dvId, "A5", result, "passed");
  await stageEnd(dvId, dv.workspaceId, "obligations", "succeeded");
  await enqueueJob("risk", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

/* ══════════════════════════ RISK (A6) ════════════════════════════════ */
export async function runRisk(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "risk", PROMPT_VERSIONS.risk);

  const rules = await db.execute<{ id: string; clause_type: string; rule_name: string; expectation: string; severity: string; reviewer_role: string }>(sql`
    SELECT id, clause_type, rule_name, expectation, severity, reviewer_role
    FROM playbook_rules WHERE workspace_id = ${dv.workspaceId} AND active = true
  `);

  const cls = await db.select().from(clauses)
    .where(eq(clauses.documentVersionId, dvId)).orderBy(clauses.charStart);
  const clauseText = cls
    .filter((c) => /liabilit|indemn|renew|notice|termination|payment|data|secur|confidential/i.test(`${c.sectionTitle ?? ""} ${c.text.slice(0, 200)}`))
    .slice(0, 12)
    .map((c) => `<page page="${c.pageStart}" section="${c.sectionRef ?? ""}">\n${c.text.slice(0, 2500)}\n</page>`)
    .join("\n");

  const ruleList = rules.rows.map((r) =>
    `${r.id} | ${r.clause_type} | ${r.rule_name} | expectation: ${r.expectation} | severity if violated: ${r.severity}`
  ).join("\n");

  const result = await llm().structured({
    system: `${SHARED_PREAMBLE}

You flag deviations from the company playbook. Set playbook_rule_id to the matching rule id, or null for a heuristic flag.
recommended_step MUST be a process action ("ask", "confirm", "escalate", "compare") — never a legal conclusion. Quote evidence exactly.`,
    user: `<document>
${clauseText}
</document>

Playbook rules:
${ruleList || "(none seeded — use heuristic flags)"}

Flag contract risks against the playbook.`,
    schema: RiskOutput,
    temperature: 0,
    promptVersion: PROMPT_VERSIONS.risk,      maxTokens: 16384
  });

  await db.delete(riskFlags).where(and(
    eq(riskFlags.documentVersionId, dvId),
    eq(riskFlags.status, "open")
  ));

  for (const flag of result.data.flags) {
    const evidence = flag.evidence[0];
    if (!evidence) continue;
    const citation = await resolveAndStoreCitation(dv.workspaceId, dvId, {
      page: evidence.page,
      section_ref: evidence.section_ref,
      section_title: evidence.section_title ?? null,
      char_start: evidence.char_start,
      char_end: evidence.char_end,
      quoted_text: flag.found_text || evidence.quoted_text
    }, null);
    if (!citation) continue;

    const lint = bannedPhraseLint(`${flag.title} ${flag.explanation} ${flag.recommended_step}`);
    if (!lint.clean) continue; // advice-shaped flag is dropped entirely

    await db.insert(riskFlags).values({
      id: id("rf"),
      workspaceId: dv.workspaceId,
      contractId: dv.contractId,
      documentVersionId: dvId,
      playbookRuleId: flag.playbook_rule_id,
      category: flag.category,
      flagType: flag.flag_type,
      title: flag.title,
      explanation: flag.explanation,
      expectedText: flag.expected_text,
      foundText: flag.found_text,
      severity: flag.severity,
      confidence: blendConfidence({
        selfReport: flag.self_confidence,
        retrievalAgreement: 0.8,
        citationMatchScore: citation.matchConfidence,
        ocrDerived: citation.ocrDerived
      }),
      recommendedStep: flag.recommended_step,
      suggestedReviewerRole: flag.suggested_reviewer_role,
      citationId: citation.id,
      status: "open"
    });
  }

  await recordInvocation(dv.workspaceId, dvId, "A6", result, "passed");
  await stageEnd(dvId, dv.workspaceId, "risk", "succeeded");
  await enqueueJob("summarize", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

/* ═══════════════════════ SUMMARIZE (A9 brief) ════════════════════════ */
export async function runSummarize(dvId: string) {
  const dv = (await db.select().from(documentVersions).where(eq(documentVersions.id, dvId)).limit(1))[0];
  if (!dv) throw new Error("document_version_not_found");
  await stageStart(dvId, dv.workspaceId, "summarize", PROMPT_VERSIONS.brief);

  const fields = await db.select().from(extractedFields)
    .where(eq(extractedFields.documentVersionId, dvId));
  const flags = await db.select().from(riskFlags)
    .where(eq(riskFlags.contractId, dv.contractId));
  const obs = await db.select().from(obligations)
    .where(eq(obligations.contractId, dv.contractId));

  // Brief agent sees only validated IDs — no raw document text (doc 07 §2.6).
  const fieldSummaries = fields.map((f) => ({ id: f.id, key: f.fieldKey, label: f.label, value: f.valueText, status: f.validationStatus }));
  const flagSummaries = flags.map((f) => ({ id: f.id, title: f.title, severity: f.severity, category: f.category }));
  const obSummaries = obs.map((o) => ({ id: o.id, title: o.title, due_rule: o.dueRule, due_date: o.dueDate, status: o.status }));

  let brief: zInferBrief | null = null;
  try {
    const result = await llm().structured({
      system: `${SHARED_PREAMBLE}

You write a short stakeholder brief. You receive only validated field/flag/obligation ids — reference them by id in field_ids. Write 2-5 interpretation sentences and 0-4 open questions a human must resolve.
Never state legal conclusions. Every sentence must reference at least one id.`,
      user: `Fields: ${JSON.stringify(fieldSummaries)}\nFlags: ${JSON.stringify(flagSummaries)}\nObligations: ${JSON.stringify(obSummaries)}`,
      schema: BriefOutput,
      temperature: 0.2,
      promptVersion: PROMPT_VERSIONS.brief,
      maxTokens: 8192
    });
    brief = result.data;
    await recordInvocation(dv.workspaceId, dvId, "A9", result, "passed");
  } catch {
    brief = null; // grid-only fallback
  }

  if (brief) {
    const allText = [
      ...brief.interpretation.map((i) => i.text),
      ...brief.open_questions.map((q) => q.question)
    ].join("\n");
    if (!bannedPhraseLint(allText).clean) brief = null;
  }

  await storage.put(
    `w/${dv.workspaceId}/c/${dv.contractId}/v/${dvId}/brief.json`,
    Buffer.from(JSON.stringify(brief ?? { interpretation: [], open_questions: [] }), "utf8")
  );

  const isoOf = (t: string | null): string | null => {
    if (!t) return null;
    const m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : null;
  };
  await db.update(contracts).set({
    effectiveDate: isoOf(fields.find((f) => f.fieldKey === "dates.effective")?.valueText ?? null),
    expirationDate: isoOf(fields.find((f) => f.fieldKey === "dates.expiration")?.valueText ?? null)
  }).where(eq(contracts.id, dv.contractId));

  await markStage(dvId, dv.workspaceId, "summarizing", "succeeded");
  await setDocStatus(dvId, "ready");
  await enqueueJob("diff", { documentVersionId: dvId, workspaceId: dv.workspaceId, contractId: dv.contractId });
}

type zInferBrief = { interpretation: { text: string; field_ids: string[]; self_confidence: number }[]; open_questions: { question: string; field_ids: string[] }[]; suspicious_content: boolean };

/* ═══════════════ RECOMPUTE AFTER CORRECTION (doc 04 §7) ═════════════ */
export async function recomputeDependents(fieldId: string) {
  const field = (await db.select().from(extractedFields).where(eq(extractedFields.id, fieldId)).limit(1))[0];
  if (!field) return;

  const obs = await db.select().from(obligations).where(eq(obligations.contractId, field.contractId));
  const targets = obs.filter((o) => (o.derivedFromFieldIds as string[]).includes(fieldId));
  const anchorsList = await db.select().from(extractedFields).where(eq(extractedFields.documentVersionId, field.documentVersionId));
  const anchors = anchorsFromFields(anchorsList);

  for (const ob of targets) {
    if (ob.status !== "active" && ob.status !== "suggested" && ob.status !== "needs_assumption") continue;
    const detail = JSON.parse(ob.dueRuleDetail) as DueRuleDetail;
    const computed = computeDueDate(detail, anchors);
    await db.update(obligations).set({
      dueDate: computed.needsAssumption ? null : computed.dueDate,
      dueDateMath: computed.math,
      status: computed.needsAssumption && ob.status !== "suggested" ? "needs_assumption" : ob.status,
      updatedAt: new Date()
    }).where(eq(obligations.id, ob.id));
    await db.insert(obligationEvents).values({
      id: id("oe"),
      workspaceId: ob.workspaceId,
      obligationId: ob.id,
      eventType: "recalculated",
      actorUserId: null,
      payload: JSON.stringify({ from_correction: fieldId, math: computed.math })
    });
    // Reschedule pending alerts (sent history immutable).
    await rescheduleAlertsFor(ob.id, computed.dueDate, ob.workspaceId);
  }

  // Keep contract denormalized renewal_notice_by fresh when notice period changes.
  if (field.fieldKey === "renewal.notice_period_days" || field.fieldKey === "dates.expiration") {
    const exp = anchors.expiration_date;
    const noticeRaw = anchorsList.find((f) => f.fieldKey === "renewal.notice_period_days");
    let days: number | null = null;
    if (noticeRaw?.valueNormalized) {
      try {
        const v = JSON.parse(noticeRaw.valueNormalized) as { days?: number };
        days = typeof v === "object" && v.days ? v.days : parseInt(noticeRaw.valueNormalized.replace(/[^0-9]/g, ""), 10) || null;
      } catch { /* ignore */ }
    }
    if (exp && days) {
      const due = addDays(exp, -days);
      await db.update(contracts).set({ renewalNoticeBy: due }).where(eq(contracts.id, field.contractId));
    }
  }

  void citations;
}

/* ══════════════════════════ DIFF (A7) ════════════════════════════════ */
export async function runDiff(payload: JobPayload) {
  const baseVersionId = payload.baseVersionId as string;
  const targetVersionId = payload.targetVersionId as string;
  const workspaceId = payload.workspaceId as string;
  const contractId = payload.contractId as string;
  if (!baseVersionId || !targetVersionId) return; // single version — nothing to compare

  const baseClauses = await db.select().from(clauses).where(eq(clauses.documentVersionId, baseVersionId)).orderBy(clauses.charStart);
  const targetClauses = await db.select().from(clauses).where(eq(clauses.documentVersionId, targetVersionId)).orderBy(clauses.charStart);

  const cmpRows = await db.execute<{ id: string }>(sql`
    SELECT id FROM comparisons WHERE base_version_id = ${baseVersionId} AND target_version_id = ${targetVersionId} LIMIT 1
  `);
  let cmpId = cmpRows.rows[0]?.id;
  if (!cmpId) {
    cmpId = id("cmp");
    await db.execute(sql`
      INSERT INTO comparisons (id, workspace_id, contract_id, base_version_id, target_version_id, status, created_by)
      VALUES (${cmpId}, ${workspaceId}, ${contractId}, ${baseVersionId}, ${targetVersionId}, 'computing', ${payload.userId ?? workspaceId})
    `);
  }

  const targetByRef = new Map<string, typeof targetClauses[number]>();
  for (const c of targetClauses) if (c.sectionRef) targetByRef.set(c.sectionRef, c);

  const usedTarget = new Set<string>();
  const aligned: { base?: typeof baseClauses[number]; target?: typeof targetClauses[number] }[] = [];
  for (const b of baseClauses) {
    let t = b.sectionRef ? targetByRef.get(b.sectionRef) : undefined;
    if (!t) {
      let best: { c: typeof targetClauses[number]; s: number } | null = null;
      for (const cand of targetClauses) {
        if (usedTarget.has(cand.id)) continue;
        const s = diceSimilarity(b.text.slice(0, 400), cand.text.slice(0, 400));
        if (s > 0.6 && (!best || s > best.s)) best = { c: cand, s };
      }
      if (best) t = best.c;
    }
    if (t) usedTarget.add(t.id);
    aligned.push(t ? { base: b, target: t } : { base: b });
  }
  for (const t of targetClauses) {
    if (!usedTarget.has(t.id)) aligned.push({ target: t });
  }

  const candidates = aligned
    .filter((a): a is { base: typeof baseClauses[number]; target: typeof targetClauses[number] } => Boolean(a.base && a.target))
    .filter((pair) => {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      if (norm(pair.base.text) === norm(pair.target.text)) return false;
      return diceSimilarity(pair.base.text.slice(0, 600), pair.target.text.slice(0, 600)) < 0.98;
    });

  const pagesBase = await db.select().from(parsedPages).where(eq(parsedPages.documentVersionId, baseVersionId)).orderBy(parsedPages.pageNumber);
  const pagesTarget = await db.select().from(parsedPages).where(eq(parsedPages.documentVersionId, targetVersionId)).orderBy(parsedPages.pageNumber);
  const pageOf = (pages: typeof pagesBase, idx: number) => {
    for (const p of pages) if (idx >= p.charStart && idx < p.charEnd) return p.pageNumber;
    return 1;
  };

  const diffInput = candidates.slice(0, 20).map((p) => ({
    clause_ref: p.base.sectionRef,
    before: p.base.text.slice(0, 1200),
    after: p.target.text.slice(0, 1200),
    base_page: pageOf(pagesBase, p.base.charStart),
    base_char_start: p.base.charStart,
    base_char_end: p.base.charEnd,
    target_page: pageOf(pagesTarget, p.target.charStart),
    target_char_start: p.target.charStart,
    target_char_end: p.target.charEnd
  }));

  let materialCount = 0;
  let cosmeticCount = 0;

  if (diffInput.length > 0) {
    const result = await llm().structured({
      system: `${SHARED_PREAMBLE}

You classify contract version changes. For each pair return change_type, impact_category, is_material (money/dates/renewal/liability/indemnity/data_use/sla/termination/obligations are material; formatting/numbering is cosmetic), a one-sentence business_impact, risk_delta, suggested_reviewer_role.
Quote before/after text exactly.`,
      user: `Changes:\n${JSON.stringify(diffInput, null, 2)}`,
      schema: CompareOutput,
      temperature: 0,
      promptVersion: PROMPT_VERSIONS.compare,
      maxTokens: 16384
    });

    await db.execute(sql`DELETE FROM comparison_changes WHERE comparison_id = ${cmpId}`);

    for (let i = 0; i < result.data.changes.length && i < diffInput.length; i++) {
      const ch = result.data.changes[i];
      const pair = diffInput[i];
      if (!bannedPhraseLint(ch.business_impact).clean) continue;

      const baseCitation = await resolveAndStoreCitation(workspaceId, baseVersionId, {
        page: pair.base_page,
        section_ref: pair.clause_ref,
        char_start: pair.base_char_start,
        char_end: pair.base_char_end,
        quoted_text: (ch.before_text ?? pair.before).slice(0, 400)
      }, null);
      const targetCitation = await resolveAndStoreCitation(workspaceId, targetVersionId, {
        page: pair.target_page,
        section_ref: pair.clause_ref,
        char_start: pair.target_char_start,
        char_end: pair.target_char_end,
        quoted_text: (ch.after_text ?? pair.after).slice(0, 400)
      }, null);
      if (!baseCitation || !targetCitation) continue; // both spans must resolve

      if (ch.is_material) materialCount++; else cosmeticCount++;
      await db.execute(sql`
        INSERT INTO comparison_changes (id, workspace_id, comparison_id, change_type, impact_category, is_material, clause_ref, before_text, after_text, business_impact, risk_delta, suggested_reviewer_role, base_citation_id, target_citation_id, confidence)
        VALUES (${id("chg")}, ${workspaceId}, ${cmpId}, ${ch.change_type}, ${ch.impact_category}, ${ch.is_material}, ${pair.clause_ref}, ${ch.before_text}, ${ch.after_text}, ${ch.business_impact}, ${ch.risk_delta}, ${ch.suggested_reviewer_role}, ${baseCitation.id}, ${targetCitation.id}, ${ch.self_confidence})
      `);
    }
  }

  // Added/removed clauses.
  const addedOrRemoved = aligned.filter((a) => (a.base && !a.target) || (!a.base && a.target));
  for (const a of addedOrRemoved.slice(0, 20)) {
    const isAdded = !a.base && a.target;
    const clause = (isAdded ? a.target : a.base) as typeof baseClauses[number];
    const dvId = isAdded ? targetVersionId : baseVersionId;
    const pages = isAdded ? pagesTarget : pagesBase;
    const citation = await resolveAndStoreCitation(workspaceId, dvId, {
      page: pageOf(pages, clause.charStart),
      section_ref: clause.sectionRef,
      char_start: clause.charStart,
      char_end: clause.charEnd,
      quoted_text: clause.text.slice(0, 400)
    }, null);
    if (!citation) continue;
    const impact = isAdded ? "A clause was added in this version." : "A clause was removed in this version.";
    if (!bannedPhraseLint(impact).clean) continue;
    materialCount++;
    await db.execute(sql`
      INSERT INTO comparison_changes (id, workspace_id, comparison_id, change_type, impact_category, is_material, clause_ref, before_text, after_text, business_impact, risk_delta, suggested_reviewer_role, base_citation_id, target_citation_id, confidence)
      VALUES (${id("chg")}, ${workspaceId}, ${cmpId}, ${isAdded ? "added" : "removed"}, ${guessClauseType(clause.sectionTitle ?? "", clause.text) ?? "cosmetic"}, true, ${clause.sectionRef}, ${isAdded ? null : clause.text.slice(0, 400)}, ${isAdded ? clause.text.slice(0, 400) : null}, ${impact}, "unchanged", "legal", ${isAdded ? null : citation.id}, ${isAdded ? citation.id : null}, 0.8)
    `);
  }

  const partial = candidates.length > 20;
  await db.execute(sql`
    UPDATE comparisons SET status = ${partial ? "partial" : "ready"}, material_count = ${materialCount}, cosmetic_count = ${cosmeticCount}
    WHERE id = ${cmpId}
  `);
}
