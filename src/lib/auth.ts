import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db } from "./db/client";
import { users, sessions, memberships, magicTokens } from "./db/schema";
import { id, hashToken, randomToken, type IdKind } from "./ids";

export const SESSION_COOKIE = "cl_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes

export type Role = "workspace_admin" | "legal_reviewer" | "contract_owner" | "contributor" | "viewer" | "external_signer";

export interface Ctx {
  userId: string;
  email: string;
  workspaceId: string;
  role: Role;
}

/** Dev magic link: create a token, print the verify URL to the console. */
export async function createMagicLink(email: string): Promise<string> {
  email = email.trim().toLowerCase();
  const token = randomToken(32);
  await db.insert(magicTokens).values({
    id: id("tok"),
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS)
  });
  const url = `${process.env.APP_URL || "http://localhost:3000"}/api/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;
  // NFR: dev-only transport — printed to console instead of email
  console.log("\n──────────────────────────────────────────────");
  console.log(`  Magic link for ${email}:`);
  console.log(`  ${url}`);
  console.log("──────────────────────────────────────────────\n");
  return url;
}

export async function consumeMagicToken(token: string): Promise<{ userId: string; email: string } | null> {
  const rows = await db.select().from(magicTokens).where(eq(magicTokens.tokenHash, hashToken(token))).limit(1);
  const row = rows[0];
  if (!row || row.consumedAt || row.expiresAt.getTime() < Date.now()) return null;
  await db.update(magicTokens).set({ consumedAt: new Date() }).where(eq(magicTokens.id, row.id));

  const existing = await db.select().from(users).where(eq(users.email, row.email)).limit(1);
  let user = existing[0];
  if (!user) {
    const created = await db.insert(users).values({ id: id("usr"), email: row.email }).returning();
    user = created[0];
  }
  return { userId: user.id, email: user.email };
}

export async function createSession(userId: string): Promise<string> {
  const sid = id("ses");
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS)
  });
  return sid;
}

/** Resolve the current request context (user + active workspace + role). */
export async function getCtx(): Promise<Ctx | null> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  let workspaceId = row.s.workspaceId;
  let role: Role | null = null;
  if (workspaceId) {
    const mem = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, row.u.id), eq(memberships.workspaceId, workspaceId)))
      .limit(1);
    role = (mem[0]?.role as Role) ?? null;
    if (!role) workspaceId = null;
  }
  if (!workspaceId || !role) {
    const first = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, row.u.id))
      .limit(1);
    if (first[0]) {
      workspaceId = first[0].workspaceId;
      role = first[0].role as Role;
    }
  }

  return { userId: row.u.id, email: row.u.email, workspaceId: workspaceId as string, role: role as Role };
}

const RANK: Record<Role, number> = {
  external_signer: 0,
  viewer: 1,
  contributor: 2,
  contract_owner: 3,
  legal_reviewer: 4,
  workspace_admin: 5
};

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function canUpload(role: Role) { return atLeast(role, "contributor"); }
export function canEdit(role: Role) { return atLeast(role, "contributor"); }
export function canDecideRisk(role: Role) { return role === "legal_reviewer" || role === "workspace_admin"; }
export function canApprove(role: Role) { return role === "legal_reviewer" || role === "workspace_admin"; }
export function canManageMembers(role: Role) { return role === "workspace_admin"; }
export function canReadAudit(role: Role) { return role === "workspace_admin" || role === "legal_reviewer"; }

/** Foreign-workspace reads return 404, never 403 — existence is not disclosed. */
export const FOREIGN_WORKSPACE_STATUS = 404;
