import type { Routine } from "@houston/protocol";
import { expect, test } from "vitest";
import { dreamRoutineTemplate, idleDueAt } from "./dream";
import { createRoutine } from "./routines";

const NOW = "2026-06-12T12:00:00.000Z";

function routine(over: Partial<Routine> = {}): Routine {
  return {
    ...createRoutine(
      { name: "R", prompt: "p", schedule: "0 9 * * 1-5" },
      "r1",
      NOW,
    ),
    ...over,
  };
}

// --- Idle ("dream") trigger ---

const IDLE = { trigger: "idle" as const, idle_minutes: 30, schedule: "" };

function run(routineId: string, startedAtIso: string) {
  return {
    id: `run-${startedAtIso}`,
    routine_id: routineId,
    status: "surfaced" as const,
    session_key: `routine-${routineId}`,
    started_at: startedAtIso,
  };
}

test("idleDueAt fires once the threshold elapses, at the deterministic instant", () => {
  const r = routine(IDLE);
  const lastActivity = Date.parse("2026-06-12T12:00:00.000Z");
  const before = new Date("2026-06-12T12:29:00.000Z");
  const after = new Date("2026-06-12T12:31:00.000Z");
  expect(idleDueAt(r, lastActivity, [], before)).toBeNull();
  expect(idleDueAt(r, lastActivity, [], after)?.toISOString()).toBe(
    "2026-06-12T12:30:00.000Z",
  );
});

test("idleDueAt fires at most once per idle period (a recorded run suppresses it)", () => {
  const r = routine(IDLE);
  const lastActivity = Date.parse("2026-06-12T12:00:00.000Z");
  const now = new Date("2026-06-12T14:00:00.000Z");
  // A run started after activity ceased = this idle period already dreamed.
  const dreamed = [run("r1", "2026-06-12T12:30:00.000Z")];
  expect(idleDueAt(r, lastActivity, dreamed, now)).toBeNull();
  // A run from BEFORE the idle period does not suppress.
  const stale = [run("r1", "2026-06-12T11:00:00.000Z")];
  expect(idleDueAt(r, lastActivity, stale, now)).not.toBeNull();
  // Another routine's run does not suppress either.
  const other = [run("r2", "2026-06-12T12:30:00.000Z")];
  expect(idleDueAt(r, lastActivity, other, now)).not.toBeNull();
});

test("idleDueAt guards: disabled, cron routines, missing threshold, never-active agents", () => {
  const now = new Date("2026-06-12T14:00:00.000Z");
  const lastActivity = Date.parse("2026-06-12T12:00:00.000Z");
  expect(
    idleDueAt(routine({ ...IDLE, enabled: false }), lastActivity, [], now),
  ).toBeNull();
  expect(idleDueAt(routine(), lastActivity, [], now)).toBeNull(); // cron routine
  expect(
    idleDueAt(
      routine({ trigger: "idle", schedule: "" }),
      lastActivity,
      [],
      now,
    ),
  ).toBeNull(); // no idle_minutes
  expect(idleDueAt(routine(IDLE), null, [], now)).toBeNull(); // never active
});

test("dreamRoutineTemplate is a valid idle routine that survives createRoutine", () => {
  const created = createRoutine(dreamRoutineTemplate(45), "d1", NOW);
  expect(created.trigger).toBe("idle");
  expect(created.idle_minutes).toBe(45);
  expect(created.schedule).toBe("");
  expect(created.suppress_when_silent).toBe(true);
  expect(created.prompt).toContain(".houston/memory/memory.json");
});
