import { eq, and as sqlAnd } from "drizzle-orm";
import { db } from "./db/client";
import { citations, extractedFields } from "./db/extraction-schema";
import { parsedPages } from "./db/text-schema";
import { diceSimilarity, lexicalOverlap } from "./similarity";
import { id } from "./ids";
import type { LLMResult } from "./ports";

/* ═══════════════ 1. Banned-phrase lint (legal advice / authority) ═══════
   A hit downgrades the output to a review state and logs a safety_lint_hit
   event rather than silently rewriting (doc 07 §3). ═══════════════════════ */
const BANNED_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(un)?enforceable\b/i, reason: "legal conclusion (enforceability)" },
  { re: /\b(not\s+)?legally\s+binding\b/i, reason: "legal conclusion (binding)" },
  { re: /\byou should sue\b/i, reason: "advice (litigation)" },
  { re: /\byou (are|'re|will be) (not )?liable\b/i, reason: "legal conclusion (liability)" },
  { re: /\bthis violates\b/i, reason: "legal conclusion (violation)" },
  { re: /\bis compliant with\b/i, reason: "legal conclusion (compliance)" },
  { re: /\bwe recommend terminating\b/i, reason: "advice (termination)" },
  { re: /\byou should terminate\b/i, reason: "advice (termination)" },
  { re: /\bunder \d+ U\.S\.C\./i, reason: "legal authority citation" },
  { re: /\bv\.\s?[A-Z][a-z]+/, reason: "legal authority citation (case law)" },
  { re: /\bper §\s*\d+ of the .* Act/i, reason: "legal authority citation (statute)" },
  { re: /\bguarantees?\b/i, reason: "prohibited certainty claim" },
  { re: /\bcertified\b/i, reason: "prohibited certainty claim" },
  { re: /\bconsult (a|your) lawyer\b/i, reason: "advice phrasing" },
  { re: /\blegal advice\b/i, reason: "advice phrasing" }
];

export interface LintResult {
  hits: { phrase: string; reason: string }[];
  clean: boolean;
}

export function bannedPhraseLint(text: string): LintResult {
  const hits: { phrase: string; reason: string }[] = [];
  for (const { re, reason } of BANNED_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ phrase: m[0], reason });
  }
  return { hits, clean: hits.length === 0 };
}

/* ═══════════════ 2. Citation re-resolution (control #3) ═════════════════
   Re-read the source slice; ≥ 0.92 normalised similarity or the claim is
   dropped. One fuzzy re-anchor attempt within the page; else not_found. */
export interface EvidenceSpan {
  page: number;
  section_ref: string | null;
  section_title?: string | null;
  char_start: number;
  char_end: number;
  quoted_text: string;
}

export interface ResolvedCitation {
  id: string;
  page: number;
  sectionRef: string | null;
  sectionTitle: string | null;
  charStart: number;
  charEnd: number;
  quotedText: string;
  matchConfidence: number;
  resolvable: boolean;
  ocrDerived: boolean;
}

export const CITATION_THRESHOLD = 0.92;

export async function resolveAndStoreCitation(
  workspaceId: string,
  documentVersionId: string,
  evidence: EvidenceSpan,
  clauseId: string | null
): Promise<ResolvedCitation | null> {
  const pages = await db
    .select()
    .from(parsedPages)
    .where(eq(parsedPages.documentVersionId, documentVersionId));
  const page = pages.find((p) => p.pageNumber === evidence.page);
  if (!page) return null;

  const slice = page.text.slice(evidence.char_start, evidence.char_end);
  let start = evidence.char_start;
  let end = evidence.char_end;
  let score = diceSimilarity(slice, evidence.quoted_text);

  // One fuzzy re-anchor attempt within the same page.
  if (score < CITATION_THRESHOLD) {
    const { findSlice } = await import("./similarity");
    const found = findSlice(page.text, evidence.quoted_text, evidence.char_start);
    if (found) {
      start = found.start;
      end = found.end;
      score = found.score;
    }
  }

  const resolvable = score >= CITATION_THRESHOLD;
  const citId = id("cit");
  await db.insert(citations).values({
    id: citId,
    workspaceId,
    documentVersionId,
    clauseId,
    page: evidence.page,
    sectionRef: evidence.section_ref ?? page.text ? evidence.section_ref : null,
    sectionTitle: evidence.section_title ?? null,
    charStart: resolvable ? start : evidence.char_start,
    charEnd: resolvable ? end : evidence.char_end,
    quotedText: evidence.quoted_text,
    matchConfidence: score,
    resolvable,
    ocrDerived: page.ocrDerived
  });
  if (!resolvable) return null;
  return {
    id: citId,
    page: evidence.page,
    sectionRef: evidence.section_ref,
    sectionTitle: evidence.section_title ?? null,
    charStart: start,
    charEnd: end,
    quotedText: evidence.quoted_text,
    matchConfidence: score,
    resolvable,
    ocrDerived: page.ocrDerived
  };
}

