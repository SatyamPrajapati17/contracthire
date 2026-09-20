import { getCtx, SESSION_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

/** Sign out: delete the server session, clear the cookie. */
export async function POST(req: Request) {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (sid) {
    await db.delete(sessions).where(eq(sessions.id, sid));
  }
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL || url.origin;
  return new Response(null, {
    status: 302,
    headers: {
      location: `${appUrl}/signin?signedout=1`,
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    }
  });
}

export async function GET(req: Request) {
  return POST(req);
}
