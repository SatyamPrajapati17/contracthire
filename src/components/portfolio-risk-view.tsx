"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SeverityBadge, StatusBadge, EmptyState, Skeleton, Disclaimer } from "./ui";

interface Flag {
  id: string; title: string; severity: string; category: string; status: string;
  contract_title: string; contract_id: string; confidence: number | null; created_at: string;
}

export function PortfolioRiskView() {
  const [flags, setFlags] = useState<Flag[] | null>(null);

  useEffect(() => {
    fetch("/api/risk-flags")
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setFlags(d.data))
      .catch(() => setFlags([]));
  }, []);

  if (!flags) return <Skeleton rows={6} />;
  if (flags.length === 0) {
    return <EmptyState title="Queue is clear" explanation="No flags are waiting for review. Flags appear when processed contracts deviate from the playbook." />;
  }

  const order = ["critical", "high", "medium", "low"];
  const groups = order.map((sev) => ({ sev, rows: flags.filter((f) => f.severity === sev) })).filter((g) => g.rows.length > 0);

  return (
    <div>
      {groups.map((g) => (
        <section key={g.sev} className="mb-8" aria-label={`${g.sev} severity flags`}>
          <h3 className="mb-3 flex items-center gap-3"><SeverityBadge severity={g.sev} /> <span className="text-sm text-smoke font-normal">{g.rows.length} open</span></h3>
          <div className="panel">
            {g.rows.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-ash-soft last:border-0">
                <span className="text-sm text-offblack flex-1">{f.title}</span>
                <span className="text-xs text-graphite">{f.contract_title}</span>
                <StatusBadge status={f.status} />
                <Link href={`/w/${f.contract_id}/risk?flag=${f.id}`} className="text-info text-sm underline">Review</Link>
              </div>
            ))}
          </div>
        </section>
      ))}
      <Disclaimer />
    </div>
  );
}
