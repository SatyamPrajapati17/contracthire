"use client";

import { useEffect, useState } from "react";

interface ConnState {
  connected: boolean;
  status?: string;
  account_email?: string | null;
  scopes?: string[];
  error_message?: string | null;
}

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export default function ConnectionsPage() {
  const [conn, setConn] = useState<ConnState | null>(null);
  const [mailCfg, setMailCfg] = useState<{ provider: string; from: string; live: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function load() {
    const res = await fetch("/api/connections/google");
    if (res.ok) setConn(await res.json());
    const m = await fetch("/api/settings/test-email");
    if (m.ok) setMailCfg(await m.json());
  }
  useEffect(() => { load(); }, []);

  async function disconnect() {
    if (!confirm("Disconnect Google? OAuth-based Gmail and Sheets exports will stop.")) return;
    setBusy(true);
    await fetch("/api/connections/google", { method: "DELETE" });
    setBusy(false);
    load();
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(testTo.trim() ? { to: testTo.trim() } : {})
      });
      const body = await res.json();
      setTestResult(body.delivered
        ? { ok: true, text: `Delivered to ${body.to} via ${body.provider} — check the inbox (and spam).` }
        : { ok: false, text: `Not delivered (${body.provider}): ${body.error ?? "unknown error"}` });
    } catch {
      setTestResult({ ok: false, text: "Request failed — is the server running?" });
    }
    setTesting(false);
  }

  function connect(purpose: "base" | "gmail" | "sheets") {
    window.location.href = `/api/connections/google/start?purpose=${purpose}`;
  }

  const has = (s: string) => !!conn?.scopes?.includes(s);

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Connected accounts</h1>
        <p className="text-sm opacity-70 mt-1">
          Workspace-level connections. Tokens are encrypted at rest; disconnecting revokes them at Google.
        </p>
      </header>

      {/* Email automation — App-Password SMTP, works without OAuth */}
      <section className="border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Email automation</h2>
            <p className="text-sm opacity-70 mt-0.5">
              Sign-in links &amp; due-date alerts via Gmail SMTP
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full border ${mailCfg?.live ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "opacity-60"}`}>
            {mailCfg ? (mailCfg.live ? `live · ${mailCfg.provider}` : mailCfg.provider) : "…"}
          </span>
        </div>
        {mailCfg?.live && <p className="text-xs opacity-60">Sending as {mailCfg.from}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="Send test to (blank = your email)"
            className="border rounded-full px-4 py-2 text-sm flex-1 min-w-[220px] bg-surface"
          />
          <button onClick={sendTest} disabled={testing}
            className="px-5 py-2 rounded-full bg-lake text-white text-sm hover:bg-lake-hover disabled:opacity-50 transition-colors">
            {testing ? "Sending…" : "Send test email"}
          </button>
        </div>
        {testResult && (
          <p role="status" className={`text-sm ${testResult.ok ? "text-emerald-700" : "text-red-600"}`}>
            {testResult.ok ? "✓ " : "✕ "}{testResult.text}
          </p>
        )}
      </section>

      {/* Google OAuth — Sheets export + API-based Gmail */}
      <section className="border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Google (OAuth)</h2>
            <p className="text-sm opacity-70">
              {conn?.connected
                ? `Connected as ${conn.account_email ?? "unknown account"}`
                : conn?.status === "revoked" ? "Disconnected (revoked)" : "Not connected"}
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full border ${conn?.connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "opacity-60"}`}>
            {conn?.connected ? "connected" : conn?.status ?? "none"}
          </span>
        </div>

        {conn?.error_message && (
          <p className="text-sm text-red-600">Last error: {conn.error_message}</p>
        )}

        {conn?.connected && (
          <ul className="text-sm space-y-1 opacity-80">
            <li>• Gmail API delivery: {has(GMAIL_SCOPE) ? "enabled" : "not granted — optional, SMTP above already sends alerts"}</li>
            <li>• Sheets export: {has(SHEETS_SCOPE) ? "enabled" : "not granted — connect Sheets below"}</li>
          </ul>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          {!conn?.connected && (
            <button onClick={() => connect("base")} disabled={busy}
              className="px-4 py-2 rounded-full border text-sm hover:bg-lake-tint disabled:opacity-50">
              Connect Google
            </button>
          )}
          {conn?.connected && !has(SHEETS_SCOPE) && (
            <button onClick={() => connect("sheets")} disabled={busy}
              className="px-4 py-2 rounded-full border text-sm hover:bg-lake-tint disabled:opacity-50">
              Grant Sheets access
            </button>
          )}
          {conn?.connected && !has(GMAIL_SCOPE) && (
            <button onClick={() => connect("gmail")} disabled={busy}
              title="Optional — alert emails already send via SMTP"
              className="px-4 py-2 rounded-full border text-sm hover:bg-lake-tint disabled:opacity-50">
              Grant Gmail API access
            </button>
          )}
          {conn?.connected && (
            <button onClick={disconnect} disabled={busy}
              className="px-4 py-2 rounded-full border border-red-200 text-red-700 text-sm hover:bg-red-50 disabled:opacity-50">
              Disconnect
            </button>
          )}
        </div>

        <details className="text-xs opacity-70">
          <summary className="cursor-pointer">Seeing “Access blocked: redirect_uri_mismatch”?</summary>
          <p className="mt-2">
            Register these two URLs <em>exactly</em> (no trailing slash) in Google Cloud Console →
            APIs &amp; Services → Credentials → your OAuth client → <strong>Authorized redirect URIs</strong>:
          </p>
          <pre className="mt-1 whitespace-pre-wrap bg-surface rounded-lg p-2">http://localhost:3000/api/auth/signin-google
http://localhost:3000/api/connections/google/callback</pre>
          <p className="mt-1">Also add your Gmail addresses as <strong>Test users</strong> under OAuth consent screen.</p>
        </details>
      </section>

      <p className="text-xs opacity-50">
        Scopes are requested incrementally: Gmail only when you connect Gmail, Sheets only when you
        connect Sheets. Nothing is requested up front.
      </p>
    </div>
  );
}
