import { expect, test } from "vitest";
import { docKey } from "./layout";
import {
  deriveElement,
  ensureSoul,
  generateSoul,
  loadSoul,
  soulSeed,
} from "./soul";
import type { TextStore } from "./store";

function memStore(): TextStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readText: async (key) => files.get(key) ?? null,
    writeText: async (key, content) => {
      files.set(key, content);
    },
  };
}

const BIRTH = {
  agentId: "agent-1",
  agentName: "Test Agent",
  bornIso: "2026-07-02T18:00:00.000Z",
  newId: () => "11111111-1111-4111-8111-111111111111",
};

test("soulSeed is deterministic and hex-shaped", () => {
  expect(soulSeed("a:b:c")).toBe(soulSeed("a:b:c"));
  expect(soulSeed("a:b:c")).toMatch(/^[0-9a-f]{16}$/);
  expect(soulSeed("a:b:c")).not.toBe(soulSeed("a:b:d"));
});

test("deriveElement is stable for a given seed and always a valid element", () => {
  const seed = soulSeed("x");
  expect(deriveElement(seed)).toBe(deriveElement(seed));
  for (const input of ["a", "b", "c", "d", "e"]) {
    expect(["fire", "water", "earth", "air"]).toContain(
      deriveElement(soulSeed(input)),
    );
  }
});

test("generateSoul derives the element from the seed unless one is given", () => {
  const derived = generateSoul(BIRTH);
  expect(derived.id).toBe("soul_11111111-1111-4111-8111-111111111111");
  expect(derived.born).toBe(BIRTH.bornIso);
  expect(derived.element).toBe(deriveElement(derived.originSeed));

  const chosen = generateSoul({ ...BIRTH, element: "fire" });
  expect(chosen.element).toBe("fire");
  expect(chosen.originSeed).toBe(derived.originSeed); // same birth inputs
});

test("ensureSoul forges once and never regenerates (immutability)", async () => {
  const store = memStore();
  const first = await ensureSoul(store, "root", BIRTH);
  const second = await ensureSoul(store, "root", {
    ...BIRTH,
    agentName: "Renamed Agent",
    element: "water",
    newId: () => "22222222-2222-4222-8222-222222222222",
  });
  expect(second).toEqual(first); // existing soul wins, inputs ignored
  expect(store.files.has(docKey("root", "soul"))).toBe(true);
});

test("loadSoul surfaces a malformed soul as a diagnostic, and ensureSoul heals it", async () => {
  const store = memStore();
  const key = docKey("root", "soul");
  await store.writeText(key, JSON.stringify({ id: 42 }));
  const { soul, diagnostics } = await loadSoul(store, "root");
  expect(soul).toBeNull();
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.key).toBe(key);

  const healed = await ensureSoul(store, "root", BIRTH);
  expect(healed.element).toBe(deriveElement(healed.originSeed));
  expect((await loadSoul(store, "root")).soul).toEqual(healed);
});

test("loadSoul returns null for a missing soul without diagnostics", async () => {
  const { soul, diagnostics } = await loadSoul(memStore(), "root");
  expect(soul).toBeNull();
  expect(diagnostics).toEqual([]);
});
