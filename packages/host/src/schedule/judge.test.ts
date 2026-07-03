import {
  createRoutine,
  createRoutineRun,
  judgeConversationId,
  loadRoutineRuns,
  saveRoutineRuns,
  saveRoutines,
} from "@houston/domain";
import type { Routine, RoutineRun } from "@houston/protocol";
import { expect, test } from "vitest";
import { CloudPaths } from "../paths";
import { workspaceRoot } from "../routes/agent-data";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryTurnBus } from "../turn/bus";
import { conversationKey, prefixFor } from "../turn/deps";
import { MemoryVfs } from "../vfs";
import { reconcileAgentRuns } from "./reconcile";
import type { FiringJob, RoutineFirer } from "./scheduler";

/**
 * AI-as-a-Judge through reconcile: a judge_enabled routine's completed run
 * fires ONE judge turn into its own judge-<runId> conversation (never the
 * run's chat), the verdict settles on a later sweep, a sentinel-less or
 * silent judge is an error (never a default pass), and nothing fires without
 * opt-in or without a firer.
 */

const STARTED = new Date("2026-06-12T12:00:00.000Z");
const NOW = new Date("2026-06-12T12:02:00.000Z");
const MUCH_LATER = new Date("2026-06-12T13:00:00.000Z");

class CaptureFirer implements RoutineFirer {
  jobs: FiringJob[] = [];
  throwMessage: string | null = null;
  async fire(job: FiringJob): Promise<void> {
    this.jobs.push(job);
    if (this.throwMessage) throw new Error(this.throwMessage);
  }
}

const routine = (over: Partial<Routine> = {}): Routine => ({
  ...createRoutine(
    {
      name: "Daily",
      prompt: "check the inbox",
      schedule: "0 9 * * *",
      judge_enabled: true,
    },
    "r1",
    STARTED.toISOString(),
  ),
  ...over,
});

async function setup(r: Routine) {
  const store = new MemoryWorkspaceStore();
  const vfs = new MemoryVfs();
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  const agent = await store.createAgent({ workspaceId: ws.id, name: "A" });
  await saveRoutines(vfs, workspaceRoot(ws, agent), [r]);
  const run = createRoutineRun(r, "run-1", STARTED.toISOString());
  await saveRoutineRuns(vfs, workspaceRoot(ws, agent), [run]);
  const firer = new CaptureFirer();
  return { vfs, ws, agent, run, firer };
}

async function seedReply(
  env: Awaited<ReturnType<typeof setup>>,
  cid: string,
  content: string,
  ts: number,
) {
  await env.vfs.writeText(
    conversationKey(prefixFor(env.ws as never, env.agent as never), cid),
    JSON.stringify({
      messages: [{ role: "assistant", content, ts }],
    }),
  );
}

const deps = (
  env: Awaited<ReturnType<typeof setup>>,
  now: Date,
  lock = new MemoryTurnBus(),
) => ({
  vfs: env.vfs,
  paths: new CloudPaths(),
  lock,
  now: () => now,
  newId: () => "act-1",
  firer: env.firer,
});

async function runsOf(env: Awaited<ReturnType<typeof setup>>) {
  return (await loadRoutineRuns(env.vfs, workspaceRoot(env.ws, env.agent)))
    .items;
}

test("a judged run fires ONE judge turn into judge-<runId> and goes pending", async () => {
  const env = await setup(routine());
  await seedReply(env, env.run.session_key, "inbox is clean", NOW.getTime());

  await reconcileAgentRuns(deps(env, NOW), env.ws, env.agent);

  expect(env.firer.jobs).toHaveLength(1);
  const job = env.firer.jobs[0];
  expect(job?.conversationId).toBe(judgeConversationId("run-1"));
  expect(job?.routine.prompt).toContain("inbox is clean");
  expect(job?.routine.prompt).toContain("check the inbox");
  expect(job?.routine.suppress_when_silent).toBe(false);

  const [run] = await runsOf(env);
  expect(run?.status).toBe("surfaced");
  expect(run?.judge_status).toBe("pending");
  expect(run?.judge_session_key).toBe("judge-run-1");

  // A later sweep with no judge reply yet changes nothing and re-fires nothing.
  await reconcileAgentRuns(deps(env, NOW), env.ws, env.agent);
  expect(env.firer.jobs).toHaveLength(1);
});

test("the verdict settles on a later sweep: pass, fail, and sentinel-less error", async () => {
  for (const [reply, status, verdict] of [
    ["Solid work.\nJUDGE_PASS", "pass", "Solid work."],
    ["JUDGE_FAIL\nMissed the attachments.", "fail", "Missed the attachments."],
    ["Looks fine I guess.", "error", "without a verdict sentinel"],
  ] as const) {
    const env = await setup(routine());
    await seedReply(env, env.run.session_key, "did it", NOW.getTime());
    await reconcileAgentRuns(deps(env, NOW), env.ws, env.agent);

    await seedReply(
      env,
      judgeConversationId("run-1"),
      reply,
      NOW.getTime() + 1000,
    );
    await reconcileAgentRuns(deps(env, MUCH_LATER), env.ws, env.agent);

    const [run] = await runsOf(env);
    expect(run?.judge_status).toBe(status);
    expect(run?.judge_verdict).toContain(verdict);
    expect(run?.judge_completed_at).toBeTruthy();
  }
});

test("a judge that never answers times out as error, anchored at run completion", async () => {
  const env = await setup(routine());
  await seedReply(env, env.run.session_key, "did it", NOW.getTime());
  await reconcileAgentRuns(deps(env, NOW), env.ws, env.agent);

  // 16 minutes after completion, still no judge reply.
  const past = new Date(NOW.getTime() + 16 * 60 * 1000);
  await reconcileAgentRuns(deps(env, past), env.ws, env.agent);

  const [run] = await runsOf(env);
  expect(run?.judge_status).toBe("error");
  expect(run?.judge_verdict).toContain("timed out");
});

test("no judge without opt-in, and no judge without a firer", async () => {
  const unjudged = await setup(routine({ judge_enabled: false }));
  await seedReply(unjudged, unjudged.run.session_key, "did it", NOW.getTime());
  await reconcileAgentRuns(deps(unjudged, NOW), unjudged.ws, unjudged.agent);
  expect(unjudged.firer.jobs).toHaveLength(0);
  expect((await runsOf(unjudged))[0]?.judge_status).toBeUndefined();

  const firerless = await setup(routine());
  await seedReply(
    firerless,
    firerless.run.session_key,
    "did it",
    NOW.getTime(),
  );
  // Deps without a firer at all — reconcile degrades to unjudged completion.
  await reconcileAgentRuns(
    {
      vfs: firerless.vfs,
      paths: new CloudPaths(),
      lock: new MemoryTurnBus(),
      now: () => NOW,
      newId: () => "act-1",
    },
    firerless.ws,
    firerless.agent,
  );
  expect((await runsOf(firerless))[0]?.status).toBe("surfaced");
  expect((await runsOf(firerless))[0]?.judge_status).toBeUndefined();
});

test("a judge fire failure marks judge_status error but never blocks the run's completion", async () => {
  const env = await setup(routine());
  env.firer.throwMessage = "runtime unreachable";
  await seedReply(env, env.run.session_key, "did it", NOW.getTime());
  await reconcileAgentRuns(deps(env, NOW), env.ws, env.agent);

  const [run] = (await runsOf(env)) as [RoutineRun];
  expect(run.status).toBe("surfaced");
  expect(run.judge_status).toBe("error");
  expect(run.judge_verdict).toContain("runtime unreachable");
});
