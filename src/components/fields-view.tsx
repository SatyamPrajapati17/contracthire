"use client";

import { useEffect, useState } from "react";
import { CitationChip, ConfidenceDot, StatusBadge, SecondaryButton, Disclaimer, Skeleton } from "./ui";

interface Fact {
  field_id: string; label: string; group: string; key: string;
  value: string | null; confidence: number | null; validation_status: string;
  citation: CitationData | null; alt_citations: CitationData[]; searched_sections: string[] | null;
}
interface CitationData { id: string; page: number; section_ref: string | null; resolvable?: boolean; ocr_derived?: boolean; quoted_text?: string | null }
interface Correction { previous_value: string | null; new_value: string | null; created_at: string; reason: string | null }

export function FieldsView({ contractId, groups }: { contractId: string; groups: string[] }) {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [open, setOpen] = useState<string | null>(groups[0] ?? null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<Correction[]>([]);

  useEffect(() => {
    fetch(`/api/contracts/${contractId}/brief`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setFacts(d.facts))
      .catch(() => setFacts([]));
  }, [contractId]);

  if (!facts) return <Skeleton rows={8} />;

  async function correct(fieldId: string, value: string) {
    if (!value) return;
    await fetch(`/api/fields/${fieldId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value, reason: "Corrected from fields tab" })
    });
    const d = await fetch(`/api/contracts/${contractId}/brief`).then((r) => r.json());
    setFacts(d.facts);
  }

  async function loadHistory(fieldId: string) {
    if (historyFor === fieldId) { setHistoryFor(null); return; }
    const d = await fetch(`/api/fields/${fieldId}/history`).then((r) => r.json());
    setHistory(d.data ?? []);
    setHistoryFor(fieldId);
  }

  return (
    <div>
      {groups.map((g) => {
        const rows = facts.filter((f) => f.group === g);
        if (rows.length === 0) return null;
        const isOpen = open === g;
        return (
          <section key={g} className="mb-4">
            <button
              className="w-full flex items-center justify-between panel !rounded-input px-5 py-3 text-left"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : g)}
            >
              <span className="text-sm font-medium text-offblack">{g}</span>
              <span className="text-xs text-smoke">{rows.length} fields {isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div className="panel mt-1 !rounded-input">
                {rows.map((f) => (
                  <div key={f.field_id} className="px-5 py-3 border-b border-ash-soft last:border-0">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-xs text-graphite w-44 shrink-0">{f.label}</span>
                      {f.validation_status === "not_found" ? (
                        <span className="text-sm flex-1">
                          <span className="rounded px-2 py-0.5 text-xs bg-sunk text-graphite">not found</span>
                          {f.searched_sections && f.searched_sections.length > 0 && (
                            <details className="ml-3 inline">
                              <summary className="text-xs text-info cursor-pointer inline">where we looked</summary>
                              <span className="block text-xs text-smoke mt-1">searched: {f.searched_sections.join(", ")}</span>
                            </details>
                          )}
                        </span>
                      ) : f.validation_status === "conflicting" ? (
                        <span className="text-sm flex-1 flex flex-wrap gap-3">
                          {f.alt_citations.map((c, i) => <span key={i}>⇅ <CitationChip citation={c} /></span>)}
                        </span>
                      ) : (
                        <span className="text-sm text-offblack font-medium flex-1">{f.value ?? "—"}</span>
                      )}
                      <CitationChip citation={f.citation} />
                      <ConfidenceDot confidence={f.confidence} />
                      <StatusBadge status={f.validation_status} />
                      <button className="text-xs text-graphite underline hover:text-offblack"
                        onClick={() => { const v = window.prompt("Corrected value", f.value ?? ""); if (v !== null) correct(f.field_id, v); }}>
                        correct
                      </button>
                      <button className="text-xs text-smoke underline" onClick={() => loadHistory(f.field_id)}>history</button>
                    </div>
                    {historyFor === f.field_id && (
                      <div className="mt-2 pl-44 text-xs text-smoke space-y-1">
                        {history.length === 0 && <p>No corrections recorded.</p>}
                        {history.map((h, i) => (
                          <p key={i}>
                            {h.previous_value ?? "—"} → {h.new_value ?? "—"} · {new Date(h.created_at).toLocaleString()}{h.reason ? ` · ${h.reason}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <Disclaimer />
    </div>
  );
}
