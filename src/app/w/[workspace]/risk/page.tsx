import { getCtx } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { PortfolioRiskView } from "@/components/portfolio-risk-view";

export const dynamic = "force-dynamic";

export default async function RiskQueuePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this page.</main>;
  }
  return (
    <AppShell workspaceId={workspace} active="/risk">
      <h2 className="mb-1">Risk queue</h2>
      <p className="text-xs text-smoke mb-8">Flags awaiting a recorded human decision, grouped by severity.</p>
      <PortfolioRiskView />
    </AppShell>
  );
}
