/**
 * @nexo-ai/engine-client — TypeScript SDK for the Nexo Engine.
 *
 * Consumed by:
 * - Nexo desktop app (`app/src/`) via `window.__HOUSTON_ENGINE__`
 * - Nexo mobile app (direct connect, out of scope until Phase 5)
 * - Third-party integrators (npm package)
 *
 * Single source of truth for the wire protocol, matching
 * `engine/houston-engine-protocol`.
 */

export * from "./client.ts";
export * from "./types.ts";
export * from "./ws.ts";
