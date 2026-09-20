import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./index";

const connectionString = process.env.DATABASE_URL || "postgres://contractlens:contractlens@localhost:54322/contractlens";

// Supabase (and most managed Postgres) require TLS. Local dev Postgres doesn't.
// Allow ?sslmode=disable in the URL to opt out explicitly; otherwise enable SSL
// for any non-local host and accept Supabase's chain (no full CA verification).
const url = new URL(connectionString);
const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const sslmodeParam = url.searchParams.get("sslmode");
// Strip sslmode from the string so pg's parser never builds its own SSL config
// (which would verify the Supabase self-signed chain and fail). We pass an
// explicit `ssl` object instead.
url.searchParams.delete("sslmode");
const cleanConnectionString = url.toString();
const sslDisabled = (sslmodeParam ?? "").toLowerCase() === "disable";
const useSsl = !sslDisabled && (sslmodeParam === "require" || !isLocal);

const globalForDb = globalThis as unknown as { __clPool?: Pool };
export const pool =
  globalForDb.__clPool ??
  new Pool({
    connectionString: cleanConnectionString,
    max: 10,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
if (process.env.NODE_ENV !== "production") globalForDb.__clPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
