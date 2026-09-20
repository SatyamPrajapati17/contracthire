import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq } from "drizzle-orm";
import { BriefView } from "@/components/brief-view";
import { Badge } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id: ctId } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this contract.</main>;
  }
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, workspace))).limit(1))[0];
  if (!ct) return <main id="main" className="p-10">Contract not found.</main>;

  const tabs = [
    { key: "brief", label: "Brief", href: `/w/${workspace}/contracts/${ctId}/brief` },
    { key: "viewer", label: "Document", href: `/w/${workspace}/contracts/${ctId}/viewer` },
    { key: "fields", label: "Fields", href: `/w/${workspace}/contracts/${ctId}/fields` },
    { key: "obligations", label: "Obligations", href: `/w/${workspace}/contracts/${ctId}/obligations` },
    { key: "risk", label: "Risk", href: `/w/${workspace}/contracts/${ctId}/risk` },
    { key: "versions", label: "Versions", href: `/w/${workspace}/contracts/${ctId}/versions` },
    { key: "qa", label: "Q&A", href: `/w/${workspace}/contracts/${ctId}/qa` }
  ];

  return (
    <AppShell workspaceId={workspace} active="/contracts">
      <div className="mb-2 text-xs text-smoke">
        <Link href={`/w/${workspace}/contracts`} className="hover:underline">Contracts</Link> / {ct.title}
      </div>
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <h2 className="!mb-0">{ct.title}</h2>
        <Badge tone={ct.status === "approved" ? "success" : "info"}>{ct.status.replace(/_/g, " ")}</Badge>
        {ct.counterpartyName && <span className="text-sm text-graphite">{ct.counterpartyName}</span>}
        {ct.expirationDate && <span className="text-xs text-smoke">expires {ct.expirationDate}</span>}
        {ct.renewalNoticeBy && <span className="text-xs text-high">notice by {ct.renewalNoticeBy}</span>}
        <ExportButtons workspaceId={workspace} />
      </div>
      <nav aria-label="Contract sections" className="flex gap-1 border-b border-ash mb-8 -mt-2">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-2.5 text-sm rounded-t-input ${t.key === "brief" ? "bg-lake-tint text-lake font-medium" : "text-graphite hover:text-offblack"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      <BriefView contractId={ctId} workspaceId={workspace} />
    </AppShell>
  );
}
