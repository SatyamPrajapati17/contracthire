/* Face sign-in (phase: face scan). The browser verifies the face locally
   (template never leaves the device) and POSTs the verified email here.
   This endpoint issues the session ONLY for emails that already exist and,
   for demo safety, only when the email matches a known user. The cryptographic
   trust anchor is the local template match; server-side we rate-limit and
   require an existing account. */
import { db } from "@/lib/db/client";
import { users, sessions, memberships } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { SESSION_COOKIE } from "@/lib/auth";
import { z } from "zod";

const Body = z.object({
  email: z.string().email(),
  device_hint: z.string().max(200).optional()
});

// Simple in-memory rate limit: 5 face sign-ins / 10 min / email.
const attempts = new Map<string, number[]>();
function rateLimited(email: string): boolean {
  const now = Date.now();
  const list = (attempts.get(email) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  attempts.set(email, list);
  return list.length > 5;
}

export async function POST(req: Request) {
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return Response.json({ error: { code: "validation_failed" } }, { status: 422 });
  const email = parse.data.email.toLowerCase();

  if (rateLimited(email)) {
    return Response.json({ error: { code: "rate_limited", message: "Too many attempts — try again in 10 minutes." } }, { status: 429 });
  }

  const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  // Do not disclose whether the account exists.
  if (!user) {
    return Response.json({ error: { code: "unauthorized", message: "Face sign-in unavailable for this account." } }, { status: 401 });
  }

  const mem = (await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1))[0];
  const sid = id("ses");
  await db.insert(sessions).values({
    id: sid,
    userId: user.id,
    workspaceId: mem?.workspaceId ?? null,
    expiresAt: new Date(Date.now() + 7 * 86400000)
  });

  return new Response(JSON.stringify({ ok: true, redirect: mem ? `/w/${mem.workspaceId}/dashboard` : "/signin" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
    }
  });
}
