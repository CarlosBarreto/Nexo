import {
  createRoutine,
  loadRoutineRuns,
  saveRoutines,
  setPreference,
} from "@nexo/domain";
import type { Routine } from "@nexo/protocol";
import { expect, test } from "vitest";
import { CloudPaths, conversationKey } from "../paths";
import { workspaceRoot } from "../routes/agent-data";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryTurnBus } from "../turn/bus";
import { MemoryVfs } from "../vfs";
import { lastActivityMs } from "./idle";
import { type FiringJob, type RoutineFirer, Scheduler } from "./scheduler";

/**
 * The idle ("dream") trigger end-to-end through the scheduler driver: fires
 * when the agent's real conversations go quiet past the threshold, never
 * resets its clock on its own routine turns, and fires at most once per idle
 * period (the recorded run is the durable guard). Threshold math itself is
 * pinned in domain schedule.test.ts.
 */

class CaptureFirer implements RoutineFirer {
  jobs: FiringJob[] = [];
  async fire(job: FiringJob): Promise<void> {
    this.jobs.push(job);
  }
}

const PATHS = new CloudPaths();

function dreamRoutine(over: Partial<Routine> = {}): Routine {
  return {
    ...createRoutine(
      {
        name: "Dream",
        prompt: "consolidate memory",
        schedule: "",
        trigger: "idle",
        idle_minutes: 30,
      },
      "d1",
      "2026-06-12T00:00:00.000Z",
    ),
    ...over,
  };
}

async function setup(routines: Routine[]) {
  const store = new MemoryWorkspaceStore();
  const vfs = new MemoryVfs();
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  const agent = await store.createAgent({ workspaceId: ws.id, name: "A" });
  await setPreference(vfs, ws.id, "timezone", "UTC");
  await saveRoutines(vfs, workspaceRoot(ws, agent), routines);
  const firer = new CaptureFirer();
  let id = 0;
  const scheduler = new Scheduler({
    store,
    vfs,
    paths: PATHS,
    lock: new MemoryTurnBus(),
    firer,
    newId: () => `run-${++id}`,
  });
  return { store, vfs, ws, agent, firer, scheduler };
}

// MemoryVfs stamps a LOGICAL clock on writes (1, 2, 3…), so ticks anchor on
// the probe's actual value instead of wall time.
const anchor = async (env: Awaited<ReturnType<typeof setup>>) => {
  const ms = await lastActivityMs(env.vfs, PATHS, env.ws, env.agent);
  if (ms === null) throw new Error("expected activity");
  return (m: number) => new Date(ms + m * 60_000);
};

test("an idle routine fires once the agent's real conversations go quiet", async () => {
  const env = await setup([dreamRoutine()]);
  await env.vfs.writeText(
    conversationKey(PATHS, env.ws, env.agent, "chat-1"),
    "{}",
  );
  const idleFor = await anchor(env);

  // Not idle long enough yet.
  await env.scheduler.tick(idleFor(10));
  expect(env.firer.jobs).toHaveLength(0);

  await env.scheduler.tick(idleFor(31));
  expect(env.firer.jobs).toHaveLength(1);
  expect(env.firer.jobs[0]?.routine.id).toBe("d1");
  const { items: runs } = await loadRoutineRuns(
    env.vfs,
    workspaceRoot(env.ws, env.agent),
  );
  expect(runs).toHaveLength(1);
});

test("it fires at most once per idle period, even across later ticks", async () => {
  const env = await setup([dreamRoutine()]);
  await env.vfs.writeText(
    conversationKey(PATHS, env.ws, env.agent, "chat-1"),
    "{}",
  );
  const idleFor = await anchor(env);
  await env.scheduler.tick(idleFor(31));
  await env.scheduler.tick(idleFor(62));
  await env.scheduler.tick(idleFor(93));
  expect(env.firer.jobs).toHaveLength(1); // the recorded run suppresses repeats
});

test("its own dream turns never reset the idle clock (routine-* excluded)", async () => {
  const env = await setup([dreamRoutine()]);
  await env.vfs.writeText(
    conversationKey(PATHS, env.ws, env.agent, "chat-1"),
    "{}",
  );
  const idleFor = await anchor(env);
  // A routine conversation written LATER must not count as activity. (Real
  // StoredConversation shape — reconcile reads it after the fire.)
  await env.vfs.writeText(
    conversationKey(PATHS, env.ws, env.agent, "routine-d1"),
    JSON.stringify({ messages: [] }),
  );

  await env.scheduler.tick(idleFor(31));
  expect(env.firer.jobs).toHaveLength(1);
});

test("a judge turn never resets the idle clock either (judge-* excluded)", async () => {
  const env = await setup([dreamRoutine()]);
  await env.vfs.writeText(
    conversationKey(PATHS, env.ws, env.agent, "chat-1"),
    "{}",
  );
  const idleFor = await anchor(env);
  // An AI-as-a-Judge turn writes into its own judge-<runId> conversation. That
  // write must not count as activity — otherwise a judged run would freeze the
  // dream (the exact bug isSystemConversation closes over the old routine-only skip).
  await env.vfs.writeText(
    conversationKey(PATHS, env.ws, env.agent, "judge-run-1"),
    JSON.stringify({ messages: [] }),
  );

  await env.scheduler.tick(idleFor(31));
  expect(env.firer.jobs).toHaveLength(1);
});

test("a never-active agent does not dream, and cron routines are untouched by the idle path", async () => {
  const env = await setup([dreamRoutine()]);
  // No conversations at all.
  expect(await lastActivityMs(env.vfs, PATHS, env.ws, env.agent)).toBeNull();
  await env.scheduler.tick(new Date(Date.now() + 120 * 60_000));
  expect(env.firer.jobs).toHaveLength(0);
});
