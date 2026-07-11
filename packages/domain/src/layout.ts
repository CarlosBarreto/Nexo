import activitySchema from "@nexo-ai/agent-schemas/activity.schema.json";
import configSchema from "@nexo-ai/agent-schemas/config.schema.json";
import learningsSchema from "@nexo-ai/agent-schemas/learnings.schema.json";
import memorySchema from "@nexo-ai/agent-schemas/memory.schema.json";
import routineRunsSchema from "@nexo-ai/agent-schemas/routine_runs.schema.json";
import routinesSchema from "@nexo-ai/agent-schemas/routines.schema.json";
import soulSchema from "@nexo-ai/agent-schemas/soul.schema.json";
import { saveJson, type TextStore } from "./store";

/**
 * The `.houston/` layout inside an agent's workspace — ONE convention for
 * every deployment. Locally `root` is the agent's directory (via FsVfs);
 * in cloud it is the agent's object prefix + "/workspace". Each typed family
 * lives at `.houston/<family>/<family>.json` beside its seeded JSON schema.
 */
export type NexoFamily =
  | "activity"
  | "routines"
  | "routine_runs"
  | "config"
  | "learnings"
  | "memory"
  | "soul";

export const FAMILIES: NexoFamily[] = [
  "activity",
  "routines",
  "routine_runs",
  "config",
  "learnings",
  "memory",
  "soul",
];

export const docKey = (root: string, family: NexoFamily) =>
  `${root}/.houston/${family}/${family}.json`;

export const schemaKey = (root: string, family: NexoFamily) =>
  `${root}/.houston/${family}/${family}.schema.json`;

/** Skills live beside `.houston`, in the Agent Skills standard layout. */
export const skillsDirKey = (root: string) => `${root}/.agents/skills`;

const SCHEMAS: Record<NexoFamily, unknown> = {
  activity: activitySchema,
  routines: routinesSchema,
  routine_runs: routineRunsSchema,
  config: configSchema,
  learnings: learningsSchema,
  memory: memorySchema,
  soul: soulSchema,
};

/**
 * Seed every family's `.schema.json` (idempotent overwrite — the schema ships
 * with the app and is not user data). Run on agent creation so agents and
 * external tools can validate what they write.
 */
export async function seedSchemas(
  store: TextStore,
  root: string,
): Promise<void> {
  for (const family of FAMILIES) {
    await saveJson(store, schemaKey(root, family), SCHEMAS[family]);
  }
}
