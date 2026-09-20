"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STAGE_ORDER = ["scanning", "parsing", "ocr", "segmenting", "extracting", "obligations", "risk", "summarizing", "ready"];
const STAGE_LABELS: Record<string, string> = {
  scanning: "Scanned", parsing: "Parsed", ocr: "OCR", segmenting: "Segmented",
  extracting: "Extracted", obligations: "Obligations", risk: "Risk", summarizing: "Summarised", ready: "Ready"
};

interface StageState { stage: string; status: string; errorMessageSafe?: string | null }

export function UploadPanel({ workspaceId }: { workspaceId: string }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [dvId, setDvId] = useState<string | null>(null);
  const [ctId, setCtId] = useState<string | null>(null);
  const [stages, setStages] = useState<StageState[]>([]);
  const [docStatus, setDocStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ existing_document_version_id: string; contract_id: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (uploading || (dvId && docStatus !== "ready" && docStatus !== "failed")) {
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [uploading, dvId, docStatus]);

  const hashAndUpload = useCallback(async (file: File, existingDv?: string, resolution?: string) => {
    setError(null);
    setUploading(true);
    setUploadPct(0);
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const sha = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

      if (existingDv && resolution) {
        const cres = await fetch(`/api/documents/${existingDv}/complete`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolution, existing_document_version_id: existingDv })
        });
        if (!cres.ok) throw new Error("duplicate resolution failed");
        setDuplicate(null);
        return;
      }

      const init = await fetch("/api/documents", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mime_type: file.type || guessMime(file.name), byte_size: file.size, sha256: sha })
      });

      if (init.status === 409) {
        const body = await init.json();
        setDuplicate(body.error.details);
        setPendingFile(file);
        setUploading(false);
        return;
      }
      if (!init.ok) {
        const body = await init.json().catch(() => ({ error: { message: "upload rejected" } }));
        throw new Error(body.error?.message ?? "upload rejected");
      }

      const { document_version_id, contract_id, upload_url } = await init.json();
      setDvId(document_version_id);
      setCtId(contract_id);

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", upload_url);
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) setUploading(false);
        else { setError("Upload failed — retry."); setUploading(false); }
      };
      xhr.onerror = () => { setError("Upload failed — check your connection and retry."); setUploading(false); };
      xhr.send(await file.arrayBuffer());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setUploading(false);
    }
  }, []);

  // SSE stage stream with polling fallback (doc 03 §3).
  useEffect(() => {
    if (!dvId) return;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(async () => {
        const res = await fetch(`/api/documents/${dvId}/status`);
        if (res.ok) {
          const body = await res.json();
          setStages(body.stages ?? []);
          setDocStatus(body.status);
        }
      }, 3000);
    };

    try {
      es = new EventSource(`/api/stream/documents/${dvId}`);
      es.addEventListener("status", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setStages(data.stages ?? []);
        setDocStatus(data.status);
      });
      es.addEventListener("done", () => { es?.close(); });
      es.onerror = () => { es?.close(); startPolling(); };
    } catch {
      startPolling();
    }
    return () => { es?.close(); if (poll) clearInterval(poll); };
  }, [dvId]);

  const ready = docStatus === "ready";
  const failed = docStatus === "failed";
  const failedStage = stages.find((s) => s.status === "failed");

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) hashAndUpload(f);
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload a contract file"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { const inp = document.getElementById("file-input") as HTMLInputElement | null; inp?.click(); } }}
        className={`border border-dashed rounded-panel p-10 text-center cursor-pointer transition-colors ${dragOver ? "bg-periwinkle border-lake" : "border-ash hover:border-periwinkle-deep"}`}
        onClick={() => { const inp = document.getElementById("file-input") as HTMLInputElement | null; inp?.click(); }}
      >
        <input id="file-input" type="file" accept=".pdf,.docx,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) hashAndUpload(f); }} />
        <p className="text-sm text-offblack mb-1">Drop a contract here, or click to choose a file</p>
        <p className="text-xs text-smoke">PDF, DOCX, or TXT — up to 50 MB and 300 pages</p>
      </div>

      {uploading && (
        <div className="mt-4" aria-live="polite">
          <div className="h-1.5 rounded-pill bg-sunk overflow-hidden">
            <div className="h-full bg-lake transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
          <p className="text-xs text-smoke mt-1">Uploading… {uploadPct}%</p>
        </div>
      )}

      {duplicate && (
        <div className="panel p-5 mt-4" role="dialog" aria-label="Duplicate file detected">
          <p className="text-sm mb-2">This file already exists in the workspace.</p>
          <div className="flex gap-2">
            <button className="rounded-pill bg-lake text-white text-sm px-5 h-9"
              onClick={() => pendingFile && hashAndUpload(pendingFile, duplicate.existing_document_version_id, "link_as_version")}>
              Link as new version
            </button>
            <button className="rounded-pill border border-ash text-sm px-5 h-9"
              onClick={() => pendingFile && hashAndUpload(pendingFile, duplicate.existing_document_version_id, "keep_separate")}>
              Keep as separate contract
            </button>
            <button className="rounded-pill text-smoke text-sm px-5 h-9" onClick={() => { setDuplicate(null); setPendingFile(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-critical text-xs mt-4" role="alert">{error}</p>}

      {(stages.length > 0 || docStatus) && (
        <div className="panel p-5 mt-4" aria-live="polite" aria-label="Processing status">
          <div className="flex items-center gap-2 flex-wrap" role="list">
            {STAGE_ORDER.map((s) => {
              const st = stages.find((x) => x.stage === s);
              const status = s === "ready" ? (ready ? "succeeded" : "pending") : st?.status ?? (docStatus === "ready" ? "succeeded" : "pending");
              const ocrSkipped = s === "ocr" && stages.length > 0 && !stages.some((x) => x.stage === "ocr");
              const shown = ocrSkipped ? "skipped" : status;
              const cls =
                shown === "succeeded" ? "bg-success-bg text-success" :
                shown === "running" ? "bg-info-bg text-info shimmer" :
                shown === "skipped" ? "bg-sunk text-smoke" :
                shown === "failed" ? "bg-critical-bg text-critical" :
                shown === "degraded" ? "bg-medium-bg text-medium" :
                "bg-sunk text-smoke";
              return (
                <span key={s} role="listitem" className={`rounded-pill px-3 h-6 text-xs leading-6 font-medium ${cls}`}>
                  {STAGE_LABELS[s]}{shown === "failed" ? " — failed" : ""}
                </span>
              );
            })}
          </div>
          <p className="text-xs text-smoke mt-3">
            {ready ? `Processed in ${elapsed}s.` : failed ? "Processing failed." : `Processing… ${elapsed}s elapsed. You can leave this page.`}
          </p>
          {failedStage?.errorMessageSafe && (
            <p className="text-xs text-critical mt-1">{failedStage.errorMessageSafe}</p>
          )}
          {failed && failedStage && (
            <button
              className="mt-3 rounded-pill border border-critical text-critical text-sm px-5 h-9"
              onClick={async () => {
                await fetch(`/api/documents/${dvId}/retry`, {
                  method: "POST", headers: { "content-type": "application/json" },
                  body: JSON.stringify({ stage: failedStage.stage })
                });
                setDocStatus("parsing");
              }}
            >
              Retry {failedStage.stage}
            </button>
          )}
          {(ready || failed) && ctId && (
            <a href={`/w/${workspaceId}/contracts/${ctId}/brief`} className="ml-3 text-info text-sm underline">
              {ready ? "Open brief" : "Open contract"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function guessMime(name: string): string {
  if (name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (name.toLowerCase().endsWith(".txt")) return "text/plain";
  if (name.toLowerCase().endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}
