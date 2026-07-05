import {
  type AgentSoul,
  isSoulElement,
  SOUL_ELEMENTS,
  type SoulElement,
} from "@nexo/protocol";
import { docKey } from "./layout";
import {
  type DocDiagnostic,
  loadJson,
  saveJson,
  type TextStore,
} from "./store";

/**
 * Soul — the agent's permanent identity (Axie SOUL Core), at
 * `.houston/soul/soul.json`. Written ONCE (ensureSoul) and never mutated:
 * there is no save/update path besides first creation, and an existing soul
 * always wins over a regeneration attempt. Souls are per-instance identity,
 * so they deliberately do NOT ride along in portable exports.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isSoul = (v: unknown): v is AgentSoul =>
  isRecord(v) &&
  typeof v.id === "string" &&
  typeof v.born === "string" &&
  isSoulElement(v.element) &&
  typeof v.originSeed === "string";

/**
 * FNV-1a 64-bit over the birth inputs. Deterministic and dependency-free —
 * this package also runs in the browser (packages/web), so node:crypto is
 * out. The seed is a fingerprint, not a security boundary.
 */
export function soulSeed(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Stable element from a seed — the default when no ritual/archetype chose one. */
export function deriveElement(seed: string): SoulElement {
  const bucket = Number(BigInt(`0x${seed}`) % BigInt(SOUL_ELEMENTS.length));
  return SOUL_ELEMENTS[bucket] ?? "air";
}

/** Forge a soul. Caller supplies time + id (domain stays pure, matching the repo idiom). */
export function generateSoul(input: {
  agentId: string;
  agentName: string;
  bornIso: string;
  newId: () => string;
  element?: SoulElement;
}): AgentSoul {
  const originSeed = soulSeed(
    `${input.agentId}:${input.agentName}:${input.bornIso}`,
  );
  return {
    id: `soul_${input.newId()}`,
    born: input.bornIso,
    element: input.element ?? deriveElement(originSeed),
    originSeed,
  };
}

/** The stored soul, or null when absent/malformed (malformed surfaces as a diagnostic). */
export async function loadSoul(
  store: TextStore,
  root: string,
): Promise<{ soul: AgentSoul | null; diagnostics: DocDiagnostic[] }> {
  const key = docKey(root, "soul");
  const raw = await loadJson<unknown>(store, key, null);
  if (raw === null) return { soul: null, diagnostics: [] };
  if (!isSoul(raw)) {
    return {
      soul: null,
      diagnostics: [{ key, message: "soul.json is not a valid soul" }],
    };
  }
  return { soul: raw, diagnostics: [] };
}

/**
 * Load-or-forge: an existing soul is returned UNCHANGED (immutability — even
 * when the inputs differ); a missing one is generated and persisted. A
 * malformed file is treated as missing and healed by the fresh write.
 */
export async function ensureSoul(
  store: TextStore,
  root: string,
  input: {
    agentId: string;
    agentName: string;
    bornIso: string;
    newId: () => string;
    element?: SoulElement;
  },
): Promise<AgentSoul> {
  const { soul } = await loadSoul(store, root);
  if (soul) return soul;
  const forged = generateSoul(input);
  await saveJson(store, docKey(root, "soul"), forged);
  return forged;
}
