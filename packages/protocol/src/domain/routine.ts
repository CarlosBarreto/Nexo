// Routines + routine runs. snake_case mirrors the on-disk .houston schemas.

/** Whether a routine's runs share one chat ("shared", default) or each run gets its own ("per_run"). */
export type RoutineChatMode = "shared" | "per_run";

/** How a routine fires: on a cron schedule (default) or after the agent idles ("dream"). */
export type RoutineTrigger = "cron" | "idle";

export interface Routine {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  suppress_when_silent: boolean;
  chat_mode: RoutineChatMode;
  /** Absent on disk = "cron" (tolerant read, no migration; the normalizer fills it in). */
  trigger: RoutineTrigger;
  /** Idle threshold in minutes; present and >= 1 iff trigger === "idle". */
  idle_minutes?: number;
  /** Opt-in AI-as-a-Judge: a completed run's reply gets evaluated by a second turn. */
  judge_enabled: boolean;
  /** Extra evaluation criteria for the judge; the routine's prompt is always the base intent. */
  judge_criteria?: string;
  /** Provider id override (e.g. "anthropic", "openai"); absent means inherit the agent's provider. */
  provider?: string | null;
  /** Model override (e.g. "claude-opus-4-8", "gpt-5.5"); absent means inherit the agent's model. */
  model?: string | null;
  /** Reasoning-effort override (e.g. "high", "max"); absent means inherit the agent's effort. */
  effort?: string | null;
  /** Integration slugs this routine uses (data carried for store agents). */
  integrations: string[];
  /**
   * Multiplayer only: the org-member user id that created this routine. Absent
   * in single-player mode. Surfaced so the UI can attribute automations.
   */
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface NewRoutine {
  name: string;
  description?: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
  suppress_when_silent?: boolean;
  chat_mode?: RoutineChatMode;
  /** Omit for "cron". "idle" routines require idle_minutes >= 1; schedule is stored as "". */
  trigger?: RoutineTrigger;
  idle_minutes?: number;
  judge_enabled?: boolean;
  judge_criteria?: string;
  /** Provider id to pin (e.g. "openai"); omit to inherit the agent's provider. */
  provider?: string | null;
  /** Model to pin (e.g. "gpt-5.5"); omit to inherit the agent's model. */
  model?: string | null;
  /** Reasoning effort to pin (e.g. "high"); omit to inherit the agent's effort. */
  effort?: string | null;
  integrations?: string[];
}

export interface RoutineUpdate {
  name?: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  enabled?: boolean;
  suppress_when_silent?: boolean;
  chat_mode?: RoutineChatMode;
  trigger?: RoutineTrigger;
  idle_minutes?: number;
  judge_enabled?: boolean;
  judge_criteria?: string;
  /** Provider id to pin; `null` clears (back to inherit), omit to leave unchanged. */
  provider?: string | null;
  /** Model to pin; `null` clears (back to inherit), omit to leave unchanged. */
  model?: string | null;
  /** Reasoning effort to pin; `null` clears (back to inherit), omit to leave unchanged. */
  effort?: string | null;
  integrations?: string[];
}

export type RoutineRunStatus =
  | "running"
  | "silent"
  | "surfaced"
  | "error"
  | "cancelled";

/** The judge's lifecycle on a run: absent entirely when the routine is not opted in. */
export type JudgeStatus = "pending" | "pass" | "fail" | "error";

export interface RoutineRun {
  id: string;
  routine_id: string;
  status: RoutineRunStatus;
  session_key: string;
  activity_id?: string;
  summary?: string;
  started_at: string;
  completed_at?: string;
  /** Human-readable reset hint while a run sleeps on a usage-limit window. */
  paused_until?: string;
  judge_status?: JudgeStatus;
  /** The judge's rationale (or the failure reason when judge_status is "error"). */
  judge_verdict?: string;
  /** The judge turn's dedicated conversation (`judge-<runId>`). */
  judge_session_key?: string;
  judge_completed_at?: string;
}

export interface RoutineRunUpdate {
  status?: RoutineRunStatus;
  activity_id?: string;
  summary?: string;
  completed_at?: string;
  paused_until?: string | null;
}
