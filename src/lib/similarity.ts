/** Normalisation for citation comparison: collapse whitespace, unify quotes/dashes. */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Dice coefficient on character bigrams — cheap, robust for short spans. */
export function diceSimilarity(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(na);
  const mb = bigrams(nb);
  let overlap = 0;
  for (const [g, c] of ma) overlap += Math.min(c, mb.get(g) ?? 0);
  return (2 * overlap) / ([...ma.values()].reduce((s, x) => s + x, 0) + [...mb.values()].reduce((s, x) => s + x, 0));
}

/** Re-anchor a quote within a page's text using normalised sliding windows. */
export function findSlice(
  pageText: string,
  quoted: string,
  hintStart?: number
): { start: number; end: number; score: number } | null {
  const nq = normalizeForCompare(quoted);
  if (!nq) return null;
  const qLen = nq.length;
  const candidates: { start: number; end: number; score: number }[] = [];

  const scoreAt = (start: number, end: number): number =>
    diceSimilarity(pageText.slice(start, end), quoted);

  // 1. Direct normalised scan for the exact quote (handles punctuation drift).
  const direct = pageText.indexOf(quoted);
  if (direct >= 0) {
    return { start: direct, end: direct + quoted.length, score: 1 };
  }

  // 2. Normalised full-text scan: build normalised index map.
  const normMap: number[] = [];
  const normChars: string[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < pageText.length; i++) {
    const ch = pageText[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) { normChars.push(" "); normMap.push(i); lastWasSpace = true; }
    } else {
      const mapped = ch
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .toLowerCase();
      normChars.push(mapped);
      normMap.push(i);
      lastWasSpace = ch === " " ? true : false;
      if (/\s/.test(pageText[i + 1] ?? "x")) lastWasSpace = false;
    }
  }
  const normalizedPage = normChars.join("");
  let idx = normalizedPage.indexOf(nq);
  while (idx >= 0) {
    const start = normMap[idx];
    const endIdx = Math.min(idx + qLen - 1, normMap.length - 1);
    const end = normMap[endIdx] + 1;
    candidates.push({ start, end, score: scoreAt(start, end) });
    idx = normalizedPage.indexOf(nq, idx + 1);
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => (Math.abs(a.start - (hintStart ?? a.start)) - Math.abs(b.start - (hintStart ?? b.start))));
    return candidates[0];
  }

  // 3. Fuzzy window search around the hint or across the page.
  const span = Math.max(quoted.length, 40);
  const step = Math.max(20, Math.floor(span / 4));
  const from = hintStart !== undefined ? Math.max(0, hintStart - span * 4) : 0;
  const to = hintStart !== undefined ? Math.min(pageText.length, hintStart + span * 4) : pageText.length;
  let best: { start: number; end: number; score: number } | null = null;
  for (let s = from; s + span <= to; s += step) {
    for (const size of [span, Math.floor(span * 0.8), Math.ceil(span * 1.25)]) {
      if (s + size > pageText.length) continue;
      const score = scoreAt(s, s + size);
      if (!best || score > best.score) best = { start: s, end: s + size, score };
    }
  }
  return best && best.score >= 0.5 ? best : null;
}

/** Lexical grounding proxy: content-word overlap between a claim and its evidence. */
export function lexicalOverlap(claim: string, evidence: string): number {
  const STOP = new Set(["the", "a", "an", "of", "to", "in", "and", "or", "is", "are", "was", "were", "be", "been", "by", "for", "with", "on", "at", "as", "it", "this", "that", "shall", "may", "will", "would", "any", "all", "such", "from", "under", "not", "no", "unless", "if", "but", "which", "who", "whom", "whose"]);
  const words = (s: string) =>
    new Set(normalizeForCompare(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
  const wc = words(claim);
  const we = words(evidence);
  if (wc.size === 0) return 0;
  let hit = 0;
  for (const w of wc) if (we.has(w)) hit++;
  return hit / wc.size;
}
