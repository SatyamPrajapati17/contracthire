/* App-level settings (app_settings key/value table).
   Small typed helpers — currently used for the Gmail REST sender's OAuth
   refresh token so PaaS deploys need no manual env editing. */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function getSetting(key: string): Promise<string | null> {
  try {
    const rows = await db.execute(sql`select value from app_settings where key = ${key} limit 1`);
    const list = (rows as unknown as { rows?: Array<{ value: string }> }).rows ?? (rows as unknown as Array<{ value: string }>);
    const first = list?.[0];
    return typeof first?.value === "string" ? first.value : null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    insert into app_settings (key, value, updated_at)
    values (${key}, ${value}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `);
}
