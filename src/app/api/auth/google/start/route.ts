/* Gmail OAuth consent start — one-time setup flow.
   Redirects to Google's consent screen; the callback prints the refresh
   token to paste into GOOGLE_REFRESH_TOKEN. Scope is the full Gmail scope
   (auth/gmail.send + auth/gmail.modify), which the Gmail REST API and SMTP
   XOAUTH2 both require. */

const GMAIL_SMTP_SCOPE =
  "https://mail.google.com/ https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify";

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.APP_URL || new URL(req.url).origin;
  if (!clientId) {
    return new Response(
      "GOOGLE_CLIENT_ID is not set. Add it to .env first (see README → Gmail OAuth).",
      { status: 500, headers: { "content-type": "text/plain" } }
    );
  }
  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SMTP_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  return new Response(null, {
    status: 302,
    headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }
  });
}
