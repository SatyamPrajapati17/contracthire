"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SeverityBadge, StatusBadge, EmptyState, Skeleton, Disclaimer } from "./ui";

interface Row {
  id: string; title: string; obligor: string; obligee: string; due_date: string | null;
  due_date_math: string | null; priority: string; status: string; contract_title: string; contract_id: string;
}

const WINDOWS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "365d", label: "12 months" }
];

export function PortfolioObligationsView() {
  const [window, setWindow] = useState("30d");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    setRows(null);
    fetch(`/api/obligations?window=${window}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setRows(d.data))
      .catch(() => setRows([]));
  }, [window]);

  return (
    <div>
      <div className="flex gap-2 mb-6" role="tablist" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button key={w.key} role="tab" aria-selected={window === w.key} onClick={() => setWindow(w.key)}
            className={`rounded-pill px-5 h-9 text-sm ${window === w.key ? "bg-lake-tint text-lake font-medium" : "text-graphite hover:text-offblack"}`}>
            {w.label}
          </button>
        ))}
      </div>

      {!rows && <Skeleton rows={5} />}
      {rows && rows.length === 0 && (
        <EmptyState title="Nothing due in this window" explanation="Accepted obligations with computed due dates appear here as they approach." />
      )}
      {rows && rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="cl-table">
            <thead>
              <tr><th>Obligation</th><th>Contract</th><th>Parties</th><th>Due</th><th>Priority</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-offblack">{r.title}</td>
                  <td><Link href={`/w/${r.contract_id}/obligations`} className="text-info hover:underline">{r.contract_title}</Link></td>
                  <td className="text-xs text-graphite">{r.obligor === "our_entity" ? "our entity" : r.obligor} → {r.obligee}</td>
                  <td className="num">{r.due_date ?? "—"}</td>
                  <td><SeverityBadge severity={r.priority} /></td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Disclaimer />
    </div>
  );
}
