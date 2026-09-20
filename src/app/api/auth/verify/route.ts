import { NextRequest, NextResponse } from "next/server";
import { consumeMagicToken, createSession, SESSION_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { memberships } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const email = req.nextUrl.searchParams.get("email");
  if (!token) {
    return NextResponse.redirect(new URL("/signin?error=expired", req.url));
  }
  const result = await consumeMagicToken(token);
  if (!result) {
    return NextResponse.redirect(new URL("/signin?error=expired", req.url));
  }
  const sid = await createSession(result.userId);
  await audit({
    workspaceId: "system",
    action: "auth.signin",
    resourceType: "user",
    resourceId: result.userId,
    metadata: { method: "magic_link", email_domain: result.email.split("@")[1] },
    userAgent: req.headers.get("user-agent")
  });

  const mem = await db.select().from(memberships).where(eq(memberships.userId, result.userId)).limit(1);
  const dest = mem[0] ? `/w/${mem[0].workspaceId}/dashboard` : "/workspace/new";
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return res;
}
