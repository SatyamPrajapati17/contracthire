import { NextRequest, NextResponse } from "next/server";
import { getCtx, type Ctx } from "./auth";
import { unauthorized, notFound } from "./audit";

export async function requireCtx(req: NextRequest): Promise<Ctx | null> {
  return getCtx();
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Every resource read is workspace-scoped; foreign resources 404 (doc 06 §3). */
export function scopeGuard<T extends { workspaceId: string }>(row: T | undefined, ctx: Ctx): T | null {
  if (!row || row.workspaceId !== ctx.workspaceId) return null;
  return row;
}

export async function readJson<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export { unauthorized, notFound };
