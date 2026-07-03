import { expect, test } from "vitest";
import { docKey } from "./layout";
import {
  composeEpisodeMd,
  episodeKey,
  episodesDirKey,
  listEpisodes,
  loadEpisode,
  loadMemory,
  migrateLearningsToMemory,
  parseEpisodeMd,
  saveMemory,
} from "./memory";
import type { FileStore } from "./store";

function memStore(): FileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readText: async (key) => files.get(key) ?? null,
    writeText: async (key, content) => {
      files.set(key, content);
    },
    list: async (prefix) =>
      [...files.keys()].filter((k) => k.startsWith(`${prefix}/`)).sort(),
  };
}

test("loadMemory: missing file → empty layers; round-trips through saveMemory", async () => {
  const store = memStore();
  expect(await loadMemory(store, "root")).toEqual({
    memory: { profile: [], operational: [] },
    diagnostics: [],
  });

  const memory = {
    profile: [{ id: "f1", text: "owner is Carlos", created_at: "2026-07-02" }],
    operational: [
      {
        id: "g1",
        text: "ship tier 2",
        status: "active" as const,
        created_at: "2026-07-02",
      },
    ],
  };
  await saveMemory(store, "root", memory);
  expect((await loadMemory(store, "root")).memory).toEqual(memory);
});

test("loadMemory drops malformed entries with diagnostics, never silently", async () => {
  const store = memStore();
  await store.writeText(
    docKey("root", "memory"),
    JSON.stringify({
      profile: [{ id: "ok", text: "fine" }, { id: 42 }, "junk"],
      operational: [{ id: "g1", text: "goal", status: "someday" }],
    }),
  );
  const { memory, diagnostics } = await loadMemory(store, "root");
  expect(memory.profile).toHaveLength(1);
  expect(memory.profile[0]?.text).toBe("fine");
  expect(memory.operational).toHaveLength(0); // bad status dropped
  expect(diagnostics).toHaveLength(3);
});

test("migrateLearningsToMemory: learnings become the profile ONCE; learnings stay intact", async () => {
  const store = memStore();
  const learnings = [
    { id: "l1", text: "likes pipelines", created_at: "2026-06-01" },
  ];
  await store.writeText(docKey("root", "learnings"), JSON.stringify(learnings));

  expect(await migrateLearningsToMemory(store, "root")).toBe(true);
  const { memory } = await loadMemory(store, "root");
  expect(memory.profile).toEqual(learnings);
  expect(store.files.get(docKey("root", "learnings"))).toBe(
    JSON.stringify(learnings), // untouched
  );

  // Idempotent: a second call is a no-op even after the profile diverges.
  await saveMemory(store, "root", { profile: [], operational: [] });
  expect(await migrateLearningsToMemory(store, "root")).toBe(false);
  expect((await loadMemory(store, "root")).memory.profile).toEqual([]);
});

test("migrateLearningsToMemory: nothing to migrate → no file written", async () => {
  const store = memStore();
  expect(await migrateLearningsToMemory(store, "root")).toBe(false);
  expect(store.files.has(docKey("root", "memory"))).toBe(false);
});

test("episodes: compose → parse round-trip, list + detail", async () => {
  const store = memStore();
  const md = composeEpisodeMd({
    title: "Kickoff call",
    createdIsoDate: "2026-07-02",
    content: "We agreed on the roadmap.",
  });
  await store.writeText(episodeKey("root", "ep-1"), md);
  await store.writeText(
    `${episodesDirKey("root")}/nested/ignored.md`,
    "not top-level",
  );

  const { items } = await listEpisodes(store, "root");
  expect(items).toEqual([
    { id: "ep-1", title: "Kickoff call", created: "2026-07-02" },
  ]);

  const detail = await loadEpisode(store, "root", "ep-1");
  expect(detail?.content.trim()).toBe("We agreed on the roadmap.");
  expect(await loadEpisode(store, "root", "missing")).toBeNull();
});

test("parseEpisodeMd degrades gracefully: no frontmatter → body-only, id as title", () => {
  const { summary, body } = parseEpisodeMd("raw", "just notes");
  expect(summary).toEqual({ id: "raw", title: "raw", created: null });
  expect(body).toBe("just notes");
});
