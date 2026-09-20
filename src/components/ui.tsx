"use client";

import Link from "next/link";
import { useState } from "react";

/* ── Severity / status badges: icon + word, never colour alone ────────── */
export function Badge({ tone, children, dashed }: { tone: "critical" | "high" | "medium" | "low" | "success" | "info" | "neutral"; children: React.ReactNode; dashed?: boolean }) {
  const cls: Record<string, string> = {
    critical: "bg-critical-bg text-critical",
    high: "bg-high-bg text-high",
    medium: "bg-medium-bg text-medium",
    low: "bg-low-bg text-low",
    success: "bg-success-bg text-success",
    info: "bg-info-bg text-info",
    neutral: "bg-sunk text-graphite"
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-3 h-6 text-xs font-medium ${cls[tone]} ${dashed ? "border border-dashed border-graphite" : ""}`}>
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const icons: Record<string, string> = { critical: "▲", high: "△", medium: "◆", low: "·" };
  const tone = (["critical", "high", "medium", "low"].includes(severity) ? severity : "low") as "critical";
  return <Badge tone={tone}>{icons[severity] ?? "·"} {severity}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "critical" | "high" | "medium" | "low" | "success" | "info" | "neutral"; icon: string }> = {
    confirmed: { tone: "success", icon: "✓" },
    corrected: { tone: "info", icon: "✎" },
    rejected: { tone: "low", icon: "×" },
    not_found: { tone: "neutral", icon: "—" },
    conflicting: { tone: "high", icon: "⇅" },
    needs_confirmation: { tone: "medium", icon: "?" },
    unreviewed: { tone: "info", icon: "○" },
    suggested: { tone: "info", icon: "◻" },
    active: { tone: "success", icon: "✓" },
    needs_assumption: { tone: "medium", icon: "?" },
    overdue: { tone: "critical", icon: "!" },
    completed: { tone: "success", icon: "✓" },
    rejected_obl: { tone: "low", icon: "×" },
    open: { tone: "high", icon: "△" },
    decided: { tone: "success", icon: "✓" },
    superseded: { tone: "neutral", icon: "↺" }
  };
  const m = map[status] ?? { tone: "neutral" as const, icon: "○" };
  return <Badge tone={m.tone}>{m.icon} {status.replace(/_/g, " ")}</Badge>;
}

/* ── Citation chip: the signature component (doc 05 §3.4) ─────────────── */
export interface CitationData {
  id: string;
  page: number;
  section_ref: string | null;
  resolvable?: boolean;
  ocr_derived?: boolean;
  quoted_text?: string | null;
}

export function CitationChip({ citation, viewerHrefBase }: { citation: CitationData | null; viewerHrefBase?: string }) {
  const [showTip, setShowTip] = useState(false);
  if (!citation) return null;
  const broken = citation.resolvable === false;

  if (broken) {
    return (
      <span
        className="inline-flex items-center rounded-pill px-3 h-[22px] text-xs bg-sunk text-smoke line-through cursor-not-allowed"
        title="source span unavailable — this claim is unverified"
        aria-label="Citation unresolvable — this claim is unverified"
      >
        ▤ p.{citation.page}{citation.section_ref ? ` · §${citation.section_ref}` : ""}
      </span>
    );
  }

  const href = viewerHrefBase ?? `/viewer?cite=${citation.id}`;
  return (
    <span className="relative inline-flex">
      <Link
        href={href}
        className="inline-flex items-center rounded-pill px-3 h-[22px] text-xs bg-info-bg text-info hover:underline"
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
        aria-label={`Open source: page ${citation.page}${citation.section_ref ? `, section ${citation.section_ref}` : ""}`}
      >
        ▤ p.{citation.page}{citation.section_ref ? ` · §${citation.section_ref}` : ""}
        {citation.ocr_derived && <span className="ml-1 text-[10px]" title="text recognised from a scan — verify carefully">ocr</span>}
      </Link>
      {showTip && citation.quoted_text && (
        <span role="tooltip" className="absolute z-20 bottom-7 left-0 max-w-sm p-3 rounded-panel bg-sunk text-[11px] text-offblack border border-ash shadow-floating">
          {citation.quoted_text.slice(0, 120)}{citation.quoted_text.length > 120 ? "…" : ""}
        </span>
      )}
    </span>
  );
}

/* ── Confidence dot + word, never a bare number ───────────────────────── */
export function ConfidenceDot({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined) return null;
  const band = confidence >= 0.85 ? "high" : confidence >= 0.6 ? "medium" : "low";
  const cls = {
    high: "bg-success",
    medium: "bg-medium",
    low: "border-2 border-high bg-transparent"
  }[band];
  const tip = {
    high: "Strong support in the source text. Verify before relying.",
    medium: "Supported but imprecise. Confirm this field.",
    low: "Weak support. This value will not drive deadlines until confirmed."
  }[band];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-graphite" title={tip}>
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} aria-hidden />
      {band === "low" ? "needs confirmation" : `${band} confidence`}
    </span>
  );
}

/* ── Buttons ──────────────────────────────────────────────────────────── */
export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`rounded-pill bg-lake text-white text-sm px-6 min-h-11 inline-flex items-center justify-center gap-2 font-medium hover:bg-lake-hover active:bg-lake-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lake focus-visible:ring-offset-2 disabled:bg-periwinkle disabled:text-graphite disabled:cursor-not-allowed transition-colors ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`rounded-pill border border-ash text-offblack text-sm px-6 min-h-11 inline-flex items-center justify-center gap-2 font-medium hover:border-periwinkle-deep hover:bg-lake-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lake focus-visible:ring-offset-2 disabled:opacity-50 transition-colors ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

export function QuietButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`rounded-pill text-graphite text-sm px-4 h-10 hover:text-offblack disabled:opacity-50 ${props.className ?? ""}`}>
      {children}
    </button>
  );
}

/* ── Standing disclaimer on every AI surface ──────────────────────────── */
export function Disclaimer() {
  return (
    <p className="text-xs text-smoke border-t border-ash-soft pt-3 mt-6">
      AI assistance. Verify before relying. This is not legal advice.
    </p>
  );
}

/* ── Empty / error / degraded states (doc 05 §3.15–3.16) ──────────────── */
export function EmptyState({ title, explanation, action }: { title: string; explanation: string; action?: React.ReactNode }) {
  return (
    <div className="py-16 text-center">
      <h3 className="mb-2">{title}</h3>
      <p className="text-sm text-graphite mb-6 max-w-md mx-auto">{explanation}</p>
      {action}
    </div>
  );
}

export function ErrorState({ what, fix, refId, action }: { what: string; fix: string; refId?: string; action?: React.ReactNode }) {
  return (
    <div className="panel p-6 border-critical" role="alert">
      <p className="text-sm text-critical mb-1">{what}</p>
      <p className="text-xs text-graphite mb-2">{fix}</p>
      {refId && <p className="text-xs text-smoke mb-4 font-mono">ref: {refId}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-input bg-sunk" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  );
}

export function OCRBanner() {
  return (
    <div className="panel p-4 mb-6 bg-medium-bg border-medium" role="status">
      <p className="text-xs text-high">
        ▤ OCR-derived — accuracy reduced. Some pages were read from a scan; verify cited text carefully.
      </p>
    </div>
  );
}
