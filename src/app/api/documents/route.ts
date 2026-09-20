import { NextRequest } from "next/server";
import { getCtx, canUpload } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { contracts } from "@/lib/db/contracts-schema";
import { documentVersions } from "@/lib/db/contracts-schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { id } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { z } from "zod";

const Body = z.object({
  contract_id: z.string().optional(),
  title: z.string().optional(),
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  byte_size: z.number().int().positive(),
  sha256: z.string().length(64)
});

export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canUpload(ctx.role)) return Response.json({ error: { code: "forbidden", message: "Upload requires contributor role or higher." } }, { status: 403 });
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });
  const body = parse.data;

  if (body.byte_size > 50 * 1024 * 1024) {
    return Response.json({ error: { code: "validation_failed", message: "Files must be 50 MB or smaller." } }, { status: 422 });
  }

  let ctId = body.contract_id ?? null;
  if (!ctId) {
    ctId = id("ct");
    await db.insert(contracts).values({
      id: ctId,
      workspaceId: ctx.workspaceId,
      title: body.title ?? body.filename.replace(/\.[a-z0-9]+$/i, ""),
      ownerUserId: ctx.userId
    });
    await audit({ workspaceId: ctx.workspaceId, ctx, action: "contract.create", resourceType: "contract", resourceId: ctId, metadata: { via: "upload" } });
  } else {
    const ct = (await db.select().from(contracts)
      .where(and(eq(contracts.id, ctId), eq(contracts.workspaceId, ctx.workspaceId), isNull(contracts.deletedAt))).limit(1))[0];
    if (!ct) return Response.json({ error: { code: "not_found" } }, { status: 404 });
  }

  // Duplicate detection by content hash within the workspace (FR-IN-05).
  const dup = await db.execute<{ id: string; contract_id: string; version_label: string }>(sql`
    SELECT id, contract_id, version_label FROM document_versions
    WHERE workspace_id = ${ctx.workspaceId} AND sha256 = ${body.sha256}
    LIMIT 1
  `);
  if (dup.rows[0] && dup.rows[0].contract_id !== ctId) {
    return Response.json({
      error: {
        code: "conflict",
        message: "This file already exists in the workspace.",
        details: {
          existing_document_version_id: dup.rows[0].id,
          contract_id: dup.rows[0].contract_id,
          resolutions: ["link_as_version", "keep_separate"]
        }
      }
    }, { status: 409 });
  }

  const nextNum = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM document_versions WHERE contract_id = ${ctId}
  `);
  const versionNumber = nextNum.rows[0]?.n ?? 1;

  const dvId = id("dv");
  const storageKey = `w/${ctx.workspaceId}/c/${ctId}/v/${dvId}/original.${extOf(body.mime_type, body.filename)}`;
  await db.insert(documentVersions).values({
    id: dvId,
    workspaceId: ctx.workspaceId,
    contractId: ctId,
    versionLabel: `v${versionNumber}`,
    versionNumber,
    filename: body.filename,
    mimeType: body.mime_type,
    byteSize: body.byte_size,
    sha256: body.sha256,
    storageKey,
    uploadedBy: ctx.userId
  });
  await db.update(contracts).set({ currentVersionId: dvId, updatedAt: new Date() }).where(eq(contracts.id, ctId));
  await audit({
    workspaceId: ctx.workspaceId, ctx, action: "document.upload", resourceType: "document_version", resourceId: dvId,
    metadata: { filename: body.filename, sha256: body.sha256, byte_size: body.byte_size }
  });

  // Local storage: the client PUTs to our own upload endpoint (StoragePort).
  return Response.json({
    document_version_id: dvId,
    contract_id: ctId,
    upload_url: `/api/upload/${dvId}`,
    expires_in: 300
  }, { status: 201 });
}

function extOf(mime: string, filename: string): string {
  const fromName = filename.includes(".") ? filename.split(".").pop() : null;
  if (fromName) return fromName.toLowerCase().slice(0, 8);
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain") return "txt";
  return "bin";
}
