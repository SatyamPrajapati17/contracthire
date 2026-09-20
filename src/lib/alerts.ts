import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { id } from "./ids";
import { email, alertEmail } from "./email";

const DEFAULT_OFFSETS = [90, 30, 14, 7, 1];

export interface ObligationLike {
  id: string;
  workspaceId: string;
  dueDate: string | null;
  ownerUserId: string | null;
  priority: string;
  gracePeriodDays: number;
}

/** Schedule alerts for an accepted obligation (90/30/14/7/1 days before due). */
export async function scheduleAlertsFor(
  obligation: ObligationLike,
  channel: "in_app" | "email" = "in_app",
  timezone = "UTC"
): Promise<number> {
  if (!obligation.dueDate) return 0;
  const due = new Date(`${obligation.dueDate}T09:00:00Z`);
  let created = 0;

  const offsetsInPast = DEFAULT_OFFSETS.filter((o) => {
    const when = new Date(due.getTime() - o * 86400000);
    return when.getTime() <= Date.now();
  });

  for (const offset of DEFAULT_OFFSETS) {
    const when = new Date(due.getTime() - offset * 86400000);
    // Offset pruning: past offsets are skipped except the nearest future one;
    // if due < 7 days away, a single immediate alert is scheduled.
    if (when.getTime() <= Date.now()) {
      const isNearestFuture = offset === Math.max(...DEFAULT_OFFSETS.filter((o) => !offsetsInPast.includes(o)), -1);
      if (!isNearestFuture) continue;
    }
    let scheduledFor: Date;
    if (due.getTime() - Date.now() < 7 * 86400000 && when.getTime() <= Date.now()) {
      scheduledFor = new Date();
    } else {
      scheduledFor = atNineLocal(when, timezone);
    }
    // Idempotent insert — one row per (obligation, offset, channel).
    const res = await db.execute(sql`
      INSERT INTO alert_schedules (id, workspace_id, obligation_id, offset_days, channel, recipient_user_id, scheduled_for, status)
      VALUES (${id("as")}, ${obligation.workspaceId}, ${obligation.id}, ${offset}, ${channel}, ${obligation.ownerUserId}, ${scheduledFor.toISOString()}, 'scheduled')
      ON CONFLICT (obligation_id, offset_days, channel) DO NOTHING
    `);
    created += res.rowCount ?? 0;
  }
  return created;
}

function atNineLocal(when: Date, timezone: string): Date {
  try {
    // Format the calendar date in the target tz, then anchor 09:00 local time.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
    });
    const iso = fmt.format(when); // YYYY-MM-DD
    // Compute the UTC instant of 09:00 in that tz.
    const guess = new Date(`${iso}T09:00:00Z`);
    const offsetOfTz = (d: Date) => {
      const local = new Date(d.toLocaleString("en-US", { timeZone: timezone }));
      return local.getTime() - d.getTime();
    };
    let target = new Date(guess.getTime() - offsetOfTz(guess));
    if (offsetOfTz(target) !== offsetOfTz(guess)) {
      target = new Date(guess.getTime() - offsetOfTz(target));
    }
    return target;
  } catch {
    return when;
  }
}

/** Cancel pending (unsent) schedules; sent history is immutable (FR-AL-05). */
export async function rescheduleAlertsFor(obligationId: string, newDueDate: string | null, workspaceId: string): Promise<void> {
  await db.execute(sql`
    UPDATE alert_schedules SET status = 'cancelled', cancelled_reason = 'due date changed'
    WHERE obligation_id = ${obligationId} AND status IN ('scheduled', 'due')
      AND id NOT IN (SELECT alert_schedule_id FROM alert_deliveries WHERE delivered_at IS NOT NULL)
  `);
  if (!newDueDate) return;
  const ob = await db.execute<{ id: string; workspace_id: string; owner_user_id: string | null; priority: string; grace_period_days: number }>(sql`
    SELECT id, workspace_id, owner_user_id, priority, grace_period_days FROM obligations WHERE id = ${obligationId}
  `);
  const row = ob.rows[0];
  if (!row) return;
  await scheduleAlertsFor({
    id: row.id,
    workspaceId: row.workspace_id,
    dueDate: newDueDate,
    ownerUserId: row.owner_user_id,
    priority: row.priority,
    gracePeriodDays: row.grace_period_days
  });
  void workspaceId;
}

