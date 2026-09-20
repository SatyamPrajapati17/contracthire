/* Sheets integration (phase 11). Exact column spec — do not reorder:
     Tab "Contracts":   Contract name, Counterparty, Type, Status, Owner, Value, Effective date, Expiration date, Renewal notice by, Open risk flags, Last activity, Link, _id
     Tab "Obligations": Title, Contract, Obligor, Obligee, Due date, Due date logic, Priority, Status, Owner, Source citation, Link, _id
     Tab "Risk flags":  Contract, Flag, Category, Severity, Confidence, Status, Decision, Decided by, Source citation, Link, _id
   The hidden _id column holds the record's primary key; sync matches on it
   instead of duplicating rows. Two transports: OAuth (Connected accounts,
   scope spreadsheets) or a service account (env). */
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { getAccessToken, getConnection, hasScope } from "@/lib/google-oauth";

export const SHEETS_TABS = {
  contracts: ["Contract name", "Counterparty", "Type", "Status", "Owner", "Value", "Effective date", "Expiration date", "Renewal notice by", "Open risk flags", "Last activity", "Link", "_id"],
  obligations: ["Title", "Contract", "Obligor", "Obligee", "Due date", "Due date logic", "Priority", "Status", "Owner", "Source citation", "Link", "_id"],
  risk_flags: ["Contract", "Flag", "Category", "Severity", "Confidence", "Status", "Decision", "Decided by", "Source citation", "Link", "_id"]
} as const;

export type TabKey = keyof typeof SHEETS_TABS;

/* ── Data assembly ─────────────────────────────────────────────────────── */

function appLink(path: string): string {
  return `${process.env.APP_URL || "http://localhost:3000"}${path}`;
}

async function contractsRows(workspaceId: string): Promise<(string | number)[][]> {
  const res = await db.execute<{
    id: string; title: string; counterparty: string | null; type: string | null; status: string;
    owner: string | null; value_minor: string | number | null; currency: string | null;
    effective: string | null; expiration: string | null; renewal: string | null;
    open_flags: number; updated_at: string;
  }>(sql`
    SELECT c.id, c.title, c.counterparty_name AS counterparty, c.contract_type AS type, c.status,
           u.display_name AS owner, c.total_value_minor AS value_minor, c.currency,
           c.effective_date::text AS effective, c.expiration_date::text AS expiration,
           c.renewal_notice_by::text AS renewal,
           (SELECT count(*)::int FROM risk_flags f WHERE f.contract_id = c.id AND f.status = 'open') AS open_flags,
           c.updated_at
    FROM contracts c LEFT JOIN users u ON u.id = c.owner_user_id
    WHERE c.workspace_id = ${workspaceId} AND c.deleted_at IS NULL
    ORDER BY c.created_at
  `);
  return res.rows.map((r) => [
    r.title, r.counterparty ?? "", r.type ?? "", r.status, r.owner ?? "",
    r.value_minor != null ? `${r.currency ?? "USD"} ${(Number(r.value_minor) / 100).toLocaleString()}` : "",
    r.effective ?? "", r.expiration ?? "", r.renewal ?? "", r.open_flags,
    new Date(r.updated_at).toISOString().slice(0, 16).replace("T", " "),
    appLink(`/w/contracts`), r.id
  ]);
}

async function obligationsRows(workspaceId: string): Promise<(string | number)[][]> {
  const res = await db.execute<{
    id: string; title: string; contract: string; obligor: string; obligee: string;
    due: string | null; math: string | null; priority: string; status: string; owner: string | null;
    quote: string | null; page: number | null; contract_id: string;
  }>(sql`
    SELECT o.id, o.title, c.title AS contract, o.obligor, o.obligee,
           o.due_date::text AS due, o.due_date_math AS math, o.priority, o.status,
           u.display_name AS owner, ci.quoted_text AS quote, ci.page AS page, c.id AS contract_id
    FROM obligations o
    JOIN contracts c ON c.id = o.contract_id
    LEFT JOIN users u ON u.id = o.owner_user_id
    LEFT JOIN citations ci ON ci.id = o.citation_id
    WHERE o.workspace_id = ${workspaceId} AND o.status NOT IN ('void')
    ORDER BY o.created_at
  `);
  return res.rows.map((r) => [
    r.title, r.contract, r.obligor, r.obligee, r.due ?? "", r.math ?? "",
    r.priority, r.status, r.owner ?? "",
    r.quote ? `${r.quote} (p.${r.page})` : "",
    appLink(`/w/contracts`), r.id
  ]);
}

