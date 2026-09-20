/* Gmail OAuth callback — exchanges the consent code for tokens, prints the
   refresh token with exact .env lines. One-time setup; paste, restart, done. */

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

  return page(
    "Gmail authorized ✓",
    `<h2>✓ Gmail authorized</h2>` +
    `<p>Paste these lines into <code>.env</code> (replace EMAIL_PROVIDER too):</p>` +
    `<pre style="white-space:pre-wrap;background:#f4f5f6;padding:12px;border-radius:8px;">EMAIL_PROVIDER=gmail-oauth\nGOOGLE_CLIENT_ID=${clientId}\nGOOGLE_REFRESH_TOKEN=${tok.refresh_token}</pre>` +
    `<p>Then restart the dev server. The email automations (magic-link sign-in + due-date reminders) will send from this Gmail account.</p>` +
    `<p><a href="/">Back to ContractLens</a></p>`
  );
}
