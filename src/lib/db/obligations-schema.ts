import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  date,
  real,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";
import { documentVersions, contracts } from "./contracts-schema";
import { citations } from "./extraction-schema";
import { users, Role } from "./schema";

export const dueRuleEnum = ["fixed", "relative", "event_triggered", "recurring"] as const;
export type DueRule = (typeof dueRuleEnum)[number];

export const oblStatusEnum = [
  "suggested", "active", "needs_assumption", "snoozed", "completed", "overdue", "rejected", "void"
] as const;
export type OblStatus = (typeof oblStatusEnum)[number];

export const obligations = pgTable(
  "obligations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    sourceVersionId: text("source_version_id").notNull().references(() => documentVersions.id),
    title: text("title").notNull(),
    description: text("description"),
    obligor: text("obligor").notNull(),
    obligee: text("obligee").notNull(),
    triggerText: text("trigger_text"),
    dueRule: text("due_rule").$type<DueRule>().notNull(),
    dueRuleDetail: text("due_rule_detail").notNull(),
    dueDate: date("due_date"),
    dueDateMath: text("due_date_math"),
    recurrenceRrule: text("recurrence_rrule"),
    gracePeriodDays: integer("grace_period_days").notNull().default(0),
    priority: text("priority").notNull().default("medium"),
    riskNote: text("risk_note"),
    status: text("status").$type<OblStatus>().notNull().default("suggested"),
    ownerUserId: text("owner_user_id").references(() => users.id),
    citationId: text("citation_id"),
    confidence: real("confidence"),
    derivedFromFieldIds: text("derived_from_field_ids").array().notNull().default(sql`'{}'`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    evidenceKeys: text("evidence_keys").array().notNull().default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("idx_obl_due").on(t.workspaceId, t.dueDate),
    index("idx_obl_owner").on(t.ownerUserId, t.status),
    index("idx_obl_contract").on(t.contractId, t.status)
  ]
);

export const obligationEvents = pgTable(
  "obligation_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    obligationId: text("obligation_id").notNull(),
    eventType: text("event_type").notNull(),
    actorUserId: text("actor_user_id"),
    payload: text("payload").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("idx_obl_events_obl").on(t.obligationId, t.createdAt)]
);

export const channelEnum = ["in_app", "email", "slack", "teams", "webhook", "calendar"] as const;
export type Channel = (typeof channelEnum)[number];

export const alertSchedules = pgTable(
  "alert_schedules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    obligationId: text("obligation_id").notNull(),
    offsetDays: integer("offset_days").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    recipientUserId: text("recipient_user_id"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    cancelledReason: text("cancelled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("alerts_idem_uq").on(t.obligationId, t.offsetDays, t.channel),
    index("idx_alerts_due").on(t.scheduledFor)
  ]
);

export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    alertScheduleId: text("alert_schedule_id").notNull(),
    attempt: integer("attempt").notNull().default(1),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    status: text("status").notNull(),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull().unique()
  },
  (t) => [index("idx_deliveries_schedule").on(t.alertScheduleId)]
);
