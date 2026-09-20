import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { documentVersions } from "@/lib/db/contracts-schema";
import { and, eq } from "drizzle-orm";
import { storage } from "@/lib/ports";
import { sha256Hex } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs";

/** Local upload sink — stands in for the signed S3 PUT (localhost-only build). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id: dvId } = await params;

  const dv = (await db.select().from(documentVersions)
    .where(and(eq(documentVersions.id, dvId), eq(documentVersions.workspaceId, ctx.workspaceId)))
    .limit(1))[0];
  if (!dv) return Response.json({ error: { code: "not_found" } }, { status: 404 });

  const buf = Buffer.from(await req.arrayBuffer());
  const hash = sha256Hex(buf);
  if (hash !== dv.sha256) {
    return Response.json({ error: { code: "validation_failed", message: "Uploaded bytes do not match the declared SHA-256." } }, { status: 422 });
  }
  await storage.put(dv.storageKey, buf);

  // Pipeline starts here (async — nothing model-related in the request cycle).
  await enqueueJob("intake", { documentVersionId: dvId, workspaceId: ctx.workspaceId, contractId: dv.contractId });
  return Response.json({ received: true, bytes: buf.length });
}
