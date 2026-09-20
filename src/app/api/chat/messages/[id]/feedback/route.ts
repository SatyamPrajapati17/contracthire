import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { chatMessages } from "@/lib/db/risk-schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({ feedback: z.enum(["helpful", "not_helpful"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: msgId } = await params;
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });

  const msg = (await db.select().from(chatMessages)
    .where(and(eq(chatMessages.id, msgId), eq(chatMessages.workspaceId, ctx.workspaceId))).limit(1))[0];
  if (!msg) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  await db.update(chatMessages).set({ feedback: parse.data.feedback }).where(eq(chatMessages.id, msgId));
  return Response.json({ ok: true });
}
