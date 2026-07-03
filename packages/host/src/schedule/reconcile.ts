import {
  buildJudgePrompt,
  completeRoutineRun,
  judgeConversationId,
  loadActivities,
  loadRoutineRuns,
  loadRoutines,
  parseJudgeVerdict,
  routineActivity,
  saveActivities,
  saveRoutineRuns,
  upsertById,
} from "@houston/domain";
import type { ChatMessage, RoutineRun } from "@houston/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { EventHub } from "../events/hub";
import { conversationKey, type WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";
import type { RoutineFirer } from "./scheduler";

/** A run still 'running' after this long with no agent reply is declared timed-out. */
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

interface StoredConversation {
  messages: ChatMessage[];
}

/** The agent's reply for this run: the last assistant message after the run started. */
function replyAfter(
  conversation: StoredConversation | null,
  startedAtMs: number,
): string | null {
  if (!conversation) return null;
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const m = conversation.messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.ts >= startedAtMs) return m.content;
  }
  return null;
}

export interface ReconcileDeps {
  vfs: Vfs;
  paths: WorkspacePaths;
  /** Atomic guard so two replicas don't double-surface the same run. */
  lock: { setNx(key: string, value: string, ttlSec: number): Promise<boolean> };
  events?: EventHub;
  now: () => Date;
  newId: () => string;
  /** Fires judge turns for judge_enabled routines; absent → runs complete unjudged. */
  firer?: RoutineFirer;
}

/**
 * Complete an agent's 'running' routine runs by reading each run's conversation:
 * the agent's reply classifies the run silent vs surfaced (per runner.rs), a
 * surfaced run gets a board Activity, and a run with no reply past the timeout
 * is marked errored (never stuck 'running'). Idempotent + multi-replica safe:
 * a per-run setNx lock arbitrates, and a terminal run is never revisited.
 */
