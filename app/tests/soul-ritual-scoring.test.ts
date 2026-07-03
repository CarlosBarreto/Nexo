import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  RITUAL_CHAPTERS,
  type RitualElement,
} from "../src/components/shell/soul-ritual/chapters.ts";
import { scoreRitual } from "../src/components/shell/soul-ritual/scoring.ts";

describe("scoreRitual", () => {
  it("a clear majority wins", () => {
    strictEqual(
      scoreRitual(["fire", "fire", "fire", "water", "earth"]),
      "fire",
    );
  });

  it("the manifesto (last answer) scores double", () => {
    // fire 2, water 2, earth 0+2: the doubled manifesto beats the split field.
    strictEqual(
      scoreRitual(["fire", "fire", "water", "water", "earth"]),
      "earth",
    );
  });

  it("a full tie breaks toward the manifesto's element", () => {
    // fire 2, water 2, air 0+2: three-way tie; the manifesto (air) is tied → air.
    strictEqual(scoreRitual(["fire", "fire", "water", "water", "air"]), "air");
  });

  it("an empty ritual falls back to air", () => {
    strictEqual(scoreRitual([]), "air");
  });

  it("every chapter covers all four elements exactly once", () => {
    for (const chapter of RITUAL_CHAPTERS) {
      const elements = chapter.options.map((o) => o.element).sort();
      strictEqual(
        JSON.stringify(elements),
        JSON.stringify(["air", "earth", "fire", "water"]),
        `chapter ${chapter.id}`,
      );
    }
    strictEqual(RITUAL_CHAPTERS.length, 5);
  });

  it("is deterministic for same-element walkthroughs", () => {
    for (const element of ["fire", "water", "earth", "air"] as const) {
      const answers: RitualElement[] = Array.from({ length: 5 }, () => element);
      strictEqual(scoreRitual(answers), element);
    }
  });
});
