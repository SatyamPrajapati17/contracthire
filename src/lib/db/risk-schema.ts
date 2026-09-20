import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  bigserial,
  boolean,
  real,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { contracts, documentVersions } from "./contracts-schema";
import { citations } from "./extraction-schema";
import { users, Role } from "./schema";

export const playbookRules = pgTable("playbook_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  clauseType: text("clause_type").notNull(),
  ruleName: text("rule_name").notNull(),
  expectation: text("expectation").notNull(),
  evaluator: text("evaluator").notNull(),
  outcomeIfViolated: text("outcome_if_violated").notNull(),
  reviewerRole: text("reviewer_role").notNull(),
  severity: text("severity").notNull(),
  active: boolean("active").notNull().default(true)
});

export const flagStatusEnum = ["open", "in_review", "decided", "superseded", "reopened"] as const;
export type FlagStatus = (typeof flagStatusEnum)[number];

export const riskFlags = pgTable(
  "risk_flags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    documentVersionId: text("document_version_id").notNull().references(() => documentVersions.id),
    playbookRuleId: text("playbook_rule_id"),
    category: text("category").notNull(),
    flagType: text("flag_type").notNull(),
    title: text("title").notNull(),
    explanation: text("explanation").notNull(),
    expectedText: text("expected_text"),
    foundText: text("found_text"),
    severity: text("severity").notNull(),
    confidence: real("confidence"),
    recommendedStep: text("recommended_step").notNull(),
    suggestedReviewerRole: text("suggested_reviewer_role"),
    citationId: text("citation_id"),
    status: text("status").$type<FlagStatus>().notNull().default("open"),
    supersededBy: text("superseded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_flags_queue").on(t.workspaceId, t.status, t.severity, t.createdAt)]
);

export const riskDecisions = pgTable(
  "risk_decisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    riskFlagId: text("risk_flag_id").notNull(),
    decision: text("decision").notNull(),
    note: text("note"),
    decidedBy: text("decided_by").notNull(),
    decidedRole: text("decided_role").$type<Role>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_risk_decisions_flag").on(t.riskFlagId, t.createdAt)]
);

export const comparisons = pgTable(
  "comparisons",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    baseVersionId: text("base_version_id").notNull(),
    targetVersionId: text("target_version_id").notNull(),
    status: text("status").notNull().default("computing"),
    materialCount: integer("material_count").notNull().default(0),
    cosmeticCount: integer("cosmetic_count").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("comparisons_pair_uq").on(t.baseVersionId, t.targetVersionId)]
);

export const comparisonChanges = pgTable(
  "comparison_changes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    comparisonId: text("comparison_id").notNull(),
    changeType: text("change_type").notNull(),
    impactCategory: text("impact_category").notNull(),
    isMaterial: boolean("is_material").notNull(),
    clauseRef: text("clause_ref"),
    beforeText: text("before_text"),
    afterText: text("after_text"),
    businessImpact: text("business_impact").notNull(),
    riskDelta: text("risk_delta"),
    suggestedReviewerRole: text("suggested_reviewer_role"),
    baseCitationId: text("base_citation_id"),
    targetCitationId: text("target_citation_id"),
    confidence: real("confidence")
  },
  (t) => [index("idx_changes_material").on(t.comparisonId, t.isMaterial, t.impactCategory)]
);

export const chatSessions = pgTable("chat_sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  contractId: text("contract_id"),
  scope: text("scope").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    answerKind: text("answer_kind"),
    confidence: real("confidence"),
    citationIds: text("citation_ids").array().notNull().default(sql`'{}'`),
    evidence: text("evidence"),
    feedback: text("feedback"),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_chat_session").on(t.sessionId, t.createdAt)]
);

export const processingStages = pgTable(
  "processing_stages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    documentVersionId: text("document_version_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessageSafe: text("error_message_safe"),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version")
  },
  (t) => [uniqueIndex("stages_dv_stage_attempt_uq").on(t.documentVersionId, t.stage, t.attempt)]
);

export const aiInvocations = pgTable(
  "ai_invocations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    agent: text("agent").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    costUsd: text("cost_usd"),
    validationOutcome: text("validation_outcome").notNull()
  },
  (t) => [index("idx_ai_cost").on(t.workspaceId)]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actorUserId: text("actor_user_id"),
    actorRole: text("actor_role").$type<Role>(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    beforeHash: text("before_hash"),
    afterHash: text("after_hash"),
    metadata: text("metadata").notNull().default("{}"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_audit_ws_time").on(t.workspaceId, t.createdAt),
    index("idx_audit_resource").on(t.resourceType, t.resourceId)
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    alertScheduleId: text("alert_schedule_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_notifications_user").on(t.userId, t.readAt)]
);
