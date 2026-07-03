import { useQueries } from "@tanstack/react-query";
import * as soul from "../../data/soul";
import { queryKeys } from "../../lib/query-keys";
import type { Agent } from "../../lib/types";

/**
 * One soul per agent, fanned out over the workspace's agent list (the
 * Bestiario reads them all at once). Souls are immutable once forged, so
 * staleTime is infinite; an unforged agent (legacy engine, or a v3 agent
 * from before the soul feature) resolves to null and renders as such.
 */
export function useSouls(
  agents: Agent[],
): Record<string, soul.AgentSoul | null> {
  const queries = useQueries({
    queries: agents.map((agent) => ({
      queryKey: queryKeys.soul(agent.folderPath),
      queryFn: () => soul.read(agent.folderPath),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const byId: Record<string, soul.AgentSoul | null> = {};
  agents.forEach((agent, i) => {
    byId[agent.id] = queries[i]?.data ?? null;
  });
  return byId;
}
