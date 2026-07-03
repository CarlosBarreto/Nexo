import type { AgentConfig } from "../../lib/types";
import { axieArchetypeAgents } from "./axie-archetypes";
import { blankAgent } from "./default-experience";
import { personalAssistantAgent } from "./personal-assistant";

export const builtinConfigs: AgentConfig[] = [
  personalAssistantAgent,
  ...axieArchetypeAgents,
  blankAgent,
];
