/**
 * `.houston/soul/soul.json` — the agent's permanent identity (Axie SOUL
 * Core). READ-ONLY by design: souls are forged once by the engine and never
 * mutated (the v3 host answers 405 on writes), so this module deliberately
 * exports no writer. The file read works on BOTH engines (missing file reads
 * as empty → null); the legacy Rust engine never forges souls, so null there
 * is the expected "unforged" state, not an error.
 */

import schema from "@houston-ai/agent-schemas/soul.schema.json";
import { readAgentJson } from "./agent-file";

export type SoulElement = "fire" | "water" | "earth" | "air";

export interface AgentSoul {
  id: string;
  born: string;
  element: SoulElement;
  originSeed: string;
}

const NAME = "soul";
const s = schema as unknown as Parameters<typeof readAgentJson>[2];

export async function read(agentPath: string): Promise<AgentSoul | null> {
  return readAgentJson<AgentSoul | null>(agentPath, NAME, s, null);
}
