import { getCtx, canReadAudit } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/risk-schema";
import { users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

function safeParse(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function AuditPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== workspace) {
    return <main id="main" className="p-10">Sign in to view this page.</main>;
  }
  if (!canReadAudit(ctx.role)) {
    return (
      <AppShell workspaceId={workspace} active="/settings/audit">
        <EmptyState title="Audit log is restricted" explanation="Viewing the audit log requires the workspace admin or legal reviewer role." />
      </AppShell>
    );
  }

  const rows = await db.select({ event: auditEvents, actor: users.email })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(eq(auditEvents.workspaceId, workspace))
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);

  return (
    <AppShell workspaceId={workspace} active="/settings/audit">
      <h2 className="mb-1">Audit log</h2>
      <p className="text-xs text-smoke mb-6">Append-only. Events are never edited or deleted.</p>
      <div className="panel overflow-x-auto">
        <table className="cl-table">
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.event.id}>
                <td className="whitespace-nowrap">{new Date(r.event.createdAt).toLocaleString()}</td>
                <td>{r.actor ?? "system"}</td>
                <td className="font-medium">{r.event.action}</td>
                <td className="text-smoke">{r.event.resourceType}</td>
                <td className="text-xs text-smoke max-w-md truncate">
                  {(() => {
                    // metadata is jsonb — Drizzle already returns a parsed object.
                    const m = r.event.metadata as Record<string, unknown> | string | null;
                    const obj = typeof m === "string" ? safeParse(m) : m;
                    return obj && Object.keys(obj).length > 0 ? JSON.stringify(obj) : "—";
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