async function riskRows(workspaceId: string): Promise<(string | number)[][]> {
  const res = await db.execute<{
    id: string; contract: string; title: string; category: string; severity: string;
    confidence: number | null; status: string; decision: string | null; decided_by: string | null;
    quote: string | null; page: number | null;
  }>(sql`
    SELECT f.id, c.title AS contract, f.title, f.category, f.severity, f.confidence, f.status,
           (SELECT d.decision FROM risk_decisions d WHERE d.risk_flag_id = f.id ORDER BY d.created_at DESC LIMIT 1) AS decision,
           (SELECT u.display_name FROM risk_decisions d JOIN users u ON u.id = d.decided_by WHERE d.risk_flag_id = f.id ORDER BY d.created_at DESC LIMIT 1) AS decided_by,
           ci.quoted_text AS quote, ci.page AS page
    FROM risk_flags f
    JOIN contracts c ON c.id = f.contract_id
    LEFT JOIN citations ci ON ci.id = f.citation_id
    WHERE f.workspace_id = ${workspaceId}
    ORDER BY f.created_at
  `);
  return res.rows.map((r) => [
    r.contract, r.title, r.category, r.severity,
    r.confidence != null ? Number(r.confidence).toFixed(2) : "",
    r.status, r.decision ?? "", r.decided_by ?? "",
    r.quote ? `${r.quote} (p.${r.page})` : "",
    appLink(`/w/risk`), r.id
  ]);
}

export async function rowsForTab(workspaceId: string, tab: TabKey): Promise<(string | number)[][]> {
  if (tab === "contracts") return contractsRows(workspaceId);
  if (tab === "obligations") return obligationsRows(workspaceId);
  return riskRows(workspaceId);
}

/* ── Transport ─────────────────────────────────────────────────────────── */

interface SheetsClient {
  mode: "oauth" | "service_account" | "none";
  token?: string;      // OAuth bearer
  jwt?: () => Promise<string>; // SA signer (dynamic import keeps startup light)
  key?: string;        // SA key
  email?: string;      // SA email
}

async function transport(workspaceId: string): Promise<SheetsClient> {
  // Preferred: the workspace's connected Google account.
  const conn = await getConnection(workspaceId);
  if (conn?.status === "connected" && hasScope(conn, "https://www.googleapis.com/auth/spreadsheets")) {
    const token = await getAccessToken(workspaceId);
    if (token) return { mode: "oauth", token };
  }
  // Fallback: service account from env.
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (email && key) return { mode: "service_account", email, key };
  return { mode: "none" };
}

