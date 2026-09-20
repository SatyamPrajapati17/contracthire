"use client";

import { useEffect, useState } from "react";
import { CitationChip, ConfidenceDot, SeverityBadge, StatusBadge, SecondaryButton, Disclaimer, EmptyState, Skeleton } from "./ui";
import { ESignModal, SignatureCard, type SignatureRecord } from "./esign";

interface Flag {
  id: string; title: string; explanation: string; severity: string; category: string;
  confidence: number | null; recommended_step: string; status: string;
  expected_text: string | null; found_text: string | null; citation_id: string | null;
  contract_title?: string; playbook_rule_id: string | null;
}
interface Decision { decision: string; note: string | null; created_at: string; decided_role: string }

export function RiskView({ contractId, initialFlag }: { contractId: string; initialFlag: string | null }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [selected, setSelected] = useState<Flag | null>(null);
  const [note, setNote] = useState("");
  const [decided, setDecided] = useState<string | null>(null);
  const [roleForbidden, setRoleForbidden] = useState(false);
  const [signTarget, setSignTarget] = useState<string | null>(null);
  const [signature, setSignature] = useState<SignatureRecord | null>(null);
  const [myEmail, setMyEmail] = useState("");

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((b: { email?: string } | null) => {
      if (b?.email) setMyEmail(b.email);
    });
  }, []);

  const load = () => {
    const url = contractId ? `/api/contracts/${contractId}/brief` : "/api/risk-flags";
    fetch(url)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setFlags(d.risks ?? d.data ?? []))
      .catch(() => setFlags([]));
  };
  useEffect(load, [contractId]);
  useEffect(() => {
    if (initialFlag && flags) {
      const f = flags.find((x) => x.id === initialFlag);
      if (f) setSelected(f);
    }
  }, [initialFlag, flags]);

  async function decide(decision: string, signature?: SignatureRecord) {
    if (!selected) return;
    const res = await fetch(`/api/risk-flags/${selected.id}/decisions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision,
        note: note || undefined,
        signature: signature ? { method: signature.method, signer: signature.signer, signed_at: signature.signedAt, sig_hash: signature.hash } : undefined
      })
    });
    if (res.status === 403) { setRoleForbidden(true); return; }
    if (res.ok) {
      const body = await res.json();
      setDecided(`${decision.replace(/_/g, " ")} recorded — approval gate: ${body.approval_gate}`);
      setSelected(null);
      setNote("");
      load();
    }
  }

  if (!flags) return <Skeleton rows={4} />;
  if (flags.length === 0) {
    return <EmptyState title="No risk flags" explanation="Flags appear here when the document deviates from the workspace playbook." />;
  }

  return (
    <div>
      {decided && <div className="panel p-4 mb-4 bg-success-bg border-success" role="status"><p className="text-xs text-success">✓ {decided}</p></div>}

      <div className="space-y-3">
        {flags.map((f) => (
          <button key={f.id} onClick={() => { setSelected(f); setRoleForbidden(false); }}
            className="panel !rounded-panel p-5 w-full text-left hover:border-periwinkle-deep transition-colors">
            <div className="flex flex-wrap items-center gap-3">
              <SeverityBadge severity={f.severity} />
              <span className="text-sm font-medium text-offblack flex-1">{f.title}</span>
              <StatusBadge status={f.status} />
            </div>
            <p className="text-xs text-graphite mt-2">{f.category} · {f.contract_title ?? "this contract"}</p>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelected(null)} />
          <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label={`Review ${selected.title}`}>
            <header className="p-6 border-b border-ash-soft flex items-start gap-3">
              <div className="flex-1">
                <SeverityBadge severity={selected.severity} />
                <h3 className="mt-2 mb-0">{selected.title}</h3>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close review drawer"
                className="text-graphite hover:text-offblack text-xl leading-none">×</button>
            </header>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <p className="text-xs text-smoke mb-1">what this means</p>
                <p className="text-sm text-offblack">{selected.explanation}</p>
              </div>
              <div className="flex items-center gap-4">
                <ConfidenceDot confidence={selected.confidence} />
                <span className="text-xs text-graphite">category: {selected.category}</span>
              </div>
              {selected.found_text && (
                <div>
                  <p className="text-xs text-smoke mb-1">exact text cited</p>
                  <blockquote className="panel !rounded-input p-4 bg-sunk text-[13px] text-offblack font-mono">
                    {selected.found_text}
                  </blockquote>
                  <div className="mt-2">{selected.citation_id && <CitationChip citation={{ id: selected.citation_id, page: 0, section_ref: null }} />}</div>
                </div>
              )}
              {selected.expected_text && (
                <div>
                  <p className="text-xs text-smoke mb-1">playbook expectation</p>
                  <p className="text-xs text-graphite">{selected.expected_text}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-smoke mb-1">recommended next step</p>
                <p className="text-sm text-offblack">{selected.recommended_step}</p>
              </div>
              {roleForbidden && (
                <p className="text-xs text-critical" role="alert">Recording a decision requires the Legal Reviewer role.</p>
              )}
              <label className="block text-xs text-graphite" htmlFor="decision-note">Note (optional)</label>
              <textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                className="w-full border border-ash rounded-input px-4 py-2.5 text-sm bg-surface" />
            </div>
            <footer className="p-6 border-t border-ash-soft">
              <p className="text-xs text-smoke mb-3">Decisions are append-only — a new decision adds to the history. Optionally sign electronically.</p>
              {signature && <div className="mb-3"><SignatureCard record={signature} /></div>}
              <button
                onClick={() => setSignTarget(`Risk decision on flag ${selected.title} (${selected.id})`)}
                className="w-full rounded-pill border border-ash text-xs px-3 min-h-9 mb-2 hover:border-periwinkle-deep hover:bg-lake-tint"
              >
                ○ Add e-signature
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="rounded-pill border border-ash text-xs px-3 min-h-10 hover:border-periwinkle-deep" onClick={() => decide("accepted_risk", signature ?? undefined)}>Accept risk</button>
                <button className="rounded-pill border border-high text-high text-xs px-3 min-h-10 hover:bg-high-bg" onClick={() => decide("needs_negotiation", signature ?? undefined)}>Needs negotiation</button>
                <button className="rounded-pill border border-critical text-critical text-xs px-3 min-h-10 hover:bg-critical-bg" onClick={() => decide("escalated", signature ?? undefined)}>Escalate</button>
                <button className="rounded-pill border border-ash text-xs px-3 min-h-10 hover:border-periwinkle-deep" onClick={() => decide("not_a_risk", signature ?? undefined)}>Not a risk</button>
              </div>
            </footer>
          </aside>
        </>
      )}

      {signTarget && (
        <ESignModal
          open
          title="Sign this decision"
          target={signTarget}
          signerEmail={myEmail}
          onClose={() => setSignTarget(null)}
          onSigned={(rec) => { setSignature(rec); setSignTarget(null); }}
        />
      )}

      <Disclaimer />
    </div>
  );
}
