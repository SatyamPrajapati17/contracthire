import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ObligationsView } from "@/components/obligations-view";

export const dynamic = "force-dynamic";

export default async function ObligationsPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
  const { workspace, id: ctId } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this page.</main>;
  }
  const ct = (await db.select().from(contracts)
    .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, workspace))).limit(1))[0];
  if (!ct) return <main id="main" className="p-10">Contract not found.</main>;

  return (
    <AppShell workspaceId={workspace} active="/contracts">
      <h2 className="mb-6">Obligations</h2>
      <ObligationsView contractId={ctId} />
    </AppShell>
  );
}