export async function reconcileAgentRuns(
  deps: ReconcileDeps,
  ws: Workspace,
  agent: Agent,
): Promise<void> {
  const root = deps.paths.agentRoot(ws, agent);
  const { items: runs } = await loadRoutineRuns(deps.vfs, root);
  const running = runs.filter((r) => r.status === "running");
  const judging = runs.filter((r) => r.judge_status === "pending");
  if (running.length === 0 && judging.length === 0) return;

  const { items: routines } = await loadRoutines(deps.vfs, root);
  const nowMs = deps.now().getTime();
  let changed = false;
  let activitiesTouched = false;
  let nextRuns = runs;

  for (const run of running) {
    const routine = routines.find((r) => r.id === run.routine_id);
    if (!routine) continue; // routine deleted; leave the run to the next sweep

    const raw = await deps.vfs.readText(
      conversationKey(deps.paths, ws, agent, run.session_key),
    );
    const conversation = raw ? (JSON.parse(raw) as StoredConversation) : null;
    const reply = replyAfter(conversation, Date.parse(run.started_at));

    const timedOut =
      !reply && nowMs - Date.parse(run.started_at) > RUN_TIMEOUT_MS;
    if (!reply && !timedOut) continue; // turn still in flight

    // One replica owns this run's completion.
    if (!(await deps.lock.setNx(`routine:reconcile:${run.id}`, "1", 120)))
      continue;

    if (timedOut) {
      nextRuns = upsertById(nextRuns, {
        ...run,
        status: "error",
        summary: "The routine timed out without a response.",
        completed_at: deps.now().toISOString(),
      });
      changed = true;
      continue;
    }

    if (!reply) continue; // narrowing: timedOut is false here, so reply must be set
    const done = completeRoutineRun(
      run,
      routine,
      reply,
      deps.now().toISOString(),
    );
    if (done.status === "surfaced") {
      const { items: activities } = await loadActivities(deps.vfs, root);
      const existing = activities.find(
        (a) => a.session_key === run.session_key,
      );
      const activity = routineActivity(
        routine,
        done,
        existing,
        deps.newId(),
        deps.now().toISOString(),
      );
      await saveActivities(deps.vfs, root, upsertById(activities, activity));
      done.activity_id = activity.id;
      activitiesTouched = true;
    }
    // Opt-in judge: fire a SECOND turn into its own conversation (never the
    // run's chat — shared-mode chats would cross-contaminate later runs).
    // Fired BARE via the firer, never through fireRoutineRun: with no run
    // record of its own, reconcile can never see the judge as a running run,
    // so there is structurally no judge-of-judge.
    if (
      routine.judge_enabled &&
      deps.firer &&
      (await deps.lock.setNx(`routine:judge-fire:${run.id}`, "1", 3600))
    ) {
      try {
        await deps.firer.fire({
          workspace: ws,
          agent,
          routine: {
            ...routine,
            prompt: buildJudgePrompt(routine, reply),
            suppress_when_silent: false,
          },
          conversationId: judgeConversationId(run.id),
          runId: run.id,
        });
        done.judge_status = "pending";
        done.judge_session_key = judgeConversationId(run.id);
      } catch (err) {
        // The run's own completion is never blocked by a judge failure.
        done.judge_status = "error";
        done.judge_verdict = `The judge turn failed to fire: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    nextRuns = upsertById(nextRuns, done);
    changed = true;
  }

  // Second sweep: verdicts for runs whose judge turn is in flight.
  for (const run of judging) {
    const settled = await settleJudge(deps, ws, agent, run, nowMs);
    if (settled) {
      nextRuns = upsertById(nextRuns, settled);
      changed = true;
    }
  }

  if (changed) {
    await saveRoutineRuns(deps.vfs, root, nextRuns);
    deps.events?.emit(ws.ownerUserId, {
      type: "RoutineRunsChanged",
      agentPath: agent.id,
    });
  }
  if (activitiesTouched) {
    deps.events?.emit(ws.ownerUserId, {
      type: "ActivityChanged",
      agentPath: agent.id,
    });
  }
}

/**
 * The judge's own completion: read the judge conversation, parse the sentinel
 * verdict, or time out (anchored at the run's completed_at — a judge that
 * never answers must not be polled forever). Null when still in flight or
 * another replica owns it. A sentinel-less reply is an "error" verdict, never
 * a default pass. Errors are terminal: one extra LLM turn per run is the cost
 * ceiling, so a failed judge is never retried.
 */
async function settleJudge(
  deps: ReconcileDeps,
  ws: Workspace,
  agent: Agent,
  run: RoutineRun,
  nowMs: number,
): Promise<RoutineRun | null> {
  const sessionKey = run.judge_session_key ?? judgeConversationId(run.id);
  const anchorMs = Date.parse(run.completed_at ?? run.started_at);
  const raw = await deps.vfs.readText(
    conversationKey(deps.paths, ws, agent, sessionKey),
  );
  const conversation = raw ? (JSON.parse(raw) as StoredConversation) : null;
  const reply = replyAfter(conversation, anchorMs);

  const timedOut = !reply && nowMs - anchorMs > RUN_TIMEOUT_MS;
  if (!reply && !timedOut) return null; // judge turn still in flight

  if (!(await deps.lock.setNx(`routine:judge:${run.id}`, "1", 120)))
    return null;

  if (timedOut) {
    return {
      ...run,
      judge_status: "error",
      judge_verdict: "The judge timed out without a verdict.",
      judge_completed_at: deps.now().toISOString(),
    };
  }
  if (!reply) return null; // narrowing: timedOut false here, reply must be set
  const { verdict, rationale } = parseJudgeVerdict(reply);
  return {
    ...run,
    judge_status: verdict ?? "error",
    judge_verdict: verdict
      ? rationale
      : "The judge answered without a verdict sentinel.",
    judge_completed_at: deps.now().toISOString(),
  };
}
