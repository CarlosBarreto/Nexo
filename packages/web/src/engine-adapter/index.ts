/**
 * Drop-in replacement for `@nexo-ai/engine-client`, backed by the Nexo
 * host (packages/host). Aliased in vite.config.ts when host/new-engine mode is
 * active, so the entire desktop UI (app/src) runs on the new engine unchanged.
 *
 * Types are reused verbatim from the original package; only the NexoClient
 * and EngineWebSocket implementations change.
 */
export * from "../../../../ui/engine-client/src/types";
export type { NexoClientOptions } from "./client";
export {
  isNexoEngineError,
  NexoClient,
  NexoEngineError,
} from "./client";
export { EngineWebSocket, topics } from "./ws";
