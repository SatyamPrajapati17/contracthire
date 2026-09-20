import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { documentVersions } from "./contracts-schema";
import { clauses } from "./text-schema";

export const citations = pgTable(
  "citations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    clauseId: text("clause_id"),
    page: integer("page").notNull(),
    sectionRef: text("section_ref"),
    sectionTitle: text("section_title"),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    quotedText: text("quoted_text").notNull(),
    matchConfidence: real("match_confidence").notNull(),
    resolvable: boolean("resolvable").notNull().default(true),
    ocrDerived: boolean("ocr_derived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_citations_dv").on(t.documentVersionId, t.page)]
);

export const extractionKindEnum = ["factual", "interpretation"] as const;
export type ExtractionKind = (typeof extractionKindEnum)[number];

export const validationStatusEnum = [
  "unreviewed", "confirmed", "corrected", "rejected",
  "not_found", "found", "conflicting", "needs_confirmation", "superseded_extraction"
] as const;
export type ValidationStatus = (typeof validationStatusEnum)[number];

export const extractedFields = pgTable(
  "extracted_fields",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contractId: text("contract_id").notNull(),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    fieldGroup: text("field_group").notNull(),
    label: text("label").notNull(),
    valueText: text("value_text"),
    valueNormalized: text("value_normalized"),
    extractionKind: text("extraction_kind").$type<ExtractionKind>().notNull(),
    confidence: real("confidence"),
    validationStatus: text("validation_status").$type<ValidationStatus>().notNull().default("unreviewed"),
    primaryCitationId: text("primary_citation_id"),
    altCitationIds: text("alt_citation_ids").array().notNull().default(sql`'{}'`),
    searchedSections: text("searched_sections").array(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("ef_dv_key_prompt_uq").on(t.documentVersionId, t.fieldKey, t.promptVersion),
    index("idx_ef_contract").on(t.contractId, t.fieldGroup),
    index("idx_ef_review").on(t.workspaceId, t.validationStatus)
  ]
);

export const fieldCorrections = pgTable(
  "field_corrections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    extractedFieldId: text("extracted_field_id").notNull(),
    previousValue: text("previous_value"),
    previousNormalized: text("previous_normalized"),
    newValue: text("new_value"),
    newNormalized: text("new_normalized"),
    reason: text("reason"),
    correctedBy: text("corrected_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_corrections_field").on(t.extractedFieldId, t.createdAt)]
);
