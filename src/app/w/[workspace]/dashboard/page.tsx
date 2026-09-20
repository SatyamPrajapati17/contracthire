import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PrimaryButton, Disclaimer } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";

export default async function Dashboard({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this workspace.</main>;
  }

  const counts = await db.execute<{
    needs_attention: number; renewals_90: number; overdue: number; high_risk_open: number; processing_errors: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM contracts WHERE workspace_id = ${workspace} AND status = 'in_review' AND deleted_at IS NULL) AS needs_attention,
      (SELECT count(*)::int FROM contracts WHERE workspace_id = ${workspace} AND renewal_notice_by IS NOT NULL AND renewal_notice_by <= CURRENT_DATE + INTERVAL '90 days' AND renewal_notice_by >= CURRENT_DATE AND deleted_at IS NULL) AS renewals_90,
      (SELECT count(*)::int FROM obligations WHERE workspace_id = ${workspace} AND status = 'overdue') AS overdue,
      (SELECT count(*)::int FROM risk_flags WHERE workspace_id = ${workspace} AND status = 'open' AND severity IN ('critical','high')) AS high_risk_open,
      (SELECT count(*)::int FROM document_versions WHERE workspace_id = ${workspace} AND status = 'failed') AS processing_errors
  `);
  const c = counts.rows[0];

  const recent = await db.execute<{ action: string; resource_type: string; resource_id: string; created_at: string; actorEmail: string | null }>(sql`
    SELECT a.action, a.resource_type, a.resource_id, a.created_at, u.email AS "actorEmail"
    FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.workspace_id = ${workspace}
    ORDER BY a.created_at DESC LIMIT 8
  `);

  const contractCount = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM contracts WHERE workspace_id = ${workspace} AND deleted_at IS NULL
  `);
  const isEmpty = (contractCount.rows[0]?.n ?? 0) === 0;

  const cards = [
    { label: "Needs attention", value: c?.needs_attention ?? 0, href: `${workspace}/contracts?status=in_review` },
    { label: "Renewals in 90 days", value: c?.renewals_90 ?? 0, href: `${workspace}/contracts` },
    { label: "Overdue obligations", value: c?.overdue ?? 0, href: `${workspace}/obligations` },
    { label: "High-risk clauses open", value: c?.high_risk_open ?? 0, href: `${workspace}/risk` },
    { label: "Processing errors", value: c?.processing_errors ?? 0, href: `${workspace}/contracts` }
  ];

  return (
    <AppShell workspaceId={workspace} active="/dashboard">
      <div className="flex items-baseline justify-between mb-8">
        <h2>Dashboard</h2>
        <div className="flex items-center gap-3">
          <ExportButtons workspaceId={workspace} />
          <Link href={`/w/${workspace}/contracts?upload=1`}>
            <PrimaryButton>Upload contract</PrimaryButton>
          </Link>
        </div>
      </div>

      {isEmpty ? (
        <EmptyState
          title="No contracts yet"
          explanation="Upload an agreement and ContractLens will extract its terms, obligations, and deadlines — each one cited to the source text."
          action={<Link href={`/w/${workspace}/contracts?upload=1`}><PrimaryButton>Upload your first contract</PrimaryButton></Link>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-10">
            {cards.map((card, i) => (
              <Link key={card.label} href={`/${card.href}`}
                className="card-enter card !p-6 hover:border-periwinkle-deep transition-colors"
                style={{ animationDelay: `${i * 40}ms` }}>
                <p className="text-3xl font-serif text-ink mb-1">{card.value}</p>
                <p className="text-xs text-graphite">{card.label}</p>
              </Link>
            ))}
          </div>

          <section aria-label="Recent activity">
            <h3 className="mb-4">Recent activity</h3>
            <div className="panel divide-y divide-ash-soft">
              {recent.rows.length === 0 && <p className="p-6 text-sm text-smoke">Nothing yet.</p>}
              {recent.rows.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3 text-xs">
                  <span className="text-offblack">{r.action}</span>
                  <span className="text-smoke">{r.resource_type}</span>
                  <span className="text-smoke ml-auto">{r.actorEmail ?? "system"} · {new Date(r.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </section>
          <Disclaimer />
        </>
      )}
    </AppShell>
  );
}
