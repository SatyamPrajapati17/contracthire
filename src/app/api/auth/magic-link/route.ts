import { NextRequest } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { email, magicLinkEmail } from "@/lib/email";
import { z } from "zod";

const Body = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) {
    return Response.json({ error: { code: "validation_failed", message: "Enter a valid email." } }, { status: 422 });
  }
  const url = await createMagicLink(parse.data.email);

  // Email automation: with EMAIL_PROVIDER=gmail/resend the link is emailed; with
  // the default console provider it is logged. Either way, non-production keeps
  // dev_url in the response so localhost sign-in needs no mailbox.
  const mailer = email();
  const isGmail = mailer.provider === "gmail";
  const result = await mailer.send(magicLinkEmail(parse.data.email, url, { textOnly: isGmail }));

  if (process.env.NODE_ENV !== "production") {
    return Response.json({ sent: true, dev_url: url, email_provider: result.provider, email_delivered: result.delivered, email_error: result.error });
  }
  return Response.json({ sent: true, email_provider: result.provider, email_delivered: result.delivered, email_error: result.error });
}
