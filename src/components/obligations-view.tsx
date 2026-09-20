"use client";

import { useEffect, useState } from "react";
import { CitationChip, SeverityBadge, StatusBadge, Badge, SecondaryButton, Disclaimer, EmptyState, Skeleton } from "./ui";

interface Obligation {
  id: string; title: string; description: string | null;
  obligor: string; obligee: string;
  due_rule: string; due_rule_detail: string;
  due_date: string | null; due_date_math: string | null;
  priority: string; status: string; confidence: number | null;
  citation_id: string | null; owner_user_id: string | null;
  source_version_id: string;
}
interface CitationData { id: string; page: number; section_ref: string | null; resolvable?: boolean }

const BANDS = ["overdue", "this week", "this month", "next 90 days", "later", "no date yet"];

function bandOf(ob: Obligation, today: Date): string {
  if (!ob.due_date) return "no date yet";
  const due = new Date(`${ob.due_date}T00:00:00Z`);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 7) return "this week";
  if (days <= 31) return "this month";
  if (days <= 90) return "next 90 days";
  return "later";
}

export function ObligationsView({ contractId }: { contractId: string }) {
  const [obs, setObs] = useState<Obligation[] | null>(null);
  const [cits, setCits] = useState<Record<string, CitationData>>({});
  const [anchorFor, setAnchorFor] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [today] = useState(() => new Date());

  const load = () => {
    fetch(`/api/contracts/${contractId}/obligations`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(async (d) => {
        setObs(d.data);
        const citIds = [...new Set(d.data.map((o: Obligation) => o.citation_id).filter(Boolean))] as string[];
        const map: Record<string, CitationData> = {};
        for (const cid of citIds) {
          const res = await fetch(`/api/citations/${cid}/resolve`).catch(() => null);
          if (res?.ok) {
            const body = await res.json();
            map[cid] = { id: cid, page: body.page, section_ref: body.section_ref, resolvable: body.resolvable };
          } else {
            map[cid] = { id: cid, page: 0, section_ref: null, resolvable: false };
          }
        }
        setCits(map);
      })
      .catch(() => setObs([]));
  };
  useEffect(load, [contractId]);

  async function act(obId: string, action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/obligations/${obId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra })
    });
    if (res.ok) {
      const body = await res.json();
      if (action === "accept") setNote(`Accepted — ${body.alerts_scheduled} alerts scheduled.`);
      load();
    }
  }

  if (!obs) return <Skeleton rows={5} />;
  if (obs.length === 0) {
    return (
      <EmptyState
        title="No obligations yet"
        explanation="Obligations appear here after processing. Deadlines the system could not compute are marked needs assumption and ask you for the missing date."
      />
    );
  }

  const suggested = obs.filter((o) => o.status === "suggested");
  const others = obs.filter((o) => o.status !== "suggested");

  return (
    <div>
      {note && <div className="panel p-4 mb-4 bg-success-bg border-success" role="status"><p className="text-xs text-success">{note}</p></div>}

      <section aria-labelledby="sug-h" className="mb-10">
        <h3 id="sug-h" className="mb-1">Suggested by ContractLens</h3>
        <p className="text-xs text-smoke mb-4">nothing is committed until you accept</p>
        {suggested.length === 0 && <p className="text-sm text-smoke mb-6">No pending suggestions.</p>}
        <div className="space-y-3">
          {suggested.map((ob) => (
            <article key={ob.id} className="panel !rounded-panel p-5 border-dashed">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <SeverityBadge severity={ob.priority} />
                <span className="text-sm font-medium text-offblack flex-1">{ob.title}</span>
                <Badge tone="info" dashed>suggested</Badge>
              </div>
              <p className="text-xs text-graphite mb-2">{ob.obligor === "our_entity" ? "our entity" : ob.obligor} → {ob.obligee}</p>
              {ob.due_date && ob.due_date_math && (
                <p className="text-xs text-graphite mb-2 font-mono">
                  due {ob.due_date} · {ob.due_date_math}
                </p>
              )}
              {ob.status === "needs_assumption" && (
                <p className="text-xs text-medium mb-2">needs assumption — the anchor date is not in the document</p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {ob.citation_id && cits[ob.citation_id] && <CitationChip citation={cits[ob.citation_id]} />}
                <div className="ml-auto flex gap-2">
                  <button className="rounded-pill bg-lake text-white text-xs px-4 h-8" onClick={() => act(ob.id, "accept")}>Accept</button>
                  <button className="rounded-pill border border-ash text-xs px-4 h-8"
                    onClick={() => { const t = window.prompt("Edit title", ob.title); if (t) act(ob.id, "edit", { title: t }); }}>Edit</button>
                  <button className="rounded-pill border border-critical text-critical text-xs px-4 h-8"
                    onClick={() => act(ob.id, "reject")}>Reject</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="tl-h" className="mb-6">
        <h3 id="tl-h" className="mb-1">Timeline</h3>
        <p className="text-xs text-smoke mb-4">grouped by due date</p>
        <div className="space-y-6">
          {BANDS.map((band) => {
            const rows = others.filter((o) => bandOf(o, today) === band && o.status !== "rejected");
            if (rows.length === 0) return null;
            return (
              <div key={band}>
                <p className="text-xs font-medium text-graphite mb-2 sticky top-14 bg-parchment py-1">{band}</p>
                <div className="space-y-2">
                  {rows.map((ob) => (
                    <article key={ob.id} className={`panel !rounded-pill !rounded-lg px-5 py-3 flex flex-wrap items-center gap-3 ${ob.status === "needs_assumption" ? "border-dashed" : ""}`}>
                      <SeverityBadge severity={ob.priority} />
                      <span className="text-sm text-offblack flex-1">{ob.title}</span>
                      {ob.due_date && <span className="text-xs text-graphite">due {ob.due_date}</span>}
                      {ob.due_date_math && <span className="text-xs text-smoke font-mono hidden lg:inline">{ob.due_date_math}</span>}
                      <StatusBadge status={ob.status} />
                      {ob.status === "active" && (
                        <button className="rounded-pill bg-success-bg text-success text-xs px-4 h-8"
                          onClick={async () => {
                            await fetch(`/api/obligations/${ob.id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
                            load();
                          }}>Complete</button>
                      )}
                      {ob.status === "needs_assumption" && (
                        <button className="rounded-pill bg-medium-bg text-medium text-xs px-4 h-8"
                          onClick={() => { setAnchorFor(ob.id); setAnchorDate(""); }}>Supply date</button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {anchorFor && (
        <div className="panel p-6 floating mb-6" role="dialog" aria-label="Supply anchor date">
          <h4 className="mb-1">Supply the missing date</h4>
          <p className="text-xs text-graphite mb-4">
            The document does not state the anchor date for this obligation, so no due date was computed. Provide the date and the arithmetic will be shown.
          </p>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)}
            className="border border-ash rounded-input px-4 py-2.5 text-sm bg-surface mb-4" aria-label="Anchor date" />
          <div className="flex gap-2">
            <button className="rounded-pill bg-lake text-white text-sm px-5 h-9" disabled={!anchorDate}
              onClick={async () => { await act(anchorFor, "supply_anchor", { anchor_date: anchorDate }); setAnchorFor(null); }}>
              Save date
            </button>
            <SecondaryButton onClick={() => setAnchorFor(null)}>Cancel</SecondaryButton>
          </div>
        </div>
      )}

      <Disclaimer />
    </div>
  );
}
