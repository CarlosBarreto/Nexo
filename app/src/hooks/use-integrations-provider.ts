/**
 * Provider-agnostic integrations hooks.
 *
 * Houston supports multiple integrations providers behind one trait
 * (`IntegrationsProvider` in the engine). This hook surfaces the currently
 * active one and offers a typed setter. The rest of the UI keeps using the
 * existing `tauriConnections.*` shims for Composio-specific flows; the
 * picker reads from here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActiveIntegrationsProvider,
  IntegrationsProviderId,
} from "@houston-ai/engine-client";
import { getEngine } from "../lib/engine";
import { queryKeys } from "../lib/query-keys";

/** Read the active integrations provider. Falls back to Composio engine-side. */
export function useActiveIntegrationsProvider() {
  return useQuery({
    queryKey: queryKeys.integrationsActive(),
    queryFn: () => getEngine().integrationsGetActive(),
    // The active provider rarely changes mid-session; cache aggressively
    // but invalidate immediately on the setter mutation below.
    staleTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
  });
}

/**
 * Persist the active provider. On success the setter invalidates the active-
 * provider query AND the Composio queries that the rest of the UI reads, so
 * the integrations panel immediately re-renders against the new provider's
 * status without a manual refresh.
 */
export function useSetIntegrationsProvider() {
  const qc = useQueryClient();
  return useMutation<ActiveIntegrationsProvider, Error, IntegrationsProviderId>({
    mutationFn: (id) => getEngine().integrationsSetActive(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.integrationsActive() }),
        // The Composio status / apps / connections caches are now stale —
        // the active provider may have changed underneath them.
        qc.invalidateQueries({ queryKey: queryKeys.connections() }),
        qc.invalidateQueries({ queryKey: queryKeys.composioApps() }),
        qc.invalidateQueries({ queryKey: queryKeys.connectedToolkits() }),
      ]);
    },
  });
}
