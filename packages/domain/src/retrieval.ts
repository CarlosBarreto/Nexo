/**
 * Hybrid retrieval over the episodic memory layer (Axie precision-RAG,
 * scoped to what runs everywhere): a dependency-free BM25 ranking, an
 * optional vector ranking behind the Embedder port, and Reciprocal Rank
 * Fusion to merge them. No embedder configured → the fusion degrades to
 * plain BM25, deterministically — retrieval never requires a network call.
 */

export interface RetrievalDoc {
  id: string;
  text: string;
}

export interface RankedDoc {
  id: string;
  score: number;
}

/** Pluggable embeddings provider; wire one in to activate the vector ranking. */
export interface Embedder {
  /** One vector per input text, all the same dimension. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Unicode-aware tokens (Spanish/Portuguese accents survive), lowercased. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const K1 = 1.5;
const B = 0.75;

/** Classic Okapi BM25. Only docs with a positive score rank. */
export function bm25Rank(query: string, docs: RetrievalDoc[]): RankedDoc[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || docs.length === 0) return [];

  const docCounts = docs.map((d) => {
    const counts = new Map<string, number>();
    const terms = tokenize(d.text);
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    return { counts, length: terms.length };
  });
  const avgLength =
    docCounts.reduce((sum, d) => sum + d.length, 0) / docs.length;

  // Document frequency per query term, computed once.
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const df = docCounts.filter((d) => d.counts.has(term)).length;
    idf.set(term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)));
  }

  const scores: RankedDoc[] = [];
  for (const [i, doc] of docs.entries()) {
    const { counts, length } = docCounts[i] ?? { counts: new Map(), length: 0 };
    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      score +=
        ((idf.get(term) ?? 0) * tf * (K1 + 1)) /
        (tf + K1 * (1 - B + (B * length) / (avgLength || 1)));
    }
    if (score > 0) scores.push({ id: doc.id, score });
  }
  return scores.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: each ranking contributes 1/(k + rank) per doc.
 * Order-of-magnitude-different score scales (BM25 vs cosine) fuse cleanly
 * because only RANKS matter. Ties break by id for determinism.
 */
export function rrfMerge(rankings: string[][]): RankedDoc[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (const [rank, id] of ranking.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * The hybrid pipeline: BM25 always; vector ranking when an embedder is
 * wired; RRF merges whatever rankings exist. An embedder failure surfaces —
 * silently degrading to BM25 would hide a broken provider (beta policy).
 */
export async function retrieveDocs(input: {
  query: string;
  docs: RetrievalDoc[];
  embedder?: Embedder;
  limit?: number;
}): Promise<RankedDoc[]> {
  const limit = input.limit ?? 3;
  const rankings: string[][] = [];

  const bm25 = bm25Rank(input.query, input.docs);
  if (bm25.length > 0) rankings.push(bm25.map((d) => d.id));

  if (input.embedder && input.docs.length > 0) {
    const [queryVector, ...docVectors] = await input.embedder.embed([
      input.query,
      ...input.docs.map((d) => d.text),
    ]);
    if (queryVector) {
      const ranked = input.docs
        .map((doc, i) => ({
          id: doc.id,
          score: cosineSimilarity(queryVector, docVectors[i] ?? []),
        }))
        .filter((d) => d.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      if (ranked.length > 0) rankings.push(ranked.map((d) => d.id));
    }
  }

  return rrfMerge(rankings).slice(0, limit);
}

/** A short excerpt for a hit: the first line containing a query term, else the head. */
export function excerptFor(
  query: string,
  text: string,
  maxLength = 160,
): string {
  const terms = new Set(tokenize(query));
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const hit =
    lines.find((line) => tokenize(line).some((t) => terms.has(t))) ??
    lines[0] ??
    "";
  return hit.length > maxLength ? `${hit.slice(0, maxLength - 1)}…` : hit;
}
