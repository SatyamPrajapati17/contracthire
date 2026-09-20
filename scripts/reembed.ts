/* Re-embed all chunks with the current EmbeddingPort (used after switching
   embedding providers or dimensions). Read-only on chunk text; only the
   embedding column is updated. Run: npx tsx scripts/reembed.ts */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { chunks } from "../src/lib/db/text-schema";
import { embeddings, type EmbeddingPort } from "../src/lib/ports";

async function embedAll(emb: EmbeddingPort, texts: string[], size: number): Promise<number[][]> {
  try {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += size) {
      const part = texts.slice(i, i + size).map((t) => t.slice(0, 4000));
      out.push(...(await emb.embed(part)));
    }
    return out;
  } catch (err) {
    if (size <= 1) throw err;
    const smaller = Math.max(1, Math.floor(size / 2));
    console.warn(`  batch size ${size} failed (${err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)}), retrying with ${smaller}`);
    return embedAll(emb, texts, smaller);
  }
}

async function main() {
  const emb = embeddings();
  console.log(`reembed: provider=${emb.provider} model=${emb.model} dim=${emb.dim}`);
  const rows = await db.select({ id: chunks.id, text: chunks.text }).from(chunks);
  console.log(`reembedding ${rows.length} chunks…`);
  const vecs = await embedAll(emb, rows.map((r) => r.text), 8);
  let done = 0;
  for (let i = 0; i < rows.length; i++) {
    await db.update(chunks).set({ embedding: vecs[i] }).where(eq(chunks.id, rows[i].id));
    done++;
    if (done % 16 === 0) process.stdout.write(`  ${done}/${rows.length}\n`);
  }
  console.log(`reembed complete: ${done} chunks on ${emb.provider}/${emb.model}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("reembed failed:", err);
  process.exit(1);
});
