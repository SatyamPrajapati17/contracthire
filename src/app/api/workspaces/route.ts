import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { workspaces, memberships } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

const Body = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().default("UTC")
});

export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const wsId = id("ws");
  await db.insert(workspaces).values({ id: wsId, name: parse.data.name, timezone: parse.data.timezone });
  await db.insert(memberships).values({
    id: id("mem"),
    workspaceId: wsId,
    userId: ctx.userId,
    role: "workspace_admin"
  });
  await audit({ workspaceId: wsId, ctx, action: "workspace.create", resourceType: "workspace", resourceId: wsId });
  return Response.json({ workspace_id: wsId }, { status: 201 });
}
