import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  const section = req.nextUrl.searchParams.get("section") ?? "upcoming";

  const base = sql`
    SELECT s.id, s.obligation_id, s.offset_days, s.channel, s.scheduled_for, s.status,
           o.title AS obligation_title, o.due_date, c.title AS contract_title, c.id AS contract_id,
           cit.page, cit.section_ref,
           u.email AS recipient_email, w.timezone
    FROM alert_schedules s
    JOIN obligations o ON o.id = s.obligation_id
    JOIN contracts c ON c.id = o.contract_id
    JOIN workspaces w ON w.id = s.workspace_id
    LEFT JOIN citations cit ON cit.id = o.citation_id
    LEFT JOIN users u ON u.id = s.recipient_user_id
    WHERE s.workspace_id = ${ctx.workspaceId}
  `;

  let rows;
  if (section === "sent") {
    rows = await db.execute(sql`${base} AND s.status = 'sent' ORDER BY s.scheduled_for DESC LIMIT 100`);
  } else if (section === "needs_action") {
    rows = await db.execute(sql`${base} AND s.scheduled_for <= now() AND s.status = 'scheduled' ORDER BY s.scheduled_for ASC LIMIT 100`);
  } else {
    rows = await db.execute(sql`${base} AND s.status = 'scheduled' AND s.scheduled_for > now() ORDER BY s.scheduled_for ASC LIMIT 100`);
  }

  const data = (rows.rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    preview: {
      recipient: (r.recipient_email as string) ?? ctx.email,
      channel: r.channel,
      scheduled_for: r.scheduled_for,
      timezone: r.timezone,
      source_citation: r.page ? { page: r.page, section_ref: r.section_ref } : null
    }
  }));
  return Response.json({ data });
}
