import type { NewRoutine, Routine, RoutineRun } from "@houston/protocol";

/**
 * The instant an idle ("dream") routine becomes due: lastActivity +
 * idle_minutes. Fires at most ONCE per idle period — any run started at or
 * after the moment activity ceased means this period already fired, a check
 * durable across host restarts and dedup-lock TTL expiry (an errored fire
 * still recorded a run, so there is no retry storm either). The instant is
 * deterministic across replicas (same lastActivity), so the driver keys its
 * setNx dedup on it exactly like a cron instant. Threshold-based, not
 * window-based: the scheduler's lastTick reset on start is irrelevant here.
 */
export function idleDueAt(
  routine: Routine,
  lastActivityMs: number | null,
  runs: RoutineRun[],
  now: Date,
): Date | null {
  if (!routine.enabled || routine.trigger !== "idle" || !routine.idle_minutes)
    return null;
  // A never-active agent has nothing to dream about.
  if (lastActivityMs === null) return null;
  const at = lastActivityMs + routine.idle_minutes * 60_000;
  if (at > now.getTime()) return null;
  const fired = runs.some(
    (r) =>
      r.routine_id === routine.id && Date.parse(r.started_at) >= lastActivityMs,
  );
  return fired ? null : new Date(at);
}

/**
 * The canonical dream prompt (Axie dream skill): while the agent is idle,
 * consolidate memory instead of sitting dark. Works on the Tier 2 memory
 * stack; ROUTINE_OK-suppressed so uneventful dreams never spam the board.
 */
export const DREAM_PROMPT = `You are dreaming: the user has been away for a while, so tidy your memory.
1. Review your recent conversations for durable facts, preferences, and decisions.
2. Update .houston/memory/memory.json: add new profile facts; mark finished operational goals as done.
3. If something notable happened since the last dream, write one short episode file under .houston/memory/episodes/ (markdown, frontmatter with title and created).
Keep it small: consolidate, do not invent. If there is nothing new to consolidate, do nothing.`;

/** A ready-to-create dream routine (idle-triggered memory consolidation). */
export function dreamRoutineTemplate(idleMinutes = 60): NewRoutine {
  return {
    name: "Dream",
    description: "Consolidates memory while the agent is idle.",
    prompt: DREAM_PROMPT,
    schedule: "",
    trigger: "idle",
    idle_minutes: idleMinutes,
    suppress_when_silent: true,
    chat_mode: "shared",
  };
}
