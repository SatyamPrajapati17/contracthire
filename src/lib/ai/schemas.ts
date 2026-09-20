import { z } from "zod";

const evidenceSchema = z.object({
  page: z.number().int().min(1),
  section_ref: z.string().nullable(),
  section_title: z.string().nullable().optional(),
  char_start: z.number().int().min(0),
  char_end: z.number().int().min(0),
  quoted_text: z.string().min(1)
});

/* ── A1 Intake & classifier ───────────────────────────────────────────── */
export const ClassifyOutput = z.object({
  doc_type: z.enum(["msa", "nda", "sow", "order_form", "lease", "employment", "amendment", "other"]),
  counterparty_guess: z.string().nullable(),
  language: z.string(),
  is_amendment: z.boolean(),
  confidence: z.number().min(0).max(1),
  suspicious_content: z.boolean()
});
export type ClassifyOutputT = z.infer<typeof ClassifyOutput>;

/* ── A4 Extraction ────────────────────────────────────────────────────── */
export const fieldStatus = z.enum(["found", "not_found", "conflicting"]);

export const ExtractedFieldOut = z.object({
  field_key: z.string(),
  label: z.string(),
  status: fieldStatus,
  value_text: z.string().nullable(),
  value_normalized: z.unknown().nullable(),
  extraction_kind: z.enum(["factual", "interpretation"]),
  evidence: z.array(evidenceSchema),
  searched_sections: z.array(z.string()),
  self_confidence: z.number().min(0).max(1),
  notes: z.string().nullable().optional()
});
export type ExtractedFieldOutT = z.infer<typeof ExtractedFieldOut>;

export const ExtractOutput = z.object({
  fields: z.array(ExtractedFieldOut),
  suspicious_content: z.boolean()
});
export type ExtractOutputT = z.infer<typeof ExtractOutput>;

/* ── A5 Obligations ───────────────────────────────────────────────────── */
export const DueRuleDetailOut = z.object({
  anchor: z.string(),
  anchor_value: z.string().nullable(),
  offset_days: z.number().int().nullable(),
  calendar: z.enum(["calendar", "business"]),
  recurrence: z.string().nullable()
});

export const ObligationOut = z.object({
  title: z.string(),
  obligor: z.string(),
  obligee: z.string(),
  description: z.string().nullable(),
  due_rule: z.enum(["fixed", "relative", "event_triggered", "recurring"]),
  due_rule_detail: DueRuleDetailOut,
  anchor_known: z.boolean(),
  grace_period_days: z.number().int().min(0),
  priority: z.enum(["critical", "high", "medium", "low"]),
  extraction_kind: z.enum(["factual", "interpretation"]),
  evidence: z.array(evidenceSchema),
  self_confidence: z.number().min(0).max(1)
});
export type ObligationOutT = z.infer<typeof ObligationOut>;

export const ObligationsOutput = z.object({
  obligations: z.array(ObligationOut),
  suspicious_content: z.boolean()
});
export type ObligationsOutputT = z.infer<typeof ObligationsOutput>;

/* ── A6 Risk ──────────────────────────────────────────────────────────── */
export const RiskFlagOut = z.object({
  flag_type: z.enum(["missing_clause", "ambiguous", "one_sided", "non_standard", "contradiction", "uncapped_liability", "short_notice"]),
  playbook_rule_id: z.string().nullable(),
  category: z.enum(["legal", "finance", "security", "privacy", "procurement", "business"]),
  title: z.string(),
  explanation: z.string(),
  expected_text: z.string().nullable(),
  found_text: z.string().nullable(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  recommended_step: z.string(),
  suggested_reviewer_role: z.enum(["legal", "finance", "security", "privacy", "procurement", "business"]),
  extraction_kind: z.enum(["factual", "interpretation"]),
  evidence: z.array(evidenceSchema),
  self_confidence: z.number().min(0).max(1)
});
export type RiskFlagOutT = z.infer<typeof RiskFlagOut>;

export const RiskOutput = z.object({
  flags: z.array(RiskFlagOut),
  suspicious_content: z.boolean()
});
export type RiskOutputT = z.infer<typeof RiskOutput>;

/* ── A7 Version diff ──────────────────────────────────────────────────── */
export const ComparisonChangeOut = z.object({
  change_type: z.enum(["added", "removed", "modified", "moved"]),
  impact_category: z.enum(["money", "dates", "renewal", "liability", "indemnity", "data_use", "sla", "termination", "obligations", "cosmetic"]),
  is_material: z.boolean(),
  clause_ref: z.string().nullable(),
  before_text: z.string().nullable(),
  after_text: z.string().nullable(),
  business_impact: z.string(),
  risk_delta: z.enum(["increased", "decreased", "unchanged"]),
  suggested_reviewer_role: z.string(),
  evidence: z.array(evidenceSchema),
  self_confidence: z.number().min(0).max(1)
});
export type ComparisonChangeOutT = z.infer<typeof ComparisonChangeOut>;

export const CompareOutput = z.object({
  changes: z.array(ComparisonChangeOut),
  suspicious_content: z.boolean()
});
export type CompareOutputT = z.infer<typeof CompareOutput>;

/* ── A8 Q&A ───────────────────────────────────────────────────────────── */
export const QAOutput = z.object({
  answer_kind: z.enum(["grounded", "refusal_silent", "refusal_conflict", "refusal_out_of_scope", "refusal_permission"]),
  claims: z.array(z.object({
    text: z.string(),
    evidence_ids: z.array(z.string()),
    kind: z.enum(["factual", "interpretation"])
  })),
  follow_up_question: z.string().nullable(),
  self_confidence: z.number().min(0).max(1)
});
export type QAOutputT = z.infer<typeof QAOutput>;

/* ── A9 Brief ─────────────────────────────────────────────────────────── */
export const BriefOutput = z.object({
  interpretation: z.array(z.object({
    text: z.string(),
    field_ids: z.array(z.string()),
    self_confidence: z.number().min(0).max(1)
  })),
  open_questions: z.array(z.object({
    question: z.string(),
    field_ids: z.array(z.string())
  })),
  suspicious_content: z.boolean()
});
export type BriefOutputT = z.infer<typeof BriefOutput>;
