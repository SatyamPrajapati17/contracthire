import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigserial,
  real,
  index,
  uniqueIndex,
  customType
} from "drizzle-orm/pg-core";
import { documentVersions } from "./contracts-schema";

/** pgvector column: vector(2048) — nvidia/nemotron-3-embed-1b native dim (truncation would distort cosine) */
export const vectorType = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(2048)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value.slice(1, -1).split(",").map(Number);
  }
});

export const parsedPages = pgTable(
  "parsed_pages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    text: text("text").notNull(),
    ocrDerived: boolean("ocr_derived").notNull().default(false),
    ocrConfidence: real("ocr_confidence"),
    renderKey: text("render_key")
  },
  (t) => [uniqueIndex("parsed_pages_dv_page_uq").on(t.documentVersionId, t.pageNumber)]
);

export const textLayout = pgTable(
  "text_layout",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    w: real("w").notNull(),
    h: real("h").notNull()
  },
  (t) => [index("idx_layout_lookup").on(t.documentVersionId, t.pageNumber, t.charStart)]
);

export const clauses = pgTable(
  "clauses",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    sectionRef: text("section_ref"),
    sectionTitle: text("section_title"),
    depth: integer("depth").notNull().default(1),
    parentClauseId: text("parent_clause_id"),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    clauseType: text("clause_type"),
    text: text("text").notNull()
  },
  (s) => [
    index("idx_clauses_dv").on(s.documentVersionId, s.charStart),
    index("idx_clauses_type").on(s.workspaceId, s.clauseType)
  ]
);

export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contractId: text("contract_id").notNull(),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id, { onDelete: "cascade" }),
    clauseId: text("clause_id"),
    seq: integer("seq").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    sectionRef: text("section_ref"),
    ocrDerived: boolean("ocr_derived").notNull().default(false),
    tokenCount: integer("token_count"),
    text: text("text").notNull(),
    embedding: vectorType("embedding")
  },
  (t) => [
    index("idx_chunks_vec").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("idx_chunks_fts").using("gin", sql`to_tsvector('english', ${t.text})`),
    index("idx_chunks_scope").on(t.workspaceId, t.documentVersionId)
  ]
);