/** Cron sweep (every 15 min): deliver due in-app alerts, mark overdue obligations. */
export async function runAlertSweep(): Promise<void> {
  // Deliver due alerts.
  const due = await db.execute<{
    id: string; workspace_id: string; obligation_id: string; offset_days: number; channel: string; recipient_user_id: string | null; scheduled_for: string;
  }>(sql`
    SELECT s.id, s.workspace_id, s.obligation_id, s.offset_days, s.channel, s.recipient_user_id, s.scheduled_for
    FROM alert_schedules s
    WHERE s.status = 'scheduled' AND s.scheduled_for <= now()
    LIMIT 50
  `);

  for (const s of due.rows) {
    const idemKey = `${s.obligation_id}:${s.offset_days}:${s.channel}`;
    // Delivery idempotency: unique idempotency_key prevents double-send.
    // Rows start 'pending' and flip to sent/failed after the transport runs.
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO alert_deliveries (id, workspace_id, alert_schedule_id, attempt, status, idempotency_key)
      VALUES (${id("ad")}, ${s.workspace_id}, ${s.id}, 1, 'pending', ${idemKey})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);
    if ((inserted.rowCount ?? 0) === 0) continue; // already delivered by a prior sweep
    const deliveryId = inserted.rows[0]?.id;

    if (s.channel === "email") {
      // Email automation (phase 10): Gmail API when connected; SMTP/console
      // fallback otherwise. Never silent — failures are recorded and retried
      // with backoff by leaving the schedule eligible.
      const obInfo = await db.execute<{ title: string; contract_id: string; due_date: string | null; due_date_math: string | null }>(sql`
        SELECT title, contract_id, due_date, due_date_math FROM obligations WHERE id = ${s.obligation_id}
      `);
      const ob = obInfo.rows[0];
      if (ob) {
        const ctInfo = await db.execute<{ title: string }>(sql`SELECT title FROM contracts WHERE id = ${ob.contract_id}`);
        const recipients = s.recipient_user_id
          ? (await db.execute<{ email: string }>(sql`SELECT email FROM users WHERE id = ${s.recipient_user_id}`)).rows.map((r) => r.email)
          : (await db.execute<{ email: string }>(sql`
              SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.workspace_id = ${s.workspace_id} AND m.role IN ('workspace_admin','contract_owner') LIMIT 5
            `)).rows.map((r) => r.email);
        const appUrl = process.env.APP_URL || "http://localhost:3000";
        const { sendViaGmail, gmailAlertEmail } = await import("./gmail");
        let allOk = true;
        let lastError = "";
        for (const to of recipients) {
          const gmailMsg = gmailAlertEmail({
            to,
            obligationTitle: ob.title,
            contractTitle: ctInfo.rows[0]?.title ?? "Contract",
            dueDate: ob.due_date,
            dueDateMath: ob.due_date_math,
            offsetDays: Number(s.offset_days),
            appUrl,
            link: `/w/alerts`
          });
          let delivered = false;
          let errText = "";
          const viaGmail = await sendViaGmail(s.workspace_id, gmailMsg);
          if (viaGmail.ok) {
            delivered = true;
          } else if (viaGmail.error === "not_connected" || viaGmail.error === "scope_not_granted") {
            errText = "Gmail not connected — connect Google in Settings → Connected accounts";
            // Fallback transport (SMTP or dev console) so alerts still flow.
            const msg = alertEmail(to, {
              obligationTitle: ob.title,
              contractTitle: ctInfo.rows[0]?.title ?? "Contract",
              dueDate: ob.due_date,
              offsetDays: Number(s.offset_days),
              appUrl,
              link: `/w/alerts`
            });
            const send = await email().send(msg);
            delivered = send.delivered;
            if (!send.delivered) errText = send.error ?? errText;
          } else {
            errText = viaGmail.detail ?? "gmail api error";
          }
          if (!delivered) { allOk = false; lastError = errText; console.warn(`[alerts] email delivery failed for ${to}: ${errText}`); }
        }
        if (allOk) {
          await db.execute(sql`UPDATE alert_deliveries SET status = 'sent', delivered_at = now() WHERE id = ${deliveryId}`);
        } else {
          // Backoff: drop the delivery row so a later sweep retries; push the
          // schedule 15 minutes out. Failure is never silent.
          await db.execute(sql`DELETE FROM alert_deliveries WHERE id = ${deliveryId}`);
          await db.execute(sql`UPDATE alert_schedules SET scheduled_for = now() + interval '15 minutes' WHERE id = ${s.id}`);
          await db.execute(sql`UPDATE alert_schedules SET status = 'scheduled' WHERE id = ${s.id}`);
          void lastError;
          continue;
        }
      }
    }

    if (s.channel === "in_app") {
      const obInfo = await db.execute<{ title: string; contract_id: string; due_date: string | null }>(sql`
        SELECT title, contract_id, due_date FROM obligations WHERE id = ${s.obligation_id}
      `);
      const ob = obInfo.rows[0];
      if (ob) {
        const ctInfo = await db.execute<{ title: string }>(sql`
          SELECT title FROM contracts WHERE id = ${ob.contract_id}
        `);
        const contractTitle = ctInfo.rows[0]?.title ?? "Contract";
        const recipients = s.recipient_user_id
          ? [s.recipient_user_id]
          : (await db.execute<{ user_id: string }>(sql`
              SELECT user_id FROM memberships WHERE workspace_id = ${s.workspace_id} AND role IN ('workspace_admin','contract_owner') LIMIT 5
            `)).rows.map((r) => r.user_id);
        for (const uid of recipients) {
          await db.execute(sql`
            INSERT INTO notifications (id, workspace_id, user_id, kind, title, body, link, alert_schedule_id)
            VALUES (${id("nt")}, ${s.workspace_id}, ${uid}, 'alert',
              ${`Reminder: ${ob.title}`},
              ${`${contractTitle} — due ${ob.due_date ?? "date pending"}`},
              ${`/obligations?focus=${ob.contract_id}`},
              ${s.id})
          `);
        }
        await db.execute(sql`UPDATE alert_deliveries SET status = 'sent', delivered_at = now() WHERE id = ${deliveryId}`);
      }
    }
    await db.execute(sql`UPDATE alert_schedules SET status = 'sent' WHERE id = ${s.id}`);
  }

  // Overdue sweep: active + due_date + grace < now → overdue.
  await db.execute(sql`
    UPDATE obligations SET status = 'overdue', updated_at = now()
    WHERE status = 'active' AND due_date IS NOT NULL
      AND (due_date + make_interval(days => grace_period_days)) < CURRENT_DATE
  `);
}
