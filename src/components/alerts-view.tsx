"use client";

import { useEffect, useState } from "react";
import { CitationChip, Badge, EmptyState, Skeleton } from "./ui";

interface AlertRow {
  id: string; obligation_title: string; contract_title: string; contract_id: string;
  offset_days: number; channel: string; scheduled_for: string; due_date: string | null; status: string;
  page: number | null; section_ref: string | null;
  preview: { recipient: string; channel: string; scheduled_for: string; timezone: string; source_citation: { page: number; section_ref: string | null } | null };
}

const SECTIONS = [
  { key: "needs_action", label: "Needs action" },
  { key: "upcoming", label: "Upcoming (next 90 days)" },
  { key: "sent", label: "Sent" }
];

export function AlertsView() {
  const [section, setSection] = useState("upcoming");
  const [rows, setRows] = useState<AlertRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    fetch(`/api/alerts?section=${section}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setRows(d.data))
      .catch(() => setRows([]));
  }, [section]);

  return (
    <div>
      <div className="flex gap-2 mb-6" role="tablist" aria-label="Alert sections">
        {SECTIONS.map((s) => (
          <button key={s.key} role="tab" aria-selected={section === s.key}
            onClick={() => setSection(s.key)}
            className={`rounded-pill px-5 h-9 text-sm ${section === s.key ? "bg-lake-tint text-lake font-medium" : "text-graphite hover:text-offblack"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {!rows && <Skeleton rows={4} />}
      {rows && rows.length === 0 && (
        <EmptyState
          title="No alerts here"
          explanation="Accept an obligation with a computed due date and reminders are scheduled at 90, 30, 14, 7, and 1 days before it."
        />
      )}
      <div className="space-y-3">
        {rows?.map((a) => (
          <article key={a.id} className="panel !rounded-panel p-5">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <span className="text-sm font-medium text-offblack flex-1">{a.obligation_title}</span>
              <Badge tone={a.status === "sent" ? "success" : a.status === "failed" ? "critical" : "info"}>{a.status}</Badge>
            </div>
            <p className="text-xs text-graphite mb-3">
              {a.contract_title} · {a.offset_days} days before · due {a.due_date ?? "—"}
            </p>
            <div className="panel !rounded-input p-4 bg-sunk">
              <p className="text-xs text-offblack mb-1">
                {a.preview.recipient} · {a.preview.channel} · {new Date(a.preview.scheduled_for).toLocaleString()} {a.preview.timezone}
              </p>
              <p className="text-xs text-smoke">
                source: {a.page ? `p.${a.page}` : "—"}{a.section_ref ? ` · §${a.section_ref}` : ""}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
