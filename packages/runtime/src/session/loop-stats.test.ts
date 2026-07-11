import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { LoopStatsAccumulator } from "./loop-stats";

const ev = (type: string) => ({ type }) as unknown as AgentSessionEvent;

test("steps count pi turn_starts (one per ReAct iteration), nothing else", () => {
  const acc = new LoopStatsAccumulator();
  for (const type of [
    "agent_start",
    "turn_start",
    "tool_execution_start",
    "tool_execution_end",
    "turn_end",
    "turn_start",
    "turn_end",
  ]) {
    acc.observe(ev(type));
  }
  const stats = acc.finish([{ name: "read" }, { name: "bash", isError: true }]);
  expect(stats.steps).toBe(2);
  expect(stats.tool_calls).toBe(2);
  expect(stats.tool_errors).toBe(1);
  expect(stats.duration_ms).toBeGreaterThanOrEqual(0);
});

test("a tool-less single-step prompt reports zeros without lying", () => {
  const acc = new LoopStatsAccumulator();
  acc.observe(ev("turn_start"));
  const stats = acc.finish([]);
  expect(stats).toMatchObject({ steps: 1, tool_calls: 0, tool_errors: 0 });
});
