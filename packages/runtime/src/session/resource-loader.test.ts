import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadMemoryContext } from "./resource-loader";

let dir: string | null = null;

function workspaceWithMemory(memory: unknown): string {
  dir = mkdtempSync(join(tmpdir(), "houston-memory-"));
  mkdirSync(join(dir, ".houston", "memory"), { recursive: true });
  writeFileSync(
    join(dir, ".houston", "memory", "memory.json"),
    typeof memory === "string" ? memory : JSON.stringify(memory),
  );
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

test("profile facts always inject; only ACTIVE goals ride along", () => {
  const cwd = workspaceWithMemory({
    profile: [
      { id: "f1", text: "The owner is Carlos.", created_at: "" },
      { id: "f2", text: "Stack is TypeScript.", created_at: "" },
    ],
    operational: [
      { id: "g1", text: "Ship tier 2.", status: "active", created_at: "" },
      { id: "g2", text: "Old goal.", status: "done", created_at: "" },
    ],
  });
  const files = loadMemoryContext(cwd);
  expect(files).toHaveLength(1);
  const content = files[0]?.content ?? "";
  expect(content).toContain("## Profile");
  expect(content).toContain("- The owner is Carlos.");
  expect(content).toContain("## Active goals");
  expect(content).toContain("- Ship tier 2.");
  expect(content).not.toContain("Old goal");
});

test("no memory file, empty layers, or unreadable JSON → no injection", () => {
  expect(loadMemoryContext(join(tmpdir(), "does-not-exist"))).toEqual([]);

  const empty = workspaceWithMemory({ profile: [], operational: [] });
  expect(loadMemoryContext(empty)).toEqual([]);
  rmSync(empty, { recursive: true, force: true });
  dir = null;

  const broken = workspaceWithMemory("not json {");
  expect(loadMemoryContext(broken)).toEqual([]);
});

test("done-only goals inject the profile without an Active goals section", () => {
  const cwd = workspaceWithMemory({
    profile: [{ id: "f1", text: "Fact.", created_at: "" }],
    operational: [{ id: "g1", text: "Done.", status: "done", created_at: "" }],
  });
  const content = loadMemoryContext(cwd)[0]?.content ?? "";
  expect(content).toContain("## Profile");
  expect(content).not.toContain("## Active goals");
});
