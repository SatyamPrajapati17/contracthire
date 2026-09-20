"use client";

import { useState } from "react";
import { ButtonSmall } from "@/components/buttons";

/* Export buttons: CSV (always works, downloads a file) and Google Sheets
   (needs the service-account env — the API explains itself if missing).
   Exported sheets carry citations and the not-legal-advice disclaimer. */
export function ExportButtons({ workspaceId, contractId }: { workspaceId: string; contractId?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; url?: string } | null>(null);

  const scope = contractId ? `contract=${contractId}&` : "";

  async function run(format: "csv" | "sheet") {
    setBusy(format);
    setMsg(null);
    try {
      if (format === "csv") {
        // Download directly in this tab; auth cookie rides along.
        window.location.href = `/api/workspaces/${workspaceId}/export?format=csv&${scope}t=${Date.now()}`;
        setMsg({ kind: "ok", text: "CSV download started." });
      } else {
        const res = await fetch(`/api/workspaces/${workspaceId}/sheets`, { method: "POST" });
        const body = (await res.json()) as { exported?: boolean; spreadsheet_url?: string; error?: { message: string; code?: string } };
        if (res.ok && body.exported && body.spreadsheet_url) {
          setMsg({ kind: "ok", text: "Exported to Google Sheets.", url: body.spreadsheet_url });
        } else {
          const notConnected = res.status === 400 || /not connected/i.test(body.error?.message ?? "");
          setMsg({
            kind: "err",
            text: notConnected
              ? "Google Sheets is not connected yet — open Settings → Connections, connect Google and grant Sheets, then retry."
              : body.error?.message ?? `Export failed (${res.status}).`
          });
        }
      }
    } catch {
      setMsg({ kind: "err", text: "Export failed — check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <ButtonSmall type="button" variant="outline" onClick={() => run("csv")} disabled={busy !== null}>
          {busy === "csv" ? "Exporting…" : "Export CSV"}
        </ButtonSmall>
        <ButtonSmall type="button" variant="dark" onClick={() => run("sheet")} disabled={busy !== null}>
          {busy === "sheet" ? "Exporting…" : "Export to Google Sheets"}
        </ButtonSmall>
      </div>
      {msg && (
        <span className={`text-xs ${msg.kind === "ok" ? "text-success" : "text-critical"} max-w-sm text-right`} role="status">
          {msg.text}{" "}
          {msg.url && (
            <a href={msg.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Open sheet ↗
            </a>
          )}
          {msg.kind === "err" && (
            <a href={`/w/${workspaceId}/settings/connections`} className="underline underline-offset-2">
              Open Settings →
            </a>
          )}
        </span>
      )}
    </div>
  );
}
