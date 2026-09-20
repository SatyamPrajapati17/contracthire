import { getCtx } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { AlertsView } from "@/components/alerts-view";

export const dynamic = "force-dynamic";

export default async function AlertsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this page.</main>;
  }
  return (
    <AppShell workspaceId={workspace} active="/alerts">
      <h2 className="mb-1">Alerts</h2>
      <p className="text-xs text-smoke mb-8">Scheduled reminders with their source citation — the 90-day payoff.</p>
      <AlertsView />
    </AppShell>
  );
}
