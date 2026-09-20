/* GoogleOAuthPort (phase 9): authorization-code flow with incremental scopes.
   Tokens are encrypted (src/lib/crypto.ts) before touching the database.
   One workspace-level connection per provider, with an owner. */
import { db } from "@/lib/db/client";
import { connectedAccounts } from "@/lib/db/connections-schema";
import { and, eq } from "drizzle-orm";
import { encryptToken, decryptToken } from "@/lib/crypto";

export const GOOGLE_SCOPES = {
  base: ["openid", "email", "profile"],
  // Least-privilege: gmail.send is enough for alert delivery and avoids the
  // heavy review that the full mail.google.com restricted scope triggers.
  gmail: ["https://www.googleapis.com/auth/gmail.send"],
  sheets: ["https://www.googleapis.com/auth/spreadsheets"]
} as const;

export type GooglePurpose = keyof typeof GOOGLE_SCOPES;

export function scopesFor(purpose: GooglePurpose): string[] {
  // Incremental consent: base + only what the purpose needs (deduped).
  return Array.from(new Set([...GOOGLE_SCOPES.base, ...GOOGLE_SCOPES[purpose]]));
}

function oauthEndpoints() {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return {
    authBase: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    redirectUri: `${appUrl}/api/connections/google/callback`
  };
}

/** Signed state (CSRF): random nonce + HMAC under ENCRYPTION_KEY. */
export function makeState(purpose: GooglePurpose): string {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const nonce = crypto.randomBytes(16).toString("hex");
  const mac = crypto.createHmac("sha256", process.env.ENCRYPTION_KEY || "dev-state-key")
    .update(`${nonce}.${purpose}`).digest("hex").slice(0, 32);
  return `${nonce}.${purpose}.${mac}`;
}

export function verifyState(state: string): GooglePurpose | null {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const [nonce, purpose, mac] = state.split(".");
  if (!nonce || !purpose || !mac) return null;
  const expect = crypto.createHmac("sha256", process.env.ENCRYPTION_KEY || "dev-state-key")
    .update(`${nonce}.${purpose}`).digest("hex").slice(0, 32);
  return expect === mac ? (purpose as GooglePurpose) : null;
}

export function authorizeUrl(purpose: GooglePurpose): string {
  const { authBase, redirectUri } = oauthEndpoints();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopesFor(purpose).join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: makeState(purpose)
  });
  return `${authBase}?${params.toString()}`;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenSet> {
  const { tokenUrl } = oauthEndpoints();
  const res = await fetch(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json() as TokenSet & { error?: string; error_description?: string };
  if (!res.ok) throw new Error(`google_token_error: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
  return json;
}

/** Exchange an authorization code, store encrypted tokens on the workspace connection. */
export async function exchangeAndStore(opts: {
  workspaceId: string; ownerUserId: string; code: string; purpose: GooglePurpose;
}): Promise<{ accountEmail: string | null; scopes: string[] }> {
  const { tokenUrl, redirectUri } = oauthEndpoints();
  const tokens = await tokenRequest(new URLSearchParams({
    code: opts.code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  }));

  // Who consented? (id_token sub claims; fall back to tokeninfo)
  let accountEmail: string | null = null;
  try {
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(tokens.access_token)}`);
    if (info.ok) accountEmail = ((await info.json()) as { email?: string }).email ?? null;
  } catch { /* non-fatal */ }

  const granted = (tokens.scope ?? scopesFor(opts.purpose).join(" ")).split(" ").filter(Boolean);
  const existing = (await db.select().from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, opts.workspaceId), eq(connectedAccounts.provider, "google")))
    .limit(1))[0];

  const values = {
    workspaceId: opts.workspaceId,
    provider: "google" as const,
    ownerUserId: opts.ownerUserId,
    scopes: granted,
    accessTokenEnc: encryptToken(tokens.access_token),
    // Google only returns refresh_token on first consent; keep the old one otherwise.
    refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing?.refreshTokenEnc ?? null,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    accountEmail,
    status: "connected" as const,
    errorMessage: null,
    updatedAt: new Date()
  };

  if (existing) {
    await db.update(connectedAccounts).set(values).where(eq(connectedAccounts.id, existing.id));
  } else {
    await db.insert(connectedAccounts).values({ id: `ca_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, ...values });
  }
  return { accountEmail, scopes: granted };
}

/** A fresh access token for the workspace's Google connection, refreshing if needed. */
export async function getAccessToken(workspaceId: string): Promise<string | null> {
  const conn = (await db.select().from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.provider, "google")))
    .limit(1))[0];
  if (!conn || conn.status !== "connected" || !conn.refreshTokenEnc) return null;

  const notExpired = conn.expiresAt && conn.expiresAt.getTime() > Date.now() + 60_000;
  if (notExpired && conn.accessTokenEnc) return decryptToken(conn.accessTokenEnc);

  const { tokenUrl } = oauthEndpoints();
  const tokens = await tokenRequest(new URLSearchParams({
    refresh_token: decryptToken(conn.refreshTokenEnc),
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    grant_type: "refresh_token"
  }));
  await db.update(connectedAccounts).set({
    accessTokenEnc: encryptToken(tokens.access_token),
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    updatedAt: new Date()
  }).where(eq(connectedAccounts.id, conn.id));
  return tokens.access_token;
}

export async function getConnection(workspaceId: string) {
  return (await db.select().from(connectedAccounts)
    .where(and(eq(connectedAccounts.workspaceId, workspaceId), eq(connectedAccounts.provider, "google")))
    .limit(1))[0] ?? null;
}

/** Disconnect: revoke at Google, then mark revoked (tokens stay encrypted/unusable). */
export async function revoke(workspaceId: string): Promise<boolean> {
  const conn = await getConnection(workspaceId);
  if (!conn) return false;
  try {
    if (conn.accessTokenEnc) {
      const { revokeUrl } = oauthEndpoints();
      await fetch(revokeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptToken(conn.accessTokenEnc) })
      });
    }
  } catch { /* mark revoked regardless — the local tokens are discarded */ }
  await db.update(connectedAccounts).set({
    status: "revoked", accessTokenEnc: null, refreshTokenEnc: null, updatedAt: new Date()
  }).where(eq(connectedAccounts.id, conn.id));
  return true;
}

/** Does the workspace connection include this scope? */
export function hasScope(conn: { scopes: string[] } | null, scope: string): boolean {
  return !!conn?.scopes.includes(scope);
}
