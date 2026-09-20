import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts, documentVersions } from "@/lib/db/contracts-schema";
import { and, eq, asc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { VersionsView } from "@/components/versions-view";

export const dynamic = "force-dynamic";

export default async function VersionsPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id: ctId } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this page.</main>;
  }
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, workspace))).limit(1))[0];
  if (!ct) return <main id="main" className="p-10">Contract not found.</main>;

  const versions = await db.select().from(documentVersions)
    .where(eq(documentVersions.contractId, ctId))
    .orderBy(asc(documentVersions.versionNumber));

  return (
    <AppShell workspaceId={workspace} active="/contracts">
      <h2 className="mb-6">Versions & compare</h2>
      <VersionsView
        contractId={ctId}
        versions={versions.map((v) => ({
          id: v.id, label: v.versionLabel, filename: v.filename,
          status: v.status, page_count: v.pageCount,
          created_at: v.createdAt.toISOString(),
          is_current: v.id === ct.currentVersionId
        }))}
      />
    </AppShell>
  );
}
