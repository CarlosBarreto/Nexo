import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { mergeGalleryLabels } from "../src/agent-gallery-labels.ts";

describe("mergeGalleryLabels", () => {
  it("returns English defaults when no labels are passed", () => {
    const l = mergeGalleryLabels();
    strictEqual(l.born, "Born");
    strictEqual(l.unforged, "Unforged");
    deepStrictEqual(l.elements, {
      fire: "Fire",
      water: "Water",
      earth: "Earth",
      air: "Air",
    });
  });

  it("merges consumer labels over defaults, per element too", () => {
    const l = mergeGalleryLabels({
      born: "Nació",
      elements: { fire: "Fuego" },
    });
    strictEqual(l.born, "Nació");
    strictEqual(l.unforged, "Unforged"); // untouched default survives
    strictEqual(l.elements.fire, "Fuego");
    strictEqual(l.elements.water, "Water"); // partial element override
  });
});
