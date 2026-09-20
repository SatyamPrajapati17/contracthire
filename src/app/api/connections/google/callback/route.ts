import { getCtx } from "@/lib/auth";
import { verifyState, exchangeAndStore } from "@/lib/google-oauth";
import { audit } from "@/lib/audit";

/** OAuth callback: verifies the signed state, exchanges the code, stores
 *  encrypted tokens on the workspace connection, then reports the result. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });

  const purpose = state ? verifyState(state) : null;
  if (error || !code || !purpose) {
    return Response.json({ error: { code: "oauth_failed", message: error ?? "missing code or invalid state" } }, { status: 400 });
  }

  try {
    const { accountEmail, scopes } = await exchangeAndStore({
      workspaceId: ctx.workspaceId,
      ownerUserId: ctx.userId,
      code,
      purpose
    });
    await audit({
      workspaceId: ctx.workspaceId, ctx,
      action: "connection.google.linked", resourceType: "connected_account", resourceId: ctx.workspaceId,
      metadata: { purpose, account_email: accountEmail, scopes }
    });
    return Response.json({
      connected: true,
      account_email: accountEmail,
      scopes,
      note: "Tokens stored encrypted. You can close this page."
    });
  } catch (e) {
    return Response.json({ error: { code: "oauth_failed", message: e instanceof Error ? e.message.slice(0, 200) : "exchange failed" } }, { status: 502 });
  }
}
