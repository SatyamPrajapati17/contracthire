/* ═══════════════════════ SheetsPort ═════════════════════════════════════
   Export workspace data to Google Sheets behind a port. Providers:
     google — Sheets API v4 with a SERVICE ACCOUNT (GOOGLE_SERVICE_ACCOUNT_EMAIL
              + GOOGLE_PRIVATE_KEY + optional GOOGLE_SHEETS_ID). Service accounts
              need no browser redirect; share the target sheet with the service
              account's email as Editor.
     csv    — zero-setup fallback: the export route streams a downloadable CSV.

   Used by: GET /api/workspaces/[id]/export?format=sheet|csv (fields, obligations,
   risk flags) so ops can drop contract data straight into a tracking sheet.
   ═══════════════════════════════════════════════════════════════════════ */

import { createSign } from "node:crypto";

export interface SheetRange {
  sheetName: string;
  values: (string | number | null)[][];
}

export interface SheetsPort {
  readonly provider: string;
  /** Appends (or creates + writes) the given ranges. Returns the spreadsheet URL. */
  writeRanges(ranges: SheetRange[], spreadsheetId?: string): Promise<{ spreadsheetId: string; url: string }>;
}

/* ── Google service-account flow (no redirect URL needed) ─────────────── */

interface TokenCache { token: string; exp: number }
let cachedToken: TokenCache | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function serviceAccountAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY are required for format=sheet");
  const key = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!res.ok) throw new Error(`google_token_error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return cachedToken.token;
}

function googleSheets(): SheetsPort {
  return {
    provider: "google",
    async writeRanges(ranges, spreadsheetId) {
      const token = await serviceAccountAccessToken();
      let ssId = spreadsheetId || process.env.GOOGLE_SHEETS_ID || "";
      if (!ssId) {
        const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ properties: { title: "ContractLens Export" } })
        });
        if (!createRes.ok) throw new Error(`sheets_create_error ${createRes.status}: ${(await createRes.text()).slice(0, 200)}`);
        const created = (await createRes.json()) as { spreadsheetId: string; spreadsheetUrl: string };
        ssId = created.spreadsheetId;
      }
      // Batch-clear then write each range so re-exports replace, not duplicate.
      const clearRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values:batchClear`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ ranges: ranges.map((r) => r.sheetName) })
        }
      );
      if (!clearRes.ok && clearRes.status !== 400) {
        throw new Error(`sheets_clear_error ${clearRes.status}: ${(await clearRes.text()).slice(0, 200)}`);
      }
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values:batchUpdate`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: ranges.map((r) => ({ range: r.sheetName, values: r.values }))
        })
      }).then(async (res) => {
        if (!res.ok) throw new Error(`sheets_write_error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      });
      return { spreadsheetId: ssId, url: `https://docs.google.com/spreadsheets/d/${ssId}/edit` };
    }
  };
}

function csvSheets(): SheetsPort {
  return {
    provider: "csv",
    async writeRanges() {
      throw new Error("csv provider streams directly from the export route — use format=csv");
    }
  };
}

let cachedSheets: SheetsPort | null = null;
export function sheets(): SheetsPort {
  if (cachedSheets) return cachedSheets;
  const provider = (process.env.SHEETS_PROVIDER || "csv").toLowerCase();
  cachedSheets = provider === "google" ? googleSheets() : csvSheets();
  return cachedSheets;
}

/* ── Export data mapping ───────────────────────────────────────────────── */

export function toCsv(ranges: SheetRange[]): string {
  const out: string[] = [];
  for (const r of ranges) {
    out.push(`# ${r.sheetName}`);
    for (const row of r.values) {
      out.push(row.map((c) => {
        const s = c === null || c === undefined ? "" : String(c);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","));
    }
    out.push("");
  }
  return out.join("\n");
}
