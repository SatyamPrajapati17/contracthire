"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CitationChip, ConfidenceDot, SeverityBadge, StatusBadge, Badge, Disclaimer, ErrorState, Skeleton, SecondaryButton, OCRBanner } from "./ui";

interface Fact {
  field_id: string; key: string; label: string; group: string;
  value: string | null; value_normalized: unknown;
  confidence: number | null; validation_status: string;
  citation: CitationChipData | null;
  alt_citations: CitationChipData[];
  searched_sections: string[] | null;
}
interface CitationChipData {
  id: string; page: number; section_ref: string | null; resolvable?: boolean; ocr_derived?: boolean; quoted_text?: string | null;
}
interface BriefData {
  contract: { id: string; title: string; status: string; current_version_id: string | null };
  facts: Fact[];
  interpretation: { text: string; field_ids: string[]; confidence: number }[];
  open_questions: { question: string; field_ids: string[] }[];
  risks: { id: string; title: string; severity: string; category: string; confidence: number | null; citation_id: string | null; recommended_step: string; status: string }[];
  disclaimer: string;
}

export function BriefView({ contractId, workspaceId }: { contractId: string; workspaceId: string }) {
  const [data, setData] = useState<BriefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/contracts/${contractId}/brief`)
      .then(async (r) => {
        if (!r.ok) throw new Error("failed");
        setData(await r.json());
      })
      .catch(() => setError("Could not load the brief. Retry."));
  };
  useEffect(load, [contractId]);

  if (error) return <ErrorState what="The brief could not be loaded." fix="Retry, or open the document tab to read the source." action={<SecondaryButton onClick={load}>Retry</SecondaryButton>} />;
  if (!data) return <Skeleton rows={6} />;

  const notFoundCount = data.facts.filter((f) => f.validation_status === "not_found").length;
  const conflicting = data.facts.filter((f) => f.validation_status === "conflicting");
  const ocr = data.facts.some((f) => f.citation?.ocr_derived);
  const viewerBase = `/w/${workspaceId}/contracts/${contractId}/viewer`;

  async function correctField(fieldId: string, value: string, normalized: unknown) {
    const res = await fetch(`/api/fields/${fieldId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ value, value_normalized: normalized, reason: "Manual correction from brief" })
    });
    if (res.ok) {
      setEditing(null);
      setFlash(fieldId);
      load();
      setTimeout(() => setFlash(null), 2000);
    }
  }

  return (
    <div>
      {ocr && <OCRBanner />}
      {notFoundCount > 0 && (
        <div className="panel p-4 mb-6 bg-sunk" role="status">
          <p className="text-xs text-graphite">
            {notFoundCount} field{notFoundCount === 1 ? "" : "s"} could not be found in this document — they are marked not found rather than guessed.
          </p>
        </div>
      )}

      {/* ── Band 1: Facts ─────────────────────────────────────────────── */}
      <section aria-labelledby="facts-h" className="mb-10">
        <h3 id="facts-h" className="mb-1">Facts</h3>
        <p className="text-xs text-smoke mb-4">what the document says</p>
        <div className="panel">
          {data.facts.filter((f) => f.validation_status !== "not_found").length === 0 && (
            <p className="p-6 text-sm text-smoke">No fields extracted yet.</p>
          )}
          {data.facts.filter((f) => f.validation_status !== "not_found").map((f) => (
            <div key={f.field_id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-ash-soft last:border-0 ${flash === f.field_id ? "value-flash" : ""}`}>
              <span className="text-xs text-graphite w-48 shrink-0">{f.label}</span>
              {f.validation_status === "conflicting" ? (
                <span className="text-sm text-offblack flex-1 flex gap-4">
                  {f.alt_citations.map((c, i) => (
                    <span key={i}>⇅ reading {i + 1} <CitationChip citation={c} viewerHrefBase={`${viewerBase}?cite=${c.id}`} /></span>
                  ))}
                </span>
              ) : (
                <span className="text-sm text-offblack font-medium flex-1">{f.value ?? "—"}</span>
              )}
              <CitationChip citation={f.citation} viewerHrefBase={f.citation ? `${viewerBase}?cite=${f.citation.id}` : undefined} />
              <ConfidenceDot confidence={f.confidence} />
              <StatusBadge status={f.validation_status} />
              <button className="text-xs text-graphite hover:text-offblack underline" aria-label={`Correct ${f.label}`} onClick={() => setEditing(f.field_id)}>correct</button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Band 2: Interpretation ────────────────────────────────────── */}
      <section aria-labelledby="interp-h" className="mb-10">
        <h3 id="interp-h" className="mb-1">Interpretation</h3>
        <p className="text-xs text-smoke mb-4">what we infer — verify</p>
        <div className="rounded-panel p-6" style={{ background: "color-mix(in srgb, var(--cl-periwinkle) 40%, var(--cl-parchment))", borderLeft: "2px solid var(--cl-periwinkle-deep)" }}>
          {data.interpretation.length === 0 && (
            <p className="text-sm text-graphite">Interpretations will appear here after processing completes.</p>
          )}
          {data.interpretation.map((i, idx) => (
            <p key={idx} className="font-serif text-[17px] leading-7 text-offblack mb-3 max-w-prose">
              {i.text}
              <span className="text-xs text-graphite ml-2 not-italic" title="confidence is a support signal, not a probability">
                ({Math.round((i.confidence ?? 0) * 100)}% support)
              </span>
            </p>
          ))}
        </div>
      </section>

      {/* ── Band 3: Open questions ────────────────────────────────────── */}
      <section aria-labelledby="oq-h" className="mb-10">
        <h3 id="oq-h" className="mb-1">Open questions</h3>
        <p className="text-xs text-smoke mb-4">what we need from you</p>
        <div className="panel border-dashed">
          {data.open_questions.length === 0 && <p className="p-6 text-sm text-smoke">No open questions.</p>}
          {data.open_questions.map((q, idx) => (
            <div key={idx} className="px-5 py-4 border-b border-ash-soft last:border-0 flex items-start gap-3">
              <span aria-hidden className="text-medium">?</span>
              <p className="text-sm text-offblack flex-1">{q.question}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Band 4: Risks ─────────────────────────────────────────────── */}
      <section aria-labelledby="risk-h" className="mb-6">
        <h3 id="risk-h" className="mb-1">Risks</h3>
        <p className="text-xs text-smoke mb-4">what deviates from your playbook</p>
        <div className="panel">
          {data.risks.length === 0 && <p className="p-6 text-sm text-smoke">No flags raised.</p>}
          {data.risks.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-5 py-3 border-b border-ash-soft last:border-0">
              <SeverityBadge severity={r.severity} />
              <span className="text-sm text-offblack flex-1">{r.title}</span>
              <Link href={`/w/${workspaceId}/contracts/${contractId}/risk?flag=${r.id}`} className="text-info text-sm underline">Review</Link>
            </div>
          ))}
        </div>
      </section>

      {conflicting.length > 0 && (
        <div className="panel p-5 mb-6 bg-high-bg border-high">
          <p className="text-xs text-high">{conflicting.length} field(s) have conflicting clauses — both readings are shown with citations. Resolve in the Fields tab.</p>
        </div>
      )}

      {/* Field correction — modal so it's always visible on long pages */}
      {editing && (
        <FieldEditor
          field={data.facts.find((f) => f.field_id === editing) ?? null}
          onCancel={() => setEditing(null)}
          onSave={(v, n) => correctField(editing, v, n)}
        />
      )}

      <Disclaimer />
    </div>
  );
}

function FieldEditor({ field, onCancel, onSave }: {
  field: Fact | null;
  onCancel: () => void;
  onSave: (value: string, normalized: unknown) => void;
}) {
  const [value, setValue] = useState(field?.value ?? "");
  const [reason, setReason] = useState("");
  if (!field) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-graphite/40 p-4" role="dialog" aria-modal="true" aria-label={`Correct ${field.label}`}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="panel p-6 floating w-full max-w-lg">
        <div className="flex items-start justify-between mb-1">
          <h4>Correct {field.label}</h4>
          <button onClick={onCancel} aria-label="Close" className="text-smoke hover:text-offblack text-lg leading-none px-1">×</button>
        </div>
        <p className="text-xs text-smoke mb-4">The old value is kept in history. Dependent obligations and alerts recompute.</p>
        <label className="block text-xs text-graphite mb-1" htmlFor="corr-value">New value</label>
        <input id="corr-value" value={value} onChange={(e) => setValue(e.target.value)}
          className="w-full border border-ash rounded-input px-4 py-2.5 text-sm bg-surface mb-3" />
        <label className="block text-xs text-graphite mb-1" htmlFor="corr-reason">Reason (optional)</label>
        <input id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-full border border-ash rounded-input px-4 py-2.5 text-sm bg-surface mb-4" />
        <div className="flex gap-2">
          <button className="rounded-pill bg-lake text-white text-sm px-5 min-h-11" onClick={() => onSave(value, field.value_normalized)}>Save correction</button>
          <button className="rounded-pill border border-ash text-sm px-5 min-h-11" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
