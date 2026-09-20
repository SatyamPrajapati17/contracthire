import Link from "next/link";
import { getCtx, canUpload } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { UploadPanel } from "@/components/upload-panel";
import { Badge, EmptyState, SeverityBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ContractsPage({
  params, searchParams
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { workspace } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this workspace.</main>;
  }

  const conditions = [eq(contracts.workspaceId, workspace), isNull(contracts.deletedAt)];
  if (sp.status) conditions.push(eq(contracts.status, sp.status as "draft"));
  if (sp.q) {
    conditions.push(sql`to_tsvector('english', coalesce(${contracts.title},'') || ' ' || coalesce(${contracts.counterpartyName},'')) @@ websearch_to_tsquery('english', ${sp.q})`);
  }
  const rows = await db.select().from(contracts).where(and(...conditions)).orderBy(desc(contracts.updatedAt)).limit(100);

  const flagsByCt = await db.execute<{ contract_id: string; sev: string; n: number }>(sql`
    SELECT contract_id, max(severity) AS sev, count(*)::int AS n
    FROM risk_flags WHERE workspace_id = ${workspace} AND status = 'open'
    GROUP BY contract_id
  `);
  const flagMap = new Map(flagsByCt.rows.map((r) => [r.contract_id, r]));

  const showUpload = sp.upload === "1" && canUpload(ctx.role);

  return (
    <AppShell workspaceId={workspace} active="/contracts">
      <div className="flex items-baseline justify-between mb-6">
        <h2>Contracts</h2>
        <span className="text-xs text-smoke">{rows.length} contracts</span>
      </div>

      {showUpload && <div className="mb-8"><UploadPanel workspaceId={workspace} /></div>}

      <form className="flex gap-2 mb-6" action={`/w/${workspace}/contracts`} method="get">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or counterparty"
          aria-label="Search contracts"
          className="flex-1 border border-ash rounded-input px-4 py-2.5 text-sm bg-surface" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Filter by status"
          className="border border-ash rounded-input px-3 py-2.5 text-sm bg-surface">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="in_review">In review</option>
          <option value="negotiating">Negotiating</option>
          <option value="approved">Approved</option>
          <option value="active">Active</option>
        </select>
        <button className="rounded-pill border border-ash px-5 h-10 text-sm hover:border-periwinkle-deep">Filter</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={sp.q ? "No contracts match" : "No contracts yet"}
          explanation={sp.q ? "Try a different search term or clear the filters." : "Upload an agreement and ContractLens will extract its terms, obligations, and deadlines."}
          action={<Link href={`/w/${workspace}/contracts?upload=1`} className="rounded-pill bg-lake text-white text-sm px-6 py-2.5 inline-block">Upload contract</Link>}
        />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="cl-table">
            <thead>
              <tr>
                <th>Name</th><th>Counterparty</th><th>Type</th><th>Status</th><th>Expires</th><th>Notice by</th><th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ct) => {
                const flag = flagMap.get(ct.id);
                return (
                  <tr key={ct.id}>
                    <td>
                      <Link href={`/w/${workspace}/contracts/${ct.id}/brief`} className="text-info hover:underline">
                        {ct.title}
                      </Link>
                    </td>
                    <td>{ct.counterpartyName ?? "—"}</td>
                    <td>{ct.contractType ?? "—"}</td>
                    <td><Badge tone={ct.status === "approved" ? "success" : "info"}>{ct.status.replace(/_/g, " ")}</Badge></td>
                    <td className="num">{ct.expirationDate ?? "—"}</td>
                    <td className="num">{ct.renewalNoticeBy ?? "—"}</td>
                    <td>{flag ? <SeverityBadge severity={flag.sev} /> : <span className="text-smoke">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
