import { getCtx } from "@/lib/auth";

/** Current user context for client components (email, role, workspace). */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  return Response.json({ email: ctx.email, role: ctx.role, workspace_id: ctx.workspaceId });
}
