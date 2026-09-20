import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  date,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { workspaces, users } from "./schema";

export const contractStatusEnum = [
  "draft", "in_review", "negotiating", "approved", "executed", "active",
  "renewing", "expiring", "expired", "terminated", "archived"
] as const;
export type ContractStatus = (typeof contractStatusEnum)[number];

export const contracts = pgTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contractType: text("contract_type"),
    counterpartyName: text("counterparty_name"),
    ownerUserId: text("owner_user_id").references(() => users.id),
    status: text("status").$type<ContractStatus>().notNull().default("draft"),
    parentContractId: text("parent_contract_id"),
    relationship: text("relationship"),
    currentVersionId: text("current_version_id"),
    currency: text("currency"),
    totalValueMinor: bigint("total_value_minor", { mode: "number" }),
    effectiveDate: date("effective_date"),
    expirationDate: date("expiration_date"),
    renewalNoticeBy: date("renewal_notice_by"),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (t) => [
    index("idx_contracts_ws_status").on(t.workspaceId, t.status),
    index("idx_contracts_ws_expiry").on(t.workspaceId, t.expirationDate),
    index("idx_contracts_ws_notice").on(t.workspaceId, t.renewalNoticeBy)
  ]
);

export const docStatusEnum = [
  "uploaded", "scanning", "parsing", "ocr", "segmenting", "extracting",
  "deriving_obligations", "assessing_risk", "summarizing", "ready", "degraded", "failed", "superseded"
] as const;
export type DocStatus = (typeof docStatusEnum)[number];

export const documentVersions = pgTable(
  "document_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    versionLabel: text("version_label").notNull(),
    versionNumber: integer("version_number").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    pageCount: integer("page_count"),
    language: text("language"),
    storageKey: text("storage_key").notNull(),
    normalizedKey: text("normalized_key"),
    hasOcrPages: boolean("has_ocr_pages").notNull().default(false),
    status: text("status").$type<DocStatus>().notNull().default("uploaded"),
    failureReason: text("failure_reason"),
    uploadedBy: text("uploaded_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_dv_ws_sha").on(t.workspaceId, t.sha256),
    index("idx_dv_contract").on(t.contractId, t.versionNumber)
  ]
);

export const contractParties = pgTable("contract_parties", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  legalName: text("legal_name").notNull(),
  role: text("role"),
  isOurEntity: boolean("is_our_entity").notNull().default(false),
  signatoryName: text("signatory_name"),
  signatoryTitle: text("signatory_title"),
  citationId: text("citation_id")
});
