"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Rect { x: number; y: number; w: number; h: number; charStart: number; charEnd: number }
interface ResolveResult {
  page: number; page_count: number; quoted_text: string; resolvable: boolean;
  ocr_derived: boolean; section_ref: string | null; rects: Rect[];
}

/** Citation jump: resolves the span, scrolls, highlights with a double pulse,
 *  then holds a static tint. Esc clears. Reduced motion jumps instantly and
 *  holds the highlight until dismissed (doc 05 §4, US-02). */
export function DocumentViewer({ documentVersionId, versionLabel, initialCitation }: {
  documentVersionId: string;
  versionLabel: string;
  initialCitation: string | null;
}) {
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState("");
  const [ocr, setOcr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ start: number; end: number } | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLSpanElement>(null);

  const loadPage = useCallback(async (p: number) => {
    setError(null);
    const res = await fetch(`/api/document-versions/${documentVersionId}/viewer?page=${p}`);
    if (!res.ok) { setError("This page could not be loaded."); return; }
    const body = await res.json();
    setPageCount(body.page_count ?? 0);
    setPageText(body.text ?? "");
    setOcr(Boolean(body.ocr_derived));
  }, [documentVersionId]);

  useEffect(() => { loadPage(page); }, [page, loadPage]);

  const resolveCitation = useCallback(async (citId: string) => {
    const res = await fetch(`/api/citations/${citId}/resolve`);
    if (!res.ok) {
      setContext("This citation could not be resolved — the source span is unavailable.");
      return;
    }
    const body: ResolveResult = await res.json();
    setContext(body.resolvable
      ? `Cited span — p.${body.page}${body.section_ref ? ` · §${body.section_ref}` : ""}`
      : "Source span unavailable — this claim is unverified. The page is shown but the exact text could not be located.");

    if (!body.resolvable) {
      setPage(body.page);
      return;
    }
    // Convert absolute char span to page-local using the returned rects.
    setPage(body.page);
    if (body.rects.length > 0) {
      const first = body.rects[0];
      const last = body.rects[body.rects.length - 1];
      setHighlight({ start: first.charStart, end: last.charEnd });
    } else {
      // Fall back to searching the page text for the quote.
      const idx = pageText.indexOf(body.quoted_text.slice(0, 60));
      if (idx >= 0) setHighlight({ start: idx, end: idx + body.quoted_text.length });
    }
  }, [pageText]);

  useEffect(() => {
    if (initialCitation) resolveCitation(initialCitation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCitation]);

  // Scroll + pulse after the page text with highlight renders.
  useEffect(() => {
    if (!highlight || !hlRef.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    hlRef.current.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center" });
    if (!reduced) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 1300);
      return () => clearTimeout(t);
    }
  }, [highlight, pageText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setHighlight(null); setContext(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Render text with the highlighted span wrapped.
  let content: React.ReactNode = pageText;
  if (highlight && highlight.start < pageText.length) {
    const start = Math.max(0, highlight.start);
    const end = Math.min(pageText.length, highlight.end);
    content = (
      <>
        {pageText.slice(0, start)}
        <mark ref={hlRef} className={`cite-highlight ${pulsing ? "pulsing" : ""} bg-transparent text-offblack`}>
          {pageText.slice(start, end)}
        </mark>
        {pageText.slice(end)}
      </>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-offblack font-medium">{versionLabel}</span>
        <span className="text-xs text-smoke">page {page} of {pageCount || "…"}</span>
        {ocr && <span className="rounded-pill px-3 h-6 text-xs leading-6 bg-medium-bg text-medium" title="text recognised from a scan — verify carefully">▤ ocr</span>}
        <Link href="?" className="ml-auto text-xs text-smoke hover:underline" onClick={(e) => { e.preventDefault(); setHighlight(null); setContext(null); }}>
          clear highlight
        </Link>
      </div>

      {context && (
        <div className="panel p-4 mb-4 bg-info-bg border-info" role="status">
          <p className="text-xs text-info">{context}</p>
        </div>
      )}
      {error && <div className="panel p-4 mb-4 bg-critical-bg border-critical" role="alert"><p className="text-xs text-critical">{error}</p></div>}

      <div className="flex gap-4">
        <div className="hidden lg:flex flex-col gap-2 w-24 shrink-0" aria-label="Page thumbnails">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`rounded-input border text-xs py-2 ${page === i + 1 ? "border-lake bg-lake-tint text-lake" : "border-ash text-graphite hover:border-periwinkle-deep"}`}>
              p.{i + 1}
            </button>
          ))}
        </div>

        <div ref={textRef} className="flex-1 card !p-8 overflow-y-auto" style={{ maxHeight: "72vh", background: "var(--cl-surface)" }}>
          <div className="font-mono text-[13px] leading-[22px] whitespace-pre-wrap text-offblack max-w-prose">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}
