import { getCtx, canManageMembers } from "@/lib/auth";
import { getConnection, revoke } from "@/lib/google-oauth";
import { audit } from "@/lib/audit";

/** Connection status for the settings page. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const conn = await getConnection(ctx.workspaceId);
  if (!conn) return Response.json({ connected: false });
  return Response.json({
    connected: conn.status === "connected",
    status: conn.status,
    account_email: conn.accountEmail,
    scopes: conn.scopes,
    owner_user_id: conn.ownerUserId,
    updated_at: conn.updatedAt,
    error_message: conn.errorMessage
  });
}

/** Disconnect: admin-only; revokes the token at Google and discards it locally. */
export async function DELETE(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Disconnecting requires workspace admin." } }, { status: 403 });
  const ok = await revoke(ctx.workspaceId);
  if (!ok) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  await audit({
    workspaceId: ctx.workspaceId, ctx,
    action: "connection.google.revoked", resourceType: "connected_account", resourceId: ctx.workspaceId
  });
  return new Response(null, { status: 204 });
}
