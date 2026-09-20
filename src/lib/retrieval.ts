import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { embeddings } from "./ports";

export interface EvidenceChunk {
  chunkId: string;
  documentVersionId: string;
  contractId: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  sectionRef: string | null;
  ocrDerived: boolean;
  score: number;
}

/** RRF constant (doc 02 §5.2). */
const RRF_K = 60;

/**
 * Hybrid retrieval with permission pre-filter. Authorisation is resolved BEFORE
 * the vector search — the SQL where clause always includes workspace and the
 * authorized version set (FR-QA-01, doc 02 principle 5).
 */
export async function hybridRetrieve(opts: {
  workspaceId: string;
  authorizedVersionIds: string[];
  question: string;
  topK?: number;
}): Promise<EvidenceChunk[]> {
  const topK = opts.topK ?? 8;
  if (opts.authorizedVersionIds.length === 0) return [];

  const emb = embeddings();
  const [qVec] = await emb.embed([opts.question]);
  const vecLiteral = `[${qVec.join(",")}]`;
  const versionList = opts.authorizedVersionIds;
  // Parameterized array literal — pass the whole `{...}` literal as ONE bound
  // string param and cast it; a JS array renders as a bare string that Postgres
  // rejects (22P02), and raw braces are a syntax error (42601).
  const pgArray = (vals: string[]) =>
    sql`${`{${vals.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",")}}`}::text[]`;

  // Vector top-40 (permission-filtered). The halfvec cast must match the
  // idx_chunks_vec expression index exactly (embedding column is vector(2048);
  // plain-vector HNSW caps at 2000 dims, the index is a halfvec expression).
  const vec = await db.execute<{ id: string; score: number }>(sql`
    SELECT id, 1 - ((embedding::halfvec(2048)) <=> (${vecLiteral}::vector)::halfvec(2048)) AS score
    FROM chunks
    WHERE workspace_id = ${opts.workspaceId}
      AND document_version_id = ANY(${pgArray(versionList)})
      AND embedding IS NOT NULL
    ORDER BY (embedding::halfvec(2048)) <=> (${vecLiteral}::vector)::halfvec(2048)
    LIMIT 40
  `);

  // FTS top-40 (permission-filtered).
  const fts = await db.execute<{ id: string; score: number }>(sql`
    SELECT id, ts_rank(tsv, websearch_to_tsquery('english', ${opts.question})) AS score
    FROM chunks
    WHERE workspace_id = ${opts.workspaceId}
      AND document_version_id = ANY(${pgArray(versionList)})
      AND tsv @@ websearch_to_tsquery('english', ${opts.question})
    ORDER BY score DESC
    LIMIT 40
  `);

  // Reciprocal Rank Fusion.
  const rrf = new Map<string, number>();
  vec.rows.forEach((row, rank) => {
    rrf.set(row.id, (rrf.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  fts.rows.forEach((row, rank) => {
    rrf.set(row.id, (rrf.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  const topIds = [...rrf.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([id]) => id);
  if (topIds.length === 0) return [];

  const rows = await db.execute<{
    id: string; document_version_id: string; contract_id: string; text: string;
    page_start: number; page_end: number; char_start: number; char_end: number;
    section_ref: string | null; ocr_derived: boolean;
  }>(sql`
    SELECT id, document_version_id, contract_id, text, page_start, page_end, char_start, char_end, section_ref, ocr_derived
    FROM chunks WHERE id = ANY(${pgArray(topIds)})
  `);
  const byId = new Map(rows.rows.map((r) => [r.id, r]));

  return topIds
    .map((cid) => {
      const r = byId.get(cid);
      if (!r) return null;
      return {
        chunkId: r.id,
        documentVersionId: r.document_version_id,
        contractId: r.contract_id,
        text: r.text,
        pageStart: r.page_start,
        pageEnd: r.page_end,
        charStart: r.char_start,
        charEnd: r.char_end,
        sectionRef: r.section_ref,
        ocrDerived: r.ocr_derived,
        score: rrf.get(cid) ?? 0
      } satisfies EvidenceChunk;
    })
    .filter((x): x is EvidenceChunk => x !== null);
}

/* ── Intent router (doc 02 §5.2): structured-first routing ────────────── */
export type Intent = "portfolio_dates" | "document_text";

const PORTFOLIO_PATTERNS = [
  /due (in|within|the next) ?(\d+)? ?(days?|weeks?|months?)/i,
  /which (contracts?|obligations?) .*(renew|expire|due|upcoming)/i,
  /(obligations?|deadlines?) .*(next|upcoming|this month|this week)/i,
  /renewals? in/i,
  /what('| i)?s (due|coming up)/i
];

export function routeIntent(question: string): { intent: Intent; windowDays?: number } {
  for (const re of PORTFOLIO_PATTERNS) {
    const m = question.match(re);
    if (m) {
      const days = m[2] ? parseInt(m[2], 10) : 30;
      return { intent: "portfolio_dates", windowDays: days };
    }
  }
  return { intent: "document_text" };
}
