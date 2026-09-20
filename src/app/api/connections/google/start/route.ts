import { getCtx, canEdit } from "@/lib/auth";
import { authorizeUrl, type GooglePurpose } from "@/lib/google-oauth";

const PURPOSES: GooglePurpose[] = ["base", "gmail", "sheets"];

/** Start the workspace-level Google connection (phase 9). Contributor+ only;
 *  the connection is owned by whoever consents. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  if (!canEdit(ctx.role)) return Response.json({ error: { code: "forbidden" } }, { status: 403 });

  const purpose = (new URL(req.url).searchParams.get("purpose") ?? "base") as GooglePurpose;
  if (!PURPOSES.includes(purpose)) {
    return Response.json({ error: { code: "validation_failed", message: "purpose must be base|gmail|sheets" } }, { status: 422 });
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    return Response.json({ error: { code: "not_configured", message: "GOOGLE_CLIENT_ID missing." } }, { status: 500 });
  }
  return new Response(null, { status: 302, headers: { location: authorizeUrl(purpose) } });
}
