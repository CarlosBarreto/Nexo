import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applyRoutineUpdate,
  createRoutine,
  getPreference,
  loadConfig,
  loadLearnings,
  loadRoutineRuns,
  loadRoutines,
  removeById,
  saveConfig,
  saveLearnings,
  saveRoutines,
  upsertById,
  validateSchedule,
} from "@nexo/domain";
import type { NewRoutine, NexoEvent } from "@nexo/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";
import { handleActivitiesData } from "./agent-data-activities";
import { json, readJson } from "./http";

// The cloud-layout root, kept as a convenience for cloud tests + callers that
// don't carry a WorkspacePaths instance. Production handlers use the injected
// `paths` so the local profile gets its own layout. See paths.ts.
export { workspaceRoot } from "../paths";

/** Each typed family's reactivity event — emitted after a successful mutation. */
const FAMILY_EVENT: Record<string, (agentPath: string) => NexoEvent> = {
  activities: (agentPath) => ({ type: "ActivityChanged", agentPath }),
  routines: (agentPath) => ({ type: "RoutinesChanged", agentPath }),
  routine_runs: (agentPath) => ({ type: "RoutineRunsChanged", agentPath }),
  config: (agentPath) => ({ type: "ConfigChanged", agentPath }),
  learnings: (agentPath) => ({ type: "LearningsChanged", agentPath }),
};

/**
 * The typed `.houston` families (activities, routines + runs, config,
 * learnings) served straight off the workspace Vfs — the SAME domain code
 * over GCS in cloud and the real agent directory locally. Intercepted before
 * channel dispatch; the runtime never sees these. Returns true when handled.
 *
 * List GETs return `{ items, diagnostics }`: agents write these files with
 * file tools, so malformed entries are dropped AND reported (beta policy —
 * the UI can surface the noise instead of silently losing it).
 */
