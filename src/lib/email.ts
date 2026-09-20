/* ═══════════════════════ EmailPort ═════════════════════════════════════
   Email automation behind a port. Providers:
     gmail   — Gmail SMTP with an App Password (GMAIL_USER + GMAIL_APP_PASSWORD)
     resend  — POST https://api.resend.com/emails (RESEND_API_KEY + MAIL_FROM)
     console — dev fallback, logs the message (no key needed)
   Used by: magic-link sign-in (auth emails) and the alert scheduler sweep
   (due-date reminders on the `email` channel). ════════════════════════ */

import nodemailer from "nodemailer";
import type { Transporter, TransportOptions } from "nodemailer";

/** Lazy nodemailer transport so importing this module never opens a socket. */
let gmailTransport: Transporter | null = null;
async function gmailSend(from: string, msg: EmailMessage): Promise<EmailSendResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return { delivered: false, provider: "gmail", error: "GMAIL_USER and GMAIL_APP_PASSWORD are required (use a 16-char Google App Password, not your login password)" };
  }
  gmailTransport ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    family: 4, // Railway/serverless containers have no IPv6 route
    auth: { user, pass }
  } as TransportOptions);
  try {
    const info = await gmailTransport.sendMail({
      from: from.startsWith("ContractLens") ? from : `ContractLens <${user}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html
    });
    return { delivered: true, provider: "gmail", id: info.messageId };
  } catch (err) {
    return { delivered: false, provider: "gmail", error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  }
}

/* ── Gmail OAuth (XOAUTH2) ────────────────────────────────────────────────
   Uses a Google Cloud OAuth client + refresh token instead of an App Password.
   One-time consent flow: /api/auth/google/start → consent → /api/auth/google/
   callback prints the refresh token to paste into GOOGLE_REFRESH_TOKEN. */
let oauthTransport: Transporter | null = null;
async function gmailOauthSend(from: string, msg: EmailMessage): Promise<EmailSendResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const user = process.env.GOOGLE_EMAIL || process.env.GMAIL_USER;
  if (!clientId || !clientSecret || !refreshToken || !user) {
    return {
      delivered: false,
      provider: "gmail-oauth",
      error: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN and GOOGLE_EMAIL are required — visit /api/auth/google/start once to authorize and get the refresh token"
    };
  }
  oauthTransport ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    family: 4,
    auth: { type: "OAuth2", user, clientId, clientSecret, refreshToken }
  } as TransportOptions);
  try {
    const info = await oauthTransport.sendMail({
      from: from.startsWith("ContractLens") ? from : `ContractLens <${user}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html
    });
    return { delivered: true, provider: "gmail-oauth", id: info.messageId };
  } catch (err) {
    return { delivered: false, provider: "gmail-oauth", error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  delivered: boolean;
  provider: string;
  id?: string;
  error?: string;
}

export interface EmailPort {
  readonly provider: string;
  readonly from: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

const BRAND = `
  <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1d21;">
    <div style="font-size:18px;font-weight:600;margin-bottom:4px;">ContractLens</div>
    <div style="font-size:11px;color:#8a9199;margin-bottom:20px;">contract intelligence, cited</div>
    <div style="font-size:14px;line-height:1.6;">{{BODY}}</div>
    <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e6e9ec;font-size:11px;color:#8a9199;">
      AI assistance tool, not legal advice. Verify before relying.
    </div>
  </div>`;

function wrap(body: string): string {
  return BRAND.replace("{{BODY}}", body);
}

async function resendSend(from: string, msg: EmailMessage): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { delivered: false, provider: "resend", error: "RESEND_API_KEY is not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text
    })
  });
  if (!res.ok) {
    const body = await res.text();
    return { delivered: false, provider: "resend", error: `resend_error ${res.status}: ${body.slice(0, 200)}` };
  }
  const body = (await res.json()) as { id?: string };
  return { delivered: true, provider: "resend", id: body.id };
}

