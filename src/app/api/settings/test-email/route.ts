/* Send a test email through the configured EmailPort — proves the automation
   (magic-link sign-in + due-date alerts) end to end from Settings. */
import { getCtx } from "@/lib/auth";
import { email, alertEmail } from "@/lib/email";
import { z } from "zod";

const Body = z.object({ to: z.string().email().optional() });

/** Current email automation config (no send) for the settings UI. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const mailer = email();
  return Response.json({ provider: mailer.provider, from: mailer.from, live: mailer.provider !== "console" });
}

export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) return Response.json({ error: { code: "validation_failed", message: "Enter a valid email." } }, { status: 422 });
  const to = parse.data.to ?? ctx.email;

  const msg = alertEmail(to, {
    obligationTitle: "Test alert — ContractLens email automation",
    contractTitle: "Northwind MSA v3 (demo)",
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    offsetDays: 30,
    appUrl: process.env.APP_URL || "http://localhost:3000",
    link: `/w/${ctx.workspaceId}/dashboard`
  });
  msg.subject = `[ContractLens] Test email — delivery works ✓`;
  msg.text = `This is a test from your ContractLens localhost instance.\n\nIf you received this, sign-in links and due-date alert emails are flowing through ${ctx.email === to ? "your" : "the configured"} Gmail.\n\nAI assistance. Verify before relying. This is not legal advice.`;
  msg.html = `<div style="font-family:ui-monospace,Menlo,monospace;font-size:14px;line-height:1.6;max-width:560px">
  <p><strong>ContractLens email automation works ✓</strong></p>
  <p>Sign-in links and due-date alerts will arrive from this address.</p>
  <p style="color:#777;font-size:12px">AI assistance. Verify before relying. This is not legal advice.</p>
</div>`;

  const result = await email().send(msg);
  return Response.json({
    delivered: result.delivered,
    provider: result.provider,
    to,
    error: result.error ?? null
  }, { status: result.delivered ? 200 : 502 });
}
