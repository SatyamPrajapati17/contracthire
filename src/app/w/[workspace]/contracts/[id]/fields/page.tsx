import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { and, eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { FieldsView } from "@/components/fields-view";

export const dynamic = "force-dynamic";

const GROUPS = [
  { key: "parties", label: "Parties" },
  { key: "dates", label: "Dates" },
  { key: "commercial", label: "Commercial" },
  { key: "term", label: "Term & termination" },
  { key: "liability", label: "Liability & risk" },
  { key: "data", label: "Data & security" },
  { key: "sla", label: "Service levels" },
  { key: "other", label: "Other" }
];

export default async function FieldsPage({ params }: { params: Promise<{ workspace: string; id: string }> }) {
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
      <h2 className="mb-6">Extracted fields</h2>
      <FieldsView contractId={ctId} groups={GROUPS.map((g) => g.label)} />
    </AppShell>
  );
}
