// Skills — SKILL.md folders (Agent Skills standard) under .agents/skills/.
// v3 drops v1's legacy structured-inputs + prompt-template fields: they were
// parse-for-compat only and nothing sends them anymore.

export interface SkillSummary {
  name: string;
  description: string;
  version: number;
  tags: string[];
  created: string | null;
  lastUsed: string | null;
  /** User-facing category; drives grouping in the "New mission" picker. */
  category: string | null;
  /** Surface on the Featured tab of the picker. */
  featured: boolean;
  /** Integration slugs this skill touches. */
  integrations: string[];
  /** Image URL or Microsoft Fluent 3D Emoji slug (e.g. "rocket"). */
  image: string | null;
}

export interface SkillDetail {
  name: string;
  description: string;
  version: number;
  content: string;
  /** Parsed contract.toml, when the skill declares one. */
  contract?: SkillContract;
  /** The raw contract.toml text (what the UI edits). */
  contractToml?: string;
}

export interface CreateSkill {
  name: string;
  description: string;
  content: string;
  /** Optional contract.toml text — validated before the skill is written. */
  contract?: string;
}

export interface SaveSkill {
  content: string;
  /** Optional contract.toml text — validated before it is written. */
  contract?: string;
}

// --- Skill contracts (Axie contract-first skills) ---
// An optional `contract.toml` beside SKILL.md declaring the skill's typed
// input/output fields plus security constraints. Validated at authoring time
// (host 400s an invalid contract); `validateSkillInput` enforces it against a
// structured payload at execution time.

export type SkillFieldType = "string" | "number" | "boolean" | "array";

export interface SkillFieldSpec {
  type: SkillFieldType;
  required?: boolean;
  /** Strings only — hard cap on accepted length. */
  maxLength?: number;
  /** Arrays only — the element type. */
  items?: Exclude<SkillFieldType, "array">;
}

export interface SkillSecuritySpec {
  /** Reject inputs whose string values look like prompt-injection attempts. */
  forbidPromptInjection?: boolean;
  /** Execution budget, 1-600 seconds. */
  timeoutSeconds?: number;
}

export interface SkillContract {
  skill: { name: string; description?: string; version?: string };
  input: Record<string, SkillFieldSpec>;
  output: Record<string, SkillFieldSpec>;
  security?: SkillSecuritySpec;
}
