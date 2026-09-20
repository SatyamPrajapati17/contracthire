import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Disclaimer } from "@/components/ui";

export const dynamic = "force-dynamic";

const AGENT_NAMES: Record<string, string> = {
  A1: "Intake", A2: "Parse", A3: "Segment", A4: "Extract", A5: "Obligations",
  A6: "Risk", A7: "Diff", A8: "Retrieval", A9: "Brief", A10: "Notification", A11: "Human review"
};

export default async function ActivityPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this workspace.</main>;
  }

  // Per document: pipeline stages (order, status) + every AI invocation.
  const docs = await db.execute<{
    id: string; title: string; filename: string; status: string; version_label: string;
  }>(sql`
    SELECT dv.id, c.title, dv.filename, dv.status, dv.version_label
    FROM document_versions dv JOIN contracts c ON c.id = dv.contract_id
    WHERE dv.workspace_id = ${workspace}
    ORDER BY dv.created_at DESC LIMIT 30
  `);

  const stages = await db.execute<{
    document_version_id: string; stage: string; status: string; attempt: number;
    model_version: string | null; started_at: string; finished_at: string | null;
  }>(sql`
    SELECT document_version_id, stage, status, attempt, model_version, started_at, finished_at
    FROM processing_stages WHERE workspace_id = ${workspace}
    ORDER BY started_at
  `);

  const invocations = await db.execute<{
    subject_id: string; agent: string; model_version: string; prompt_version: string;
    input_tokens: number | null; output_tokens: number | null; latency_ms: number | null;
    validation_outcome: string; created_at: string;
  }>(sql`
    SELECT subject_id, agent, model_version, prompt_version, input_tokens, output_tokens,
           latency_ms, validation_outcome, created_at
    FROM ai_invocations WHERE workspace_id = ${workspace}
    ORDER BY created_at
  `);

  const stagesBy = new Map<string, typeof stages.rows>();
  for (const s of stages.rows) {
    const list = stagesBy.get(s.document_version_id) ?? [];
    list.push(s);
    stagesBy.set(s.document_version_id, list);
  }
  const invBy = new Map<string, typeof invocations.rows>();
  for (const i of invocations.rows) {
    const list = invBy.get(i.subject_id) ?? [];
    list.push(i);
    invBy.set(i.subject_id, list);
  }

  const badge = (outcome: string) => {
    const color = outcome === "passed" ? "text-emerald-700 bg-emerald-50"
      : outcome === "repaired" ? "text-amber-700 bg-amber-50"
      : outcome === "degraded" ? "text-orange-700 bg-orange-50"
      : "text-red-700 bg-red-50";
    return <span className={`text-[11px] px-2 py-0.5 rounded-full ${color}`}>{outcome}</span>;
  };

  return (
    <AppShell workspaceId={workspace} active="/activity">
      <main id="main" className="flex-1 max-w-5xl mx-auto p-8 space-y-8">
        <header>
          <h1 className="font-serif text-2xl">Agent activity</h1>
          <p className="text-sm text-graphite mt-1">
            What the pipeline actually ran per document — every agent, its latency, model/prompt version,
            and whether its output survived validation. Read-only.
          </p>
        </header>

        {docs.rows.length === 0 ? (
          <EmptyState title="No documents yet" explanation="Upload a contract to see the agent pipeline in action." />
        ) : (
          <div className="space-y-6">
            {docs.rows.map((d) => {
              const docStages = stagesBy.get(d.id) ?? [];
              const docInvs = invBy.get(d.id) ?? [];
              const totalTokens = docInvs.reduce((a, i) => a + (i.input_tokens ?? 0) + (i.output_tokens ?? 0), 0);
              const totalLatency = docInvs.reduce((a, i) => a + (i.latency_ms ?? 0), 0);
              return (
                <section key={d.id} className="border border-ash rounded-card bg-surface p-5 space-y-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <h2 className="font-medium">{d.title} <span className="text-smoke text-sm">· {d.version_label}</span></h2>
                      <p className="text-xs text-smoke">{d.filename} — pipeline status: {d.status}</p>
                    </div>
                    <p className="text-xs text-smoke whitespace-nowrap">
                      {docInvs.length} AI calls · {totalTokens.toLocaleString()} tokens · {(totalLatency / 1000).toFixed(1)}s total
                    </p>
                  </div>

                  {/* Stage chips in run order */}
                  <div className="flex flex-wrap gap-1.5">
                    {docStages.map((s, idx) => (
                      <span key={`${s.stage}-${s.attempt}-${idx}`}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          s.status === "succeeded" ? "border-emerald-200 text-emerald-700"
                          : s.status === "degraded" ? "border-amber-300 text-amber-700"
                          : s.status === "failed" ? "border-red-200 text-red-700"
                          : "border-ash text-graphite"}`}>
                        {s.stage} · {s.status}{s.attempt > 1 ? ` (attempt ${s.attempt})` : ""}
                      </span>
                    ))}
                    {docStages.length === 0 && <span className="text-xs text-smoke">No pipeline stages recorded.</span>}
                  </div>

                  {/* Invocation table */}
                  {docInvs.length > 0 && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-smoke border-b border-ash">
                          <th className="py-1.5 font-medium">Agent</th>
                          <th className="font-medium">Model</th>
                          <th className="font-medium">Prompt</th>
                          <th className="font-medium">Tokens (in/out)</th>
                          <th className="font-medium">Latency</th>
                          <th className="font-medium">Validation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docInvs.map((i, idx) => (
                          <tr key={idx} className="border-b border-ash/60">
                            <td className="py-1.5 font-medium">{AGENT_NAMES[i.agent] ?? i.agent}</td>
                            <td className="text-graphite">{i.model_version}</td>
                            <td className="text-graphite">{i.prompt_version}</td>
                            <td className="text-graphite">{i.input_tokens ?? 0} / {i.output_tokens ?? 0}</td>
                            <td className="text-graphite">{((i.latency_ms ?? 0) / 1000).toFixed(1)}s</td>
                            <td>{badge(i.validation_outcome)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {docInvs.length === 0 && (
                    <p className="text-xs text-smoke">No AI invocations recorded (document may still be processing).</p>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <Disclaimer />
      </main>
    </AppShell>
  );
}
