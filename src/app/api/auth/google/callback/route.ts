/* Gmail OAuth callback — exchanges the consent code for tokens, stores the
   refresh token in app_settings (used by the Gmail REST sender) AND prints
   it for optional .env use. One-time setup; consent once, done. */
import { setSetting } from "@/lib/app-settings";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL || url.origin;
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const page = (title: string, body: string) =>
    new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#1a1d21;">` +
      body + `</body></html>`,
      { status: error ? 400 : 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );

  if (error) {
    return page("Gmail authorization", `<h2>Authorization cancelled</h2><p>${error}</p><p><a href="/">Back to ContractLens</a></p>`);
  }
  if (error) {
    return page("Gmail authorization", `<h2>Authorization cancelled or denied</h2><p>Google returned: <code>${error}</code>.</p>` +
      `<p><strong>Access blocked?</strong> In Google Cloud Console → <em>OAuth consent screen</em>, add your Gmail address under <strong>Test users</strong> (or press <em>Publish app</em>), then retry the connect from Settings → Connections.</p>` +
      `<p><a href="/">Back to ContractLens</a></p>`);
  }
  if (!code || !clientId || !clientSecret) {
    return page("Gmail authorization", `<h2>Missing setup</h2><p>code, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are all required.</p>`);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const tok = (await res.json()) as { refresh_token?: string; access_token?: string; error_description?: string };
  if (!res.ok || !tok.access_token) {
    return page("Gmail authorization", `<h2>Token exchange failed</h2><pre style="white-space:pre-wrap;background:#f4f5f6;padding:12px;border-radius:8px;">${tok.error_description ?? "unknown error"}</pre><p>Check that the redirect URI <code>${redirectUri}</code> is registered exactly in Google Cloud Console.</p>`);
  }
  if (!tok.refresh_token) {
    return page("Gmail authorization", `<h2>No refresh token returned</h2><p>Google only issues one when <code>access_type=offline</code> and <code>prompt=consent</code> are set — retry via <a href="/api/auth/google/start">/api/auth/google/start</a>, or revoke the app at myaccount.google.com/permissions first.</p>`);
  }

  // Persist for the Gmail REST sender (EMAIL_PROVIDER=gmail-api) — picked up
  // immediately, no redeploy. A GOOGLE_REFRESH_TOKEN env var still wins.
  // The sender address is derived from the actual consented account (userinfo),
  // NOT from env fallbacks — they may point at a different Gmail.
  let senderEmail = "";
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tok.access_token}` }
    });
    if (ui.ok) senderEmail = ((await ui.json()) as { email?: string }).email ?? "";
  } catch {
    /* userinfo failed — fall through to env fallback below */
  }
  try {
    await setSetting("gmail_refresh_token", tok.refresh_token);
    await setSetting("gmail_sender_email", senderEmail || process.env.GOOGLE_EMAIL || process.env.GMAIL_USER || "");
  } catch {
    /* table missing (migration 0008 not applied) — env paste still works */
  }

  return page(
    "Gmail authorized ✓",
    `<h2>✓ Gmail authorized</h2>` +
    `<p><strong>Saved.</strong> Connected as <strong>${senderEmail || "(address unavailable)"}</strong> — set <code>EMAIL_PROVIDER=gmail-api</code> in your env (or leave <code>gmail</code> on localhost where SMTP works).</p>` +
    `<p>Optional — paste into <code>.env</code> if you prefer env-based config:</p>` +
    `<pre style="white-space:pre-wrap;background:#f4f5f6;padding:12px;border-radius:8px;">EMAIL_PROVIDER=gmail-api\nGOOGLE_CLIENT_ID=${clientId}\nGOOGLE_REFRESH_TOKEN=${tok.refresh_token}</pre>` +
    `<p>Email automations (magic-link sign-in + due-date reminders) will send from this Gmail account.</p>` +
    `<p><a href="/">Back to ContractLens</a></p>`
  );
}
