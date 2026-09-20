import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { DocumentViewer } from "@/components/document-viewer";

export const dynamic = "force-dynamic";

export default async function ViewerPage({
  params, searchParams
}: {
  params: Promise<{ workspace: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { workspace, id: ctId } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this document.</main>;
  }
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, workspace))).limit(1))[0];
  if (!ct || !ct.currentVersionId) {
    return <main id="main" className="p-10"><p className="text-sm text-graphite">No processed document version yet.</p></main>;
  }

  return (
    <AppShell workspaceId={workspace} active="/contracts">
      <DocumentViewer
        documentVersionId={ct.currentVersionId}
        versionLabel="current"
        initialCitation={sp.cite ?? null}
      />
    </AppShell>
  );
}