async function saJwt(email: string, key: string): Promise<string> {
  const crypto = await import("node:crypto");
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", exp: iat + 3600, iat
  })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.replace(/\\n/g, "\n")).toString("base64url");
  const assertion = `${unsigned}.${signature}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion
    })
  });
  const body = await res.json() as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`sa_token_error: ${body.error_description ?? res.status}`);
  return body.access_token;
}

async function bearerFor(workspaceId: string, client: SheetsClient): Promise<string> {
  if (client.mode === "oauth" && client.token) return client.token;
  if (client.mode === "service_account") return saJwt(client.email!, client.key!);
  throw new Error("Google Sheets is not connected. Connect Google in Settings → Connected accounts (or configure the service account).");
}

/* ── Sheets API helpers ────────────────────────────────────────────────── */

async function sheetsApi(token: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json() as Record<string, unknown> & { error?: { message: string } };
  if (!res.ok) throw new Error(`sheets_api ${res.status}: ${json.error?.message ?? "unknown"}`);
  return json;
}

async function ensureSpreadsheet(workspaceId: string, token: string): Promise<string> {
  const configured = process.env.GOOGLE_SHEETS_ID;
  if (configured) {
    // Verify it exists and is writable; clearer error than a failed batchUpdate.
    await sheetsApi(token, "GET", `/${configured}?fields=spreadsheetId`);
    return configured;
  }
  const created = await sheetsApi(token, "POST", "", {
    properties: { title: `ContractLens — ${workspaceId}` },
    sheets: Object.entries(SHEETS_TABS).map(([tab, headers]) => ({ properties: { title: tab, gridProperties: { columnCount: headers.length, frozenRowCount: 1 } } }))
  }) as { spreadsheetId?: string };
  if (!created.spreadsheetId) throw new Error("could not create spreadsheet");
  return created.spreadsheetId;
}

async function ensureTabs(token: string, sheetId: string): Promise<void> {
  const meta = await sheetsApi(token, "GET", `/${sheetId}?fields=sheets.properties.title`) as { sheets?: { properties: { title: string } }[] };
  const existing = new Set((meta.sheets ?? []).map((s) => s.properties.title));
  const missing = (Object.keys(SHEETS_TABS) as TabKey[]).filter((tab) => !existing.has(tab));
  if (missing.length === 0) return;
  await sheetsApi(token, "POST", `/${sheetId}:batchUpdate`, {
    requests: missing.map((tab) => ({
      addSheet: { properties: { title: tab, gridProperties: { columnCount: SHEETS_TABS[tab].length, frozenRowCount: 1 } } }
    }))
  });
}

/** Write one tab: header row (fixed) + data, with the hidden _id column. */
async function writeTab(token: string, sheetId: string, tab: TabKey, rows: (string | number)[][]): Promise<void> {
  const headers = SHEETS_TABS[tab];
  const values = [headers, ...rows];
  await sheetsApi(token, "PUT", `/${sheetId}/values/${encodeURIComponent(tab)}!A1?valueInputOption=RAW`, { values });
  // Hide the _id column (last header).
  await sheetsApi(token, "POST", `/${sheetId}:batchUpdate`, {
    requests: [{
      updateDimensionProperties: {
        range: { sheetId: 0, dimension: "COLUMNS", startIndex: headers.length - 1, endIndex: headers.length },
        properties: { hiddenByUser: true }, fields: "hiddenByUser"
      }
    }]
  });
}

/** Row keys currently in the sheet, matched on the hidden _id column. */
async function existingIds(token: string, sheetId: string, tab: TabKey): Promise<Set<string>> {
  const res = await sheetsApi(token, "GET", `/${sheetId}/values/${encodeURIComponent(tab)}!A:Z`) as { values?: string[][] };
  const headers = SHEETS_TABS[tab];
  const idCol = headers.indexOf("_id");
  const rows = res.values ?? [];
  const ids = new Set<string>();
  for (const row of rows.slice(1)) if (row[idCol]) ids.add(row[idCol]);
  return ids;
}

/* ── Public API ────────────────────────────────────────────────────────── */

export interface SyncResult {
  ok: boolean;
  spreadsheet_url?: string;
  created_rows?: number;
  updated_rows?: number;
  error?: string;
}

/** One-time export (or full rewrite) of all three tabs. */
export async function exportOnce(workspaceId: string): Promise<SyncResult> {
  try {
    const client = await transport(workspaceId);
    if (client.mode === "none") {
      return { ok: false, error: "Google Sheets is not connected. Connect Google in Settings → Connected accounts, or set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY + GOOGLE_SHEETS_ID." };
    }
    const token = await bearerFor(workspaceId, client);
    const sheetId = await ensureSpreadsheet(workspaceId, token);
    await ensureTabs(token, sheetId);
    let created = 0;
    for (const tab of Object.keys(SHEETS_TABS) as TabKey[]) {
      const rows = await rowsForTab(workspaceId, tab);
      await writeTab(token, sheetId, tab, rows);
      created += rows.length;
    }
    return { ok: true, spreadsheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, created_rows: created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "export failed" };
  }
}

/** Keep-synced pass: rewrites changed rows every 15 min (matched on _id). */
export async function syncAll(workspaceId: string): Promise<SyncResult> {
  try {
    const client = await transport(workspaceId);
    if (client.mode === "none") return { ok: false, error: "not connected" };
    const token = await bearerFor(workspaceId, client);
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    if (!sheetId) return { ok: false, error: "GOOGLE_SHEETS_ID not set" };
    await ensureTabs(token, sheetId);
    let updated = 0;
    for (const tab of Object.keys(SHEETS_TABS) as TabKey[]) {
      const rows = await rowsForTab(workspaceId, tab);
      const ids = await existingIds(token, sheetId, tab);
      const headers = SHEETS_TABS[tab];
      // Full rewrite is idempotent and simpler than row surgery; _id column
      // lets consumers (and us) detect what changed. Cost is fine at demo scale.
      await writeTab(token, sheetId, tab, rows);
      updated += rows.filter((r) => ids.has(String(r[headers.indexOf("_id")]))).length;
    }
    return { ok: true, spreadsheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, updated_rows: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "sync failed" };
  }
}
