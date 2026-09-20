import { NextResponse } from "next/server";
import { db } from "./db/client";
import { auditEvents } from "./db/risk-schema";
import { id, sha256Hex } from "./ids";
import type { Ctx } from "./auth";

/** Append-only audit write. Never updated, never deleted. */
export async function audit(params: {
  workspaceId: string;
  ctx?: Ctx | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  beforeHash?: string | null;
  afterHash?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await db.insert(auditEvents).values({
    workspaceId: params.workspaceId,
    actorUserId: params.ctx?.userId ?? null,
    actorRole: params.ctx?.role ?? null,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    beforeHash: params.beforeHash ?? null,
    afterHash: params.afterHash ?? null,
    metadata: JSON.stringify(params.metadata ?? {}),
    ipAddress: params.ip ?? null,
    userAgent: params.userAgent ?? null
  });
}

export function contentHash(value: unknown): string {
  return sha256Hex(JSON.stringify(value ?? null));
}

/* ── API error envelope (doc 06 §4.1) ──────────────────────────────────── */
export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, ref: id("req"), details: details ?? {} } },
    { status }
  );
}

export const unauthorized = () => apiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = (msg = "You do not have permission for this action.") => apiError(403, "forbidden", msg);
export const notFound = () => apiError(404, "not_found", "Resource not found.");
export const validationFailed = (details?: Record<string, unknown>) => apiError(422, "validation_failed", "Validation failed.", details);
export const conflict = (message: string, details?: Record<string, unknown>) => apiError(409, "conflict", message, details);
