import activity from "./activity.schema.json";
import config from "./config.schema.json";
import learnings from "./learnings.schema.json";
import memory from "./memory.schema.json";
import routine_runs from "./routine_runs.schema.json";
import routines from "./routines.schema.json";
import soul from "./soul.schema.json";

export const schemas = {
  activity,
  routines,
  routine_runs,
  config,
  learnings,
  memory,
  soul,
} as const;

export { activity, config, learnings, memory, routine_runs, routines, soul };

export type SchemaName = keyof typeof schemas;
