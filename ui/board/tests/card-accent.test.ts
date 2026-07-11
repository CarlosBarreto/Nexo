import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { accentGlowVars } from "../src/card-accent.ts";

describe("accentGlowVars", () => {
  it("returns no overrides when there is no accent", () => {
    assert.deepEqual(accentGlowVars(undefined, true), {});
  });

  it("returns no overrides when the card is not running", () => {
    // The comet only spins while running, so a resting card has nothing to tint.
    assert.deepEqual(accentGlowVars("#f08b3e", false), {});
  });

  it("retints all five comet stops for a running accented card", () => {
    const vars = accentGlowVars("#f08b3e", true);
    assert.deepEqual(vars, {
      "--glow-c1": "color-mix(in srgb, #f08b3e 18%, transparent)",
      "--glow-c2": "#f08b3e",
      "--glow-c3": "color-mix(in srgb, #f08b3e 70%, #fff)",
      "--glow-c4": "#f08b3e",
      "--glow-c5": "color-mix(in srgb, #f08b3e 60%, #fff)",
    });
  });

  it("puts the raw accent colour at the comet core (c2 and c4)", () => {
    const vars = accentGlowVars("var(--el-water)", true);
    assert.equal(vars["--glow-c2"], "var(--el-water)");
    assert.equal(vars["--glow-c4"], "var(--el-water)");
  });
});
