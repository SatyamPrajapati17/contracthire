/* Sign in with Google (phase 13): same OAuth client reused later for
   Gmail/Sheets scopes. Auto-provisions the user + a personal workspace on
   first sign-in; existing members land in their first workspace. */
import { db } from "@/lib/db/client";
import { users, sessions, memberships, workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { id } from "@/lib/ids";
import { SESSION_COOKIE } from "@/lib/auth";

// Stable redirect: always derived from APP_URL so it matches the Google Console
// registration exactly (http://localhost:3000/api/auth/signin-google).
const REDIRECT_URI = `${process.env.APP_URL || "http://localhost:3000"}/api/auth/signin-google`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL || url.origin;

  // Step 2: Google redirects back with ?code=...
  const code = url.searchParams.get("code");
  if (code) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return text("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.", 500);

    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECT_URI, grant_type: "authorization_code"
      })
    });
    const tok = await tokRes.json() as { access_token?: string; error_description?: string };
    if (!tokRes.ok || !tok.access_token) {
      return htmlError("Google sign-in could not be completed", tok.error_description ?? `Token exchange failed (HTTP ${tokRes.status}).`, appUrl);
    }

    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tok.access_token}` }
    });
    const info = await infoRes.json() as { email?: string; name?: string; email_verified?: boolean };
    if (!info.email) {
      return htmlError("Google did not share an email address", "Make sure the email scope is enabled for this app and try again.", appUrl);
    }

    const email = info.email.toLowerCase();
    let user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (!user) {
      user = (await db.insert(users).values({ id: id("usr"), email, displayName: info.name ?? null }).returning())[0];
    }

    // First membership wins (magic-link sign-in uses the same rule).
    let mem = (await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1))[0];
    let role = mem?.role as string | undefined;
    if (!mem) {
      const wsId = id("ws");
      await db.insert(workspaces).values({ id: wsId, name: `${info.name ?? email.split("@")[0]}'s workspace` });
      await db.insert(memberships).values({ id: id("mem"), workspaceId: wsId, userId: user.id, role: "workspace_admin" });
      role = "workspace_admin";
      mem = { workspaceId: wsId } as typeof mem;
    }

    const sid = `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(sessions).values({
      id: sid, userId: user.id, workspaceId: mem.workspaceId,
      expiresAt: new Date(Date.now() + 7 * 86400000)
    });

    const redirect = new URL(`${appUrl}/w/${mem.workspaceId}/dashboard`);
    return new Response(null, {
      status: 302,
      headers: {
        location: redirect.toString(),
        "set-cookie": `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
      }
    });
  }

  // Step 1: redirect to Google's consent screen (sign-in scopes only).
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return text("GOOGLE_CLIENT_ID is not set. See README → Google OAuth.", 500);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account"
  });
  return new Response(null, {
    status: 302,
    headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }
  });
}

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

/** Styled error page (parchment theme) with the reason and the two fix paths. */
function htmlError(title: string, detail: string, appUrl: string): Response {
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Sign-in — ${title}</title>` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
    `body{background:#f6f3f1;color:#242424;font-family:ui-monospace,Menlo,monospace;max-width:640px;margin:64px auto;padding:0 20px;line-height:1.6}` +
    `h1{font-family:Georgia,serif;font-weight:400;font-size:26px;color:#000}` +
    `.card{background:#fbfaf9;border:1px solid #cecac8;border-radius:24px;padding:32px}` +
    `pre{white-space:pre-wrap;background:#efebe8;padding:12px;border-radius:12px;font-size:12px}` +
    `a{color:#2b59d1} .btn{display:inline-block;margin-top:16px;padding:10px 22px;border-radius:100px;background:#2b59d1;color:#fff;text-decoration:none}` +
    `</style></head><body><div class="card">` +
    `<h1>Sign-in problem</h1><p><strong>${title}.</strong></p><pre>${detail}</pre>` +
    `<p><strong>Two ways forward:</strong></p>` +
    `<ol><li><strong>Magic link (always works):</strong> sign in with any email and the link appears right on the page and in the server console.</li>` +
    `<li><strong>Fix Google sign-in:</strong> in Google Cloud Console → <em>APIs &amp; Services → OAuth consent screen</em>, add your Gmail address as a Test user (or press <em>Publish app</em>), and confirm the redirect URI <code>${appUrl}/api/auth/signin-google</code> is registered under Credentials.</li></ol>` +
    `<a class="btn" href="/signin">Back to sign-in</a></div></body></html>`;
  return new Response(page, { status: 502, headers: { "content-type": "text/html; charset=utf-8" } });
}