function consoleSend(msg: EmailMessage): EmailSendResult {
  console.log(
    `\n──────────────────────────────────────────────\n` +
    `  [email:console] to: ${msg.to}\n  subject: ${msg.subject}\n` +
    `  ${msg.text.slice(0, 400).replace(/\n/g, "\n  ")}\n` +
    `──────────────────────────────────────────────`
  );
  return { delivered: true, provider: "console", id: `console_${Date.now()}` };
}

let cachedEmail: EmailPort | null = null;

export function email(): EmailPort {
  if (cachedEmail) return cachedEmail;
  const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
  const from = process.env.MAIL_FROM || "ContractLens <onboarding@resend.dev>";
  cachedEmail =
    provider === "gmail-oauth" || provider === "gmail_oauth"
      ? {
          provider: "gmail-oauth",
          from,
          async send(msg) {
            return gmailOauthSend(from, msg);
          }
        }
      : provider === "gmail" || provider === "smtp"
      ? {
          provider: "gmail",
          from,
          async send(msg) {
            return gmailSend(from, msg);
          }
        }
      : provider === "resend"
      ? {
          provider: "resend",
          from,
          async send(msg) {
            return resendSend(from, msg);
          }
        }
      : {
          provider: "console",
          from,
          async send(msg) {
            return consoleSend(msg);
          }
        };
  return cachedEmail;
}

/* ── Templated automations ───────────────────────────────────────────── */

export function magicLinkEmail(to: string, url: string, opts?: { textOnly?: boolean }): EmailMessage {
  if (opts?.textOnly) {
    // Gmail SMTP preview shows a plain-text quote box in the cloud console —
    // this variant keeps the sign-in URL on its own clean line.
    return {
      to,
      subject: "Your ContractLens sign-in link",
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;"><p>Click to sign in to ContractLens:</p><p style="font-size:16px;"><a href="${url}">${url}</a></p><p style="color:#666;font-size:12px;">The link expires in 15 minutes and can be used once. AI assistance tool, not legal advice.</p></div>`,
      text: `ContractLens sign-in link:\n\n${url}\n\nexpires in 15 minutes, single use.`
    };
  }
  const body = `
    <p>Sign in to ContractLens with this one-time link:</p>
    <p><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-size:14px;">Sign in</a></p>
    <p style="font-size:12px;color:#8a9199;">Or paste this URL: <span style="word-break:break-all;">${url}</span></p>
    <p style="font-size:12px;color:#8a9199;">The link expires in 15 minutes and can be used once.</p>`;
  return {
    to,
    subject: "Your ContractLens sign-in link",
    html: wrap(body),
    text: `Sign in to ContractLens: ${url}\n\nThe link expires in 15 minutes and can be used once.`
  };
}

export function alertEmail(to: string, opts: {
  obligationTitle: string;
  contractTitle: string;
  dueDate: string | null;
  offsetDays: number;
  appUrl: string;
  link: string;
}): EmailMessage {
  const due = opts.dueDate ?? "date pending";
  const when =
    opts.offsetDays === 0 ? "due today" :
    opts.offsetDays > 0 ? `due in ${opts.offsetDays} days` :
    `was due ${Math.abs(opts.offsetDays)} days ago`;
  const body = `
    <p><strong>${escapeHtml(opts.obligationTitle)}</strong> — ${escapeHtml(opts.contractTitle)}</p>
    <p>This obligation ${when}. Due date: <strong>${escapeHtml(due)}</strong>.</p>
    <p><a href="${opts.appUrl}${opts.link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:9px 18px;border-radius:999px;font-size:13px;">Open in ContractLens</a></p>`;
  return {
    to,
    subject: `Reminder: ${opts.obligationTitle} (${when})`,
    html: wrap(body),
    text: `Reminder: ${opts.obligationTitle} — ${opts.contractTitle}. ${when}. Due ${due}. Open: ${opts.appUrl}${opts.link}`
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
