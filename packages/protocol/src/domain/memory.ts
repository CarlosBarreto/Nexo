// Memory — the agent's three-layer memory (Axie memory stack) at
// .houston/memory/: memory.json holds the profile (stable facts, always
// injected into context) and operational (current goals, injected while
// active) layers; episodes/<id>.md files hold the episodic layer, retrieved
// by query instead of injected wholesale.

export interface MemoryFact {
  id: string;
  text: string;
  created_at: string;
}

export type MemoryGoalStatus = "active" | "done";

export interface MemoryGoal {
  id: string;
  text: string;
  status: MemoryGoalStatus;
  created_at: string;
}

export interface AgentMemory {
  profile: MemoryFact[];
  operational: MemoryGoal[];
}

export interface EpisodeSummary {
  id: string;
  title: string;
  created: string | null;
}

export interface EpisodeDetail {
  id: string;
  title: string;
  created: string | null;
  content: string;
}

/** One retrieval result from the episodic layer. */
export interface MemoryHit {
  id: string;
  title: string;
  score: number;
  excerpt: string;
}
