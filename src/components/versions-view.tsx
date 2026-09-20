"use client";

import { useState } from "react";
import { CitationChip, Badge, SecondaryButton, Disclaimer, EmptyState } from "./ui";

interface VersionRow { id: string; label: string; filename: string; status: string; page_count: number | null; created_at: string; is_current: boolean }
interface Change {
  id: string; change_type: string; impact_category: string; is_material: boolean; clause_ref: string | null;
  before_text: string | null; after_text: string | null; business_impact: string; risk_delta: string | null;
  suggested_reviewer_role: string | null; base_citation_id: string | null; target_citation_id: string | null; confidence: number | null;
}
interface Comparison {
  id: string; status: string; material_count: number; cosmetic_count: number; changes: Change[];
  base_version_id: string; target_version_id: string;
}

export function VersionsView({ contractId, versions }: { contractId: string; versions: VersionRow[] }) {
  const [base, setBase] = useState<string>(versions[0]?.id ?? "");
  const [target, setTarget] = useState<string>(versions[1]?.id ?? versions[0]?.id ?? "");
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCosmetic, setShowCosmetic] = useState(false);
  const [polling, setPolling] = useState(false);

  async function runCompare() {
    if (!base || !target || base === target) return;
    setBusy(true);
    const res = await fetch("/api/comparisons", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_version_id: base, target_version_id: target })
    });
    if (!res.ok) { setBusy(false); return; }
    const { comparison_id } = await res.json();
    setPolling(true);
    const poll = setInterval(async () => {
      const r = await fetch(`/api/comparisons/${comparison_id}`);
      if (r.ok) {
        const body: Comparison = await r.json();
        if (body.status === "ready" || body.status === "partial") {
          setCmp(body);
          setBusy(false);
          setPolling(false);
          clearInterval(poll);
        }
      }
    }, 2000);
  }

  if (versions.length === 0) {
    return <EmptyState title="No versions yet" explanation="Upload the first document to start a version history." />;
  }

  const material = cmp?.changes.filter((c) => c.is_material) ?? [];
  const cosmetic = cmp?.changes.filter((c) => !c.is_material) ?? [];

  return (
    <div>
      <div className="panel p-5 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-graphite mb-1" htmlFor="cmp-base">Base version</label>
          <select id="cmp-base" value={base} onChange={(e) => setBase(e.target.value)}
            className="border border-ash rounded-input px-3 py-2 text-sm bg-surface">
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.filename}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-graphite mb-1" htmlFor="cmp-target">Compare with</label>
          <select id="cmp-target" value={target} onChange={(e) => setTarget(e.target.value)}
            className="border border-ash rounded-input px-3 py-2 text-sm bg-surface">
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.filename}</option>)}
          </select>
        </div>
        <button className="rounded-pill bg-lake text-white text-sm px-6 h-10 disabled:bg-periwinkle disabled:text-graphite"
          disabled={busy || base === target} onClick={runCompare}>
          {busy ? "Comparing…" : "Compare"}
        </button>
        {polling && <span className="text-xs text-smoke" role="status">computing…</span>}
      </div>

      <h3 className="mb-3">Version history</h3>
      <div className="panel mb-8">
        {versions.map((v) => (
          <div key={v.id} className="flex items-center gap-4 px-5 py-3 border-b border-ash-soft last:border-0 text-sm">
            <span className="font-medium text-offblack">{v.label}</span>
            <span className="text-graphite">{v.filename}</span>
            <span className="text-xs text-smoke">{v.page_count ? `${v.page_count} pages · ` : ""}{new Date(v.created_at).toLocaleDateString()}</span>
            {v.is_current && <Badge tone="info">current</Badge>}
            <span className="ml-auto"><Badge tone={v.status === "ready" ? "success" : v.status === "failed" ? "critical" : "neutral"}>{v.status}</Badge></span>
          </div>
        ))}
      </div>

      {cmp && (
        <section aria-label="Comparison result">
          <p className="text-sm text-offblack mb-4">
            {cmp.material_count} material change{cmp.material_count === 1 ? "" : "s"} · {cmp.cosmetic_count} formatting change{cmp.cosmetic_count === 1 ? "" : "s"}
          </p>
          {cmp.material_count === 0 && cmp.status === "ready" && (
            <div className="panel p-5 mb-4 bg-success-bg border-success">
              <p className="text-xs text-success">Only formatting changed — no material differences detected.</p>
            </div>
          )}
          <div className="space-y-3">
            {material.map((ch) => (
              <article key={ch.id} className="panel !rounded-panel p-5">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span aria-hidden className="text-high">▲</span>
                  <Badge tone="neutral">{ch.impact_category}</Badge>
                  {ch.clause_ref && <Badge tone="info">§{ch.clause_ref}</Badge>}
                  <Badge tone="info">{ch.change_type}</Badge>
                  {ch.risk_delta === "increased" && <Badge tone="high">risk increased</Badge>}
                  <span className="ml-auto text-xs text-smoke">reviewer: {ch.suggested_reviewer_role ?? "—"}</span>
                </div>
                <p className="text-sm text-offblack mb-3">{ch.business_impact}</p>
                <div className="grid md:grid-cols-2 gap-3">
                  {ch.before_text && (
                    <div className="rounded-input p-3 bg-critical-bg/60 text-[13px] font-mono text-offblack line-through decoration-critical/50">
                      {ch.before_text.slice(0, 300)}
                    </div>
                  )}
                  {ch.after_text && (
                    <div className="rounded-input p-3 bg-success-bg/60 text-[13px] font-mono text-offblack">
                      {ch.after_text.slice(0, 300)}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  {ch.base_citation_id && <CitationChip citation={{ id: ch.base_citation_id, page: 0, section_ref: ch.clause_ref }} />}
                  {ch.target_citation_id && <CitationChip citation={{ id: ch.target_citation_id, page: 0, section_ref: ch.clause_ref }} />}
                  <span className="text-xs text-smoke ml-auto">v2 ▤ / v3 ▤ links open each source</span>
                </div>
              </article>
            ))}
          </div>

          {cosmetic.length > 0 && (
            <div className="mt-4">
              <button className="text-sm text-info underline" onClick={() => setShowCosmetic(!showCosmetic)} aria-expanded={showCosmetic}>
                {showCosmetic ? "hide" : "show"} {cosmetic.length} formatting change{cosmetic.length === 1 ? "" : "s"}
              </button>
              {showCosmetic && (
                <div className="panel mt-2">
                  {cosmetic.map((ch) => (
                    <div key={ch.id} className="px-5 py-2.5 text-xs text-graphite border-b border-ash-soft last:border-0">
                      §{ch.clause_ref ?? "?"} · {ch.change_type} · {ch.business_impact}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
      <Disclaimer />
    </div>
  );
}
