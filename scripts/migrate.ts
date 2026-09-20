import "dotenv/config";

async function main() {
  const { pool } = await import("../src/lib/db/client");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const dir = path.join(process.cwd(), "drizzle");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(`CREATE TABLE IF NOT EXISTS migrations_applied (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  for (const file of files) {
    const { rowCount } = await pool.query("SELECT 1 FROM migrations_applied WHERE filename = $1", [file]);
    if (rowCount && rowCount > 0) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    const sqlText = await fs.readFile(path.join(dir, file), "utf8");
    console.log(`→ applying ${file}`);
    await pool.query(sqlText);
    await pool.query("INSERT INTO migrations_applied (filename) VALUES ($1)", [file]);
  }

  await pool.end();
  console.log("migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
