import { getCtx } from "@/lib/auth";
import { exportOnce } from "@/lib/sheets-portfolio";
import { audit } from "@/lib/audit";

/** One-time export of Contracts / Obligations / Risk flags tabs (phase 11). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: wsId } = await params;
  if (ctx.workspaceId !== wsId) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const result = await exportOnce(wsId);
  if (!result.ok) {
    return Response.json({ error: { code: "export_failed", message: result.error } }, { status: 400 });
  }
  await audit({
    workspaceId: wsId, ctx,
    action: "workspace.sheets_export", resourceType: "workspace", resourceId: wsId,
    metadata: { created_rows: result.created_rows ?? 0 }
  });
  return Response.json({ exported: true, spreadsheet_url: result.spreadsheet_url, created_rows: result.created_rows });
}
