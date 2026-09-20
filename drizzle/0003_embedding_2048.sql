-- Widen chunk embeddings to 2048 dims for nvidia/nemotron-3-embed-1b.
-- Truncating a 2048-dim model down to 1536 would distort cosine similarity
-- (the model is not Matryoshka-trained), so the column is widened instead.
-- Plain-vector HNSW indexes cap at 2000 dims, so the ANN index uses a
-- halfvec expression (pgvector >= 0.7; Supabase runs 0.8.2).
-- Idempotent: only wipes + re-casts when the column is still 1536, so
-- re-running never destroys already-computed embeddings.
DO $$
BEGIN
  IF (
    SELECT atttypmod
    FROM pg_attribute
    WHERE attrelid = 'chunks'::regclass
      AND attname = 'embedding'
  ) = 1536 + 4 THEN  -- vector typmod: dims + VARHDRSZ offset
    UPDATE chunks SET embedding = NULL;
    ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(2048);
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_chunks_vec;
DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
CREATE INDEX IF NOT EXISTS idx_chunks_vec ON chunks USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops);
