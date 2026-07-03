// Soul — the agent's permanent identity (Axie SOUL Core). Generated ONCE at
// agent creation and never mutated afterward: there is no save/update wire
// surface, only GET. The element drives archetype presets and UI theming.

export const SOUL_ELEMENTS = ["fire", "water", "earth", "air"] as const;

export type SoulElement = (typeof SOUL_ELEMENTS)[number];

export const isSoulElement = (v: unknown): v is SoulElement =>
  typeof v === "string" && (SOUL_ELEMENTS as readonly string[]).includes(v);

export interface AgentSoul {
  /** Permanent identifier — `soul_<uuid>`. Never regenerated. */
  id: string;
  /** RFC3339 timestamp of the agent's creation ("birth"). */
  born: string;
  /** Primary element — assigned at birth (explicitly or derived from the seed). */
  element: SoulElement;
  /** Deterministic fingerprint of the birth inputs (agent id + name + born). */
  originSeed: string;
}