export async function handleAgentData(
  vfs: Vfs | undefined,
  paths: WorkspacePaths,
  ctx: { workspace: Workspace; agent: Agent },
  method: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  emit?: (event: NexoEvent) => void,
  // The authenticated caller's id — recorded as a new routine's `created_by`
  // so a fired routine turn can act as its creator (C2). Absent in callers that
  // don't carry identity (local single-user); the field then stays absent.
  createdBy?: string,
): Promise<boolean> {
  const m = rest.match(
    /^(activities|routines|routine_runs|config|learnings)(?:\/([^/]+))?$/,
  );
  if (!m) return false;
  const family = m[1];
  if (!family) return false;
  const itemId = m[2] ? decodeURIComponent(m[2]) : null;

  if (!vfs) {
    json(res, 503, { error: "agent data not configured" });
    return true;
  }
  const root = paths.agentRoot(ctx.workspace, ctx.agent);
  const nowIso = new Date().toISOString();
  // Fire this family's reactivity event AFTER a successful write. agentPath is
  // the agent's opaque id (the UI scopes query invalidation by it).
  const fireChange = () => {
    const event = FAMILY_EVENT[family]?.(ctx.agent.id);
    if (event) emit?.(event);
  };

  if (family === "activities") {
    await handleActivitiesData(
      vfs,
      root,
      ctx.agent.id,
      method,
      itemId,
      req,
      res,
      emit,
    );
    return true;
  }

  if (family === "routines") {
    if (method === "GET" && !itemId) {
      json(res, 200, await loadRoutines(vfs, root));
      return true;
    }
    if (method === "POST" && !itemId) {
      const body = await readJson(req);
      // Idle ("dream") routines have no cron schedule — they fire on agent
      // inactivity. Their schedule is stored as "" (the legacy Rust engine
      // fails to parse it and skips the routine non-fatally).
      const isIdle = body.trigger === "idle";
      const required = isIdle
        ? ["name", "prompt"]
        : ["name", "prompt", "schedule"];
      for (const field of required) {
        if (!body[field] || typeof body[field] !== "string") {
          json(res, 400, { error: `missing '${field}'` });
          return true;
        }
      }
      if (isIdle && !isValidIdleMinutes(body.idle_minutes)) {
        json(res, 400, {
          error: "'idle_minutes' must be an integer between 1 and 10080",
        });
        return true;
      }
      // The loop above proved the required fields are non-empty strings.
      const input = (isIdle
        ? { ...body, schedule: "" }
        : body) as unknown as NewRoutine;
      if (!isIdle) {
        // Reject a bad cron NOW — otherwise the routine saves and silently never
        // fires (the scheduler would skip it forever, with no signal to the user).
        // Validate against the single account-wide zone (HOU-470): there is no
        // per-routine timezone, so a stray body.timezone is not honored.
        const accountTz = await getPreference(
          vfs,
          ctx.workspace.id,
          "timezone",
        );
        const scheduleErr = validateSchedule(input.schedule, accountTz);
        if (scheduleErr) {
          json(res, 400, { error: `invalid schedule: ${scheduleErr}` });
          return true;
        }
      }
      const { items } = await loadRoutines(vfs, root);
      const routine = createRoutine(
        input,
        crypto.randomUUID(),
        nowIso,
        createdBy,
      );
      await saveRoutines(vfs, root, upsertById(items, routine));
      fireChange();
      json(res, 201, routine);
      return true;
    }
    if ((method === "PATCH" || method === "DELETE") && itemId) {
      const { items } = await loadRoutines(vfs, root);
      const current = items.find((r) => r.id === itemId);
      if (!current) {
        json(res, 404, { error: "routine not found" });
        return true;
      }
      if (method === "PATCH") {
        const update = await readJson(req);
        const next = applyRoutineUpdate(current, update, nowIso);
        // Validate the MERGED result: an idle routine needs a sane threshold
        // (and no cron); a cron routine needs a valid schedule, against the
        // account-wide zone (HOU-470: no per-routine timezone).
        if (next.trigger === "idle") {
          if (!isValidIdleMinutes(next.idle_minutes)) {
            json(res, 400, {
              error: "'idle_minutes' must be an integer between 1 and 10080",
            });
            return true;
          }
        } else {
          const accountTz = await getPreference(
            vfs,
            ctx.workspace.id,
            "timezone",
          );
          const scheduleErr = validateSchedule(next.schedule, accountTz);
          if (scheduleErr) {
            json(res, 400, { error: `invalid schedule: ${scheduleErr}` });
            return true;
          }
        }
        await saveRoutines(vfs, root, upsertById(items, next));
        fireChange();
        json(res, 200, next);
      } else {
        await saveRoutines(vfs, root, removeById(items, itemId).items);
        fireChange();
        json(res, 200, { ok: true });
      }
      return true;
    }
  }

  if (family === "routine_runs" && method === "GET" && !itemId) {
    json(res, 200, await loadRoutineRuns(vfs, root));
    return true;
  }

  if (family === "config" && !itemId) {
    if (method === "GET") {
      json(res, 200, await loadConfig(vfs, root));
      return true;
    }
    if (method === "PUT") {
      const body = await readJson(req);
      await saveConfig(vfs, root, body);
      fireChange();
      json(res, 200, body);
      return true;
    }
  }

  if (family === "learnings" && !itemId) {
    if (method === "GET") {
      json(res, 200, await loadLearnings(vfs, root));
      return true;
    }
    if (method === "PUT") {
      const body = await readJson(req);
      if (!Array.isArray(body.items)) {
        json(res, 400, { error: "missing 'items' array" });
        return true;
      }
      await saveLearnings(vfs, root, body.items);
      fireChange();
      json(res, 200, { ok: true });
      return true;
    }
  }

  json(res, 405, { error: "method not allowed" });
  return true;
}

/** Idle threshold sanity: 1 minute to 1 week (10080). */
function isValidIdleMinutes(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10080;
}
