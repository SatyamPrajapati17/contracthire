import { getCtx } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { PortfolioObligationsView } from "@/components/portfolio-obligations-view";

export const dynamic = "force-dynamic";

export default async function ObligationsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this page.</main>;
  }
  return (
    <AppShell workspaceId={workspace} active="/obligations">
      <h2 className="mb-1">Obligations</h2>
      <p className="text-xs text-smoke mb-8">Everything owed across the workspace, grouped by due date.</p>
      <PortfolioObligationsView />
    </AppShell>
  );
}
