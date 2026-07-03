import { expect, test } from "vitest";
import {
  bm25Rank,
  cosineSimilarity,
  type Embedder,
  excerptFor,
  retrieveDocs,
  rrfMerge,
  tokenize,
} from "./retrieval";

const DOCS = [
  { id: "budget", text: "We approved the quarterly budget for marketing." },
  { id: "deploy", text: "The deploy failed twice; rollback restored service." },
  { id: "hiring", text: "Hiring plan: two engineers and one designer in Q3." },
];

test("tokenize is unicode-aware and lowercases", () => {
  expect(tokenize("Reunión de Presupuesto Q3!")).toEqual([
    "reunión",
    "de",
    "presupuesto",
    "q3",
  ]);
});

test("bm25Rank puts the on-topic doc first and omits zero-score docs", () => {
  const ranked = bm25Rank("budget marketing", DOCS);
  expect(ranked[0]?.id).toBe("budget");
  expect(ranked.map((r) => r.id)).not.toContain("deploy");
  expect(bm25Rank("", DOCS)).toEqual([]);
  expect(bm25Rank("budget", [])).toEqual([]);
});

test("rrfMerge fuses rankings by rank, deterministically", () => {
  const merged = rrfMerge([
    ["a", "b", "c"],
    ["b", "a"],
  ]);
  expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
  // a and b tie on total contribution? No: a=1/61+1/62, b=1/62+1/61 — equal.
  // The tie breaks lexicographically, pinned here so a regression surfaces.
  const a = merged.find((m) => m.id === "a");
  const b = merged.find((m) => m.id === "b");
  expect(a?.score).toBeCloseTo(b?.score ?? 0, 12);
});

test("retrieveDocs without an embedder is plain BM25", async () => {
  const hits = await retrieveDocs({ query: "rollback deploy", docs: DOCS });
  expect(hits[0]?.id).toBe("deploy");
});

test("retrieveDocs fuses the vector ranking when an embedder is wired", async () => {
  // An embedder that thinks 'hiring' is the query's nearest neighbor.
  const fake: Embedder = {
    async embed(texts) {
      return texts.map((t) => {
        if (t.includes("engineers") || t === "team growth plans") return [1, 0];
        return [0, 1];
      });
    },
  };
  // BM25 alone finds nothing for this query (no shared terms with 'hiring').
  const bm25Only = await retrieveDocs({
    query: "team growth plans",
    docs: DOCS,
  });
  expect(bm25Only.map((h) => h.id)).not.toContain("hiring");

  const hybrid = await retrieveDocs({
    query: "team growth plans",
    docs: DOCS,
    embedder: fake,
  });
  expect(hybrid[0]?.id).toBe("hiring");
});

test("an embedder failure surfaces instead of silently degrading", async () => {
  const broken: Embedder = {
    async embed() {
      throw new Error("provider down");
    },
  };
  await expect(
    retrieveDocs({ query: "budget", docs: DOCS, embedder: broken }),
  ).rejects.toThrow("provider down");
});

test("cosineSimilarity basics", () => {
  expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  expect(cosineSimilarity([], [1])).toBe(0);
});

test("excerptFor picks the first line containing a query term", () => {
  const text = "Notes from Monday.\nThe budget was approved.\nNext steps TBD.";
  expect(excerptFor("budget", text)).toBe("The budget was approved.");
  expect(excerptFor("nothing-matches", text)).toBe("Notes from Monday.");
  expect(excerptFor("budget", `${"x".repeat(200)} budget`).length).toBe(160);
});
