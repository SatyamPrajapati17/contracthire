import { NextRequest } from "next/server";
import { getCtx, canManageMembers } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { memberships, users } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit, contentHash } from "@/lib/audit";
import { z } from "zod";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx || ctx.workspaceId !== (await params).id) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  const rows = await db
    .select({ id: memberships.id, role: memberships.role, email: users.email, name: users.displayName, userId: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, ctx.workspaceId));
  return Response.json({ data: rows });
}

const Body = z.object({
  email: z.string().email(),
  role: z.enum(["workspace_admin", "legal_reviewer", "contract_owner", "contributor", "viewer"]),
  display_name: z.string().optional()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const wsId = (await params).id;
  if (!ctx || ctx.workspaceId !== wsId) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Requires workspace admin." } }, { status: 403 });

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const email = parse.data.email.toLowerCase();
  let user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user) {
    user = (await db.insert(users).values({ id: id("usr"), email, displayName: parse.data.display_name ?? null }).returning())[0];
  }
  const existing = await db.select().from(memberships)
    .where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, user.id))).limit(1);
  if (existing[0]) {
    return Response.json({ error: { code: "conflict", message: "This person is already a member or invitee." } }, { status: 409 });
  }
  const memId = id("mem");
  await db.insert(memberships).values({ id: memId, workspaceId: wsId, userId: user.id, role: parse.data.role });
  await audit({ workspaceId: wsId, ctx, action: "member.invite", resourceType: "membership", resourceId: memId, metadata: { email, role: parse.data.role } });
  return Response.json({ membership_id: memId, user_id: user.id }, { status: 201 });
}

const PatchBody = z.object({
  user_id: z.string().min(1),
  role: z.enum(["workspace_admin", "legal_reviewer", "contract_owner", "contributor", "viewer", "external_signer"])
});

/** Role change (phase 8 matrix): admin-only, cannot demote the last admin. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const wsId = (await params).id;
  if (!ctx || ctx.workspaceId !== wsId) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Requires workspace admin." } }, { status: 403 });

  const parse = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const mem = (await db.select().from(memberships)
    .where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, parse.data.user_id))).limit(1))[0];
  if (!mem) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  if (mem.role === "workspace_admin" && parse.data.role !== "workspace_admin") {
    const admins = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM memberships WHERE workspace_id = ${wsId} AND role = 'workspace_admin'`);
    if ((admins.rows[0]?.n ?? 0) <= 1) {
      return Response.json({ error: { code: "conflict", message: "Cannot demote the last workspace admin." } }, { status: 409 });
    }
  }

  const before = { role: mem.role };
  await db.update(memberships).set({ role: parse.data.role }).where(eq(memberships.id, mem.id));
  await audit({
    workspaceId: wsId, ctx, action: "member.role_change", resourceType: "membership", resourceId: mem.id,
    beforeHash: contentHash(before), afterHash: contentHash({ role: parse.data.role }),
    metadata: { user_id: parse.data.user_id, prior_role: mem.role, new_role: parse.data.role }
  });
  return Response.json({ ok: true });
}

const DeleteQuery = z.object({ user_id: z.string().min(1) });

/** Remove member (phase 8 matrix): admin-only, cannot remove the last admin. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  const wsId = (await params).id;
  if (!ctx || ctx.workspaceId !== wsId) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  if (!canManageMembers(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Requires workspace admin." } }, { status: 403 });

  const parse = DeleteQuery.safeParse({ user_id: req.nextUrl.searchParams.get("user_id") });
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const mem = (await db.select().from(memberships)
    .where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, parse.data.user_id))).limit(1))[0];
  if (!mem) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  if (mem.role === "workspace_admin") {
    const admins = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM memberships WHERE workspace_id = ${wsId} AND role = 'workspace_admin'`);
    if ((admins.rows[0]?.n ?? 0) <= 1) {
      return Response.json({ error: { code: "conflict", message: "Cannot remove the last workspace admin." } }, { status: 409 });
    }
  }

  await db.delete(memberships).where(eq(memberships.id, mem.id));
  await audit({
    workspaceId: wsId, ctx, action: "member.remove", resourceType: "membership", resourceId: mem.id,
    beforeHash: contentHash({ role: mem.role }), metadata: { user_id: parse.data.user_id, prior_role: mem.role }
  });
  return new Response(null, { status: 204 });
}