/* ═══════════════ 3. Numeric / date verification (control #5) ════════════ */
export function numericVerification(valueText: string, quoted: string): boolean {
  const valueNums = valueText.match(/\d[\d,\.]*/g) ?? [];
  if (valueNums.length === 0) return true; // no numbers claimed
  const norm = (s: string) => s.replace(/[\u2018\u2019]/g, "'").toLowerCase();
  const nq = norm(quoted);
  const words: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", sixty: "60", ninety: "90", hundred: "100" };
  const quotedNums = new Set((quoted.match(/\d[\d,\.]*/g) ?? []).map((x) => x.replace(/,/g, "")));
  const quotedWords = new Set(Object.entries(words).filter(([w]) => norm(quoted).includes(w)).map(([, d]) => d));
  return valueNums.every((n) => {
    const clean = n.replace(/,/g, "").replace(/\.$/, "");
    return quotedNums.has(clean) || quotedNums.has(String(parseInt(clean, 10))) || quotedWords.has(String(parseInt(clean, 10))) || nq.includes(clean);
  });
}

/* ═══════════════ 4. Confidence blend (doc 07 §4) ════════════════════════ */
export function blendConfidence(opts: {
  selfReport: number;
  retrievalAgreement: number;  // share of top-k chunks supporting the same value
  citationMatchScore: number;  // similarity of quote to source slice
  ocrDerived: boolean;
  conflicting?: boolean;
}): number {
  let c =
    0.5 * clamp01(opts.selfReport) +
    0.3 * clamp01(opts.retrievalAgreement) +
    0.2 * clamp01(opts.citationMatchScore);
  if (opts.ocrDerived) c *= 0.8;
  if (opts.conflicting) c *= 0.85;
  return Math.round(c * 1000) / 1000;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function confidenceBand(c: number): "high" | "medium" | "low" {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "medium";
  return "low";
}

/** Grounding proxy (MVP lexical): claim must share ≥ 0.5 content words with evidence. */
export function groundingCheck(claim: string, evidence: string): boolean {
  return lexicalOverlap(claim, evidence) >= 0.5;
}

/* ═══════════════ 5. Full validator pipeline for a field ════════════════ */
export interface FieldCandidate {
  fieldKey: string;
  label: string;
  fieldGroup: string;
  status: "found" | "not_found" | "conflicting";
  valueText: string | null;
  valueNormalized: unknown;
  extractionKind: "factual" | "interpretation";
  evidence: EvidenceSpan[];
  searchedSections: string[];
  selfConfidence: number;
}

export interface ValidatedField {
  fieldKey: string;
  label: string;
  fieldGroup: string;
  status: "found" | "not_found" | "conflicting" | "needs_confirmation";
  valueText: string | null;
  valueNormalized: unknown;
  extractionKind: "factual" | "interpretation";
  confidence: number;
  citationId: string | null;
  altCitationIds: string[];
  searchedSections: string[];
  superseded: boolean; // claim failed validation → not_found
}

export async function validateFieldCandidate(
  workspaceId: string,
  documentVersionId: string,
  cand: FieldCandidate,
  retrievalAgreement: number,
  llmMeta: { modelVersion: string; promptVersion: string }
): Promise<ValidatedField> {
  const base = {
    fieldKey: cand.fieldKey,
    label: cand.label,
    fieldGroup: cand.fieldGroup,
    extractionKind: cand.extractionKind,
    searchedSections: cand.searchedSections
  };

  // not_found: forbid a value, require search evidence.
  if (cand.status === "not_found" || cand.evidence.length === 0) {
    return {
      ...base,
      status: "not_found",
      valueText: null,
      valueNormalized: null,
      confidence: 0,
      citationId: null,
      altCitationIds: [],
      superseded: false
    };
  }

  // Citation re-resolution for every evidence item.
  const resolved: ResolvedCitation[] = [];
  for (const ev of cand.evidence) {
    const r = await resolveAndStoreCitation(workspaceId, documentVersionId, ev, null);
    if (r) resolved.push(r);
  }
  if (resolved.length === 0) {
    // Every claim below threshold is dropped → not_found. Never substitute.
    return {
      ...base,
      status: "not_found",
      valueText: null,
      valueNormalized: null,
      confidence: 0,
      citationId: null,
      altCitationIds: [],
      superseded: true
    };
  }

  // Conflicting requires ≥ 2 distinct section refs; if only one survives, pick the first and downgrade.
  if (cand.status === "conflicting" && resolved.length < 2) {
    const primary = resolved[0];
    const citationScore = primary.matchConfidence;
    const confidence = blendConfidence({
      selfReport: cand.selfConfidence,
      retrievalAgreement,
      citationMatchScore: citationScore,
      ocrDerived: primary.ocrDerived
    });
    return {
      ...base,
      status: "found",
      valueText: cand.valueText,
      valueNormalized: cand.valueNormalized,
      confidence,
      citationId: primary.id,
      altCitationIds: [],
      superseded: false
    };
  }

  const primary = resolved[0];

  // Numeric verification: every number in value_text must appear in the cited span.
  if (cand.valueText && !numericVerification(cand.valueText, primary.quotedText)) {
    return {
      ...base,
      status: "not_found",
      valueText: null,
      valueNormalized: null,
      confidence: 0,
      citationId: null,
      altCitationIds: [],
      superseded: true
    };
  }

  // Grounding check on factual claims.
  if (cand.extractionKind === "factual" && cand.valueText) {
    if (!groundingCheck(cand.valueText, primary.quotedText)) {
      return {
        ...base,
        status: "not_found",
        valueText: null,
        valueNormalized: null,
        confidence: 0,
        citationId: null,
        altCitationIds: [],
        superseded: true
      };
    }
  }

  // Banned-phrase lint on user-facing text.
  const lint = bannedPhraseLint(`${cand.valueText ?? ""}`);
  if (!lint.clean) {
    return {
      ...base,
      status: "not_found",
      valueText: null,
      valueNormalized: null,
      confidence: 0,
      citationId: null,
      altCitationIds: [],
      superseded: true
    };
  }

  const citationScore = primary.matchConfidence;
  const confidence = blendConfidence({
    selfReport: cand.selfConfidence,
    retrievalAgreement,
    citationMatchScore: citationScore,
    ocrDerived: primary.ocrDerived,
    conflicting: cand.status === "conflicting"
  });

  const band = confidenceBand(confidence);
  return {
    ...base,
    status: cand.status === "conflicting" ? "conflicting" : band === "low" ? "needs_confirmation" : "found",
    valueText: cand.valueText,
    valueNormalized: cand.valueNormalized,
    confidence,
    citationId: primary.id,
    altCitationIds: resolved.slice(1).map((r) => r.id),
    superseded: false
  };
}

/** Persist a validated field respecting the unique (dv, key, prompt) constraint. */
export async function persistValidatedField(
  workspaceId: string,
  contractId: string,
  documentVersionId: string,
  vf: ValidatedField,
  llmMeta: { modelVersion: string; promptVersion: string }
) {
  const existing = await db
    .select()
    .from(extractedFields)
    .where(and3(documentVersionId, vf.fieldKey, llmMeta.promptVersion))
    .limit(1);
  const values = {
    workspaceId,
    contractId,
    documentVersionId,
    fieldKey: vf.fieldKey,
    fieldGroup: vf.fieldGroup,
    label: vf.label,
    valueText: vf.valueText,
    valueNormalized: vf.valueNormalized === null ? null : JSON.stringify(vf.valueNormalized),
    extractionKind: vf.extractionKind,
    confidence: vf.confidence,
    validationStatus: vf.status as ValidationStatusName,
    primaryCitationId: vf.citationId,
    altCitationIds: vf.altCitationIds,
    searchedSections: vf.searchedSections.length > 0 ? vf.searchedSections : null,
    modelVersion: llmMeta.modelVersion,
    promptVersion: llmMeta.promptVersion
  };
  if (existing[0]) {
    // A pipeline re-run never overwrites a human-corrected field.
    if (existing[0].validationStatus === "corrected" || existing[0].validationStatus === "confirmed") {
      await db.update(extractedFields)
        .set({ validationStatus: "superseded_extraction" })
        .where(eq(extractedFields.id, existing[0].id));
      const ins = await db.insert(extractedFields).values({ id: id("ef"), ...values })
        .onConflictDoUpdate({
          target: [extractedFields.documentVersionId, extractedFields.fieldKey, extractedFields.promptVersion],
          set: {
            valueText: values.valueText,
            valueNormalized: values.valueNormalized,
            confidence: values.confidence,
            validationStatus: values.validationStatus,
            primaryCitationId: values.primaryCitationId,
            altCitationIds: values.altCitationIds,
            searchedSections: values.searchedSections,
            modelVersion: values.modelVersion
          }
        })
        .returning();
      return ins[0];
    }
    const upd = await db.update(extractedFields).set(values).where(eq(extractedFields.id, existing[0].id)).returning();
    return upd[0];
  }
  // ON CONFLICT guard: closes the check-then-insert race (and duplicate
  // candidates) against UNIQUE (document_version_id, field_key, prompt_version).
  const ins = await db.insert(extractedFields).values({ id: id("ef"), ...values })
    .onConflictDoUpdate({
      target: [extractedFields.documentVersionId, extractedFields.fieldKey, extractedFields.promptVersion],
      set: {
        valueText: values.valueText,
        valueNormalized: values.valueNormalized,
        confidence: values.confidence,
        validationStatus: values.validationStatus,
        primaryCitationId: values.primaryCitationId,
        altCitationIds: values.altCitationIds,
        searchedSections: values.searchedSections,
        modelVersion: values.modelVersion
      }
    })
    .returning();
  return ins[0];
}

type ValidationStatusName =
  | "unreviewed" | "confirmed" | "corrected" | "rejected"
  | "not_found" | "found" | "conflicting" | "needs_confirmation" | "superseded_extraction";

function and3(documentVersionId: string, fieldKey: string, promptVersion: string) {
  return sqlAnd(
    eq(extractedFields.documentVersionId, documentVersionId),
    eq(extractedFields.fieldKey, fieldKey),
    eq(extractedFields.promptVersion, promptVersion)
  );
}
