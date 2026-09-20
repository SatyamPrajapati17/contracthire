/* GmailAdapter (phase 10): sends alert emails through the Gmail API using the
   workspace's connected Google account. Same scheduler, same idempotency key,
   same retry/backoff as the in-app channel — only the transport differs.
   Requires scope https://www.googleapis.com/auth/gmail.send (granted via
   Connected accounts). */
import { getAccessToken, getConnection, hasScope } from "./google-oauth";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface GmailSendInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface GmailSendResult {
  ok: boolean;
  messageId?: string;
  error?: "not_connected" | "scope_not_granted" | "api_error";
  detail?: string;
}

function mimeMessage(input: GmailSendInput, from: string | null): string {
  const boundary = "cl-boundary-" + Math.random().toString(36).slice(2);
  const headers = [
    `To: ${input.to}`,
    from ? `From: ${from}` : null,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].filter(Boolean).join("\r\n");
  return [
    headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    input.html,
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

/** Send via Gmail API. Never throws — returns a typed result for the sweep. */
export async function sendViaGmail(workspaceId: string, input: GmailSendInput): Promise<GmailSendResult> {
  const conn = await getConnection(workspaceId);
  if (!conn || conn.status !== "connected") return { ok: false, error: "not_connected" };
  if (!hasScope(conn, GMAIL_SCOPE)) return { ok: false, error: "scope_not_granted" };

  const token = await getAccessToken(workspaceId);
  if (!token) return { ok: false, error: "not_connected", detail: "token unavailable" };

  const raw = Buffer.from(mimeMessage(input, conn.accountEmail)).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw })
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    return { ok: false, error: "api_error", detail };
  }
  const body = await res.json() as { id?: string };
  return { ok: true, messageId: body.id };
}

/** Rendered alert email (template per phase 10 spec). */
export function gmailAlertEmail(opts: {
  to: string; obligationTitle: string; contractTitle: string;
  dueDate: string | null; dueDateMath: string | null; offsetDays: number;
  appUrl: string; link: string;
}): GmailSendInput {
  const when = opts.dueDate ?? "date pending";
  const subject = `[ContractLens] ${opts.obligationTitle} — due ${when}`;
  const link = `${opts.appUrl}${opts.link}`;
  const text = [
    `Contract obligation reminder (${opts.offsetDays} days ahead)`,
    "",
    `Obligation: ${opts.obligationTitle}`,
    `Contract: ${opts.contractTitle}`,
    `Due date: ${when}`,
    opts.dueDateMath ? `Due date logic: ${opts.dueDateMath}` : null,
    "",
    `Open in ContractLens: ${link}`,
    "",
    "AI assistance. Verify before relying. This is not legal advice."
  ].filter(Boolean).join("\n");
  const html = `<div style="font-family:ui-monospace,monospace;font-size:14px;line-height:1.6;max-width:560px">
  <p><strong>${opts.obligationTitle}</strong> — ${opts.offsetDays} days ahead</p>
  <p>Contract: ${opts.contractTitle}<br>Due date: <strong>${when}</strong>${opts.dueDateMath ? `<br>Due date logic: ${opts.dueDateMath}` : ""}</p>
  <p><a href="${link}">Open in ContractLens</a></p>
  <p style="color:#777;font-size:12px">AI assistance. Verify before relying. This is not legal advice.</p>
</div>`;
  return { to: opts.to, subject, text, html };
}
