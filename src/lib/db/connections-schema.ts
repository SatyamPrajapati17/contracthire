import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { workspaces, users } from "./schema";

/** Workspace-level OAuth connections (phase 9). Tokens encrypted at rest. */
export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"google">().notNull(),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    scopes: text("scopes").array().notNull().default([]),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    accountEmail: text("account_email"),
    status: text("status").$type<"connected" | "revoked" | "error">().notNull().default("connected"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("connected_accounts_ws_provider_uq").on(t.workspaceId, t.provider),
    index("idx_connected_accounts_ws").on(t.workspaceId, t.provider)
  ]
);
