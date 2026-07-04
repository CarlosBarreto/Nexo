import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  hasSeenLunariaIntro,
  markLunariaIntroSeen,
} from "../src/components/shell/lunaria-intro/state.ts";

/** Minimal in-memory Web Storage stand-in for the node test runner. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const g = globalThis as { localStorage?: Storage };

beforeEach(() => {
  g.localStorage = new MemoryStorage() as unknown as Storage;
});

afterEach(() => {
  g.localStorage = undefined;
});

test("a fresh install has not seen the intro", () => {
  assert.equal(hasSeenLunariaIntro(), false);
});

test("marking the intro seen persists across reads", () => {
  markLunariaIntroSeen();
  assert.equal(hasSeenLunariaIntro(), true);
});

test("marking is idempotent", () => {
  markLunariaIntroSeen();
  markLunariaIntroSeen();
  assert.equal(hasSeenLunariaIntro(), true);
});

test("a broken/absent store fails 'seen' so it never traps the user", () => {
  // No localStorage at all -> reads throw -> treated as already seen.
  g.localStorage = undefined;
  assert.equal(hasSeenLunariaIntro(), true);

  // A store whose getItem throws behaves the same way.
  g.localStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  } as unknown as Storage;
  assert.equal(hasSeenLunariaIntro(), true);
  // And marking must not throw even when the store is hostile.
  assert.doesNotThrow(() => markLunariaIntroSeen());
});
