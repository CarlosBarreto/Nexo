import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { config } from "../config";

export const SYSTEM_PROMPT = [
  "You are Houston, a friendly AI assistant for a non-technical user.",
  "You can read and edit files and run commands in the user's working directory to help them.",
  "Be clear and concise. Avoid jargon. Never mention file paths, JSON, or configs unless asked.",
].join("\n");

/**
 * Workspace-root context file (the agent's role/instructions). Same candidate
 * names pi itself discovers, but ONLY at the workspace root: pi's own discovery
 * walks every ancestor directory up to /, which would leak context files from
 * OUTSIDE the workspace — outside the file-tool clamp (Gate #1).
 */
const CONTEXT_CANDIDATES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

function loadWorkspaceContextFile(
  cwd: string,
): Array<{ path: string; content: string }> {
  for (const name of CONTEXT_CANDIDATES) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    return [{ path, content: readFileSync(path, "utf8") }];
  }
  return [];
}

/**
 * The agent's injected memory layers (.houston/memory/memory.json): profile
 * facts ALWAYS ride into context; operational goals ride while any is
 * active. The episodic layer deliberately does NOT — it is retrieved by
 * query (host /memory/retrieve), never injected wholesale.
 *
 * Exported for tests. A malformed file degrades to no injection with a
 * console warning — a broken memory must not kill the whole session, and the
 * host's GET /memory surfaces the same problem as a diagnostic the UI shows.
 */
export function loadMemoryContext(
  cwd: string,
): Array<{ path: string; content: string }> {
  const path = join(cwd, ".houston", "memory", "memory.json");
  if (!existsSync(path)) return [];
  let profile: string[] = [];
  let active: string[] = [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      profile?: Array<{ text?: unknown }>;
      operational?: Array<{ text?: unknown; status?: unknown }>;
    };
    profile = (Array.isArray(raw.profile) ? raw.profile : [])
      .map((f) => f?.text)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    active = (Array.isArray(raw.operational) ? raw.operational : [])
      .filter((g) => g?.status === "active")
      .map((g) => g?.text)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
  } catch (err) {
    console.warn(`[memory] skipping unreadable ${path}: ${err}`);
    return [];
  }
  if (profile.length === 0 && active.length === 0) return [];
  const sections = ["# Agent memory"];
  if (profile.length > 0)
    sections.push("## Profile", ...profile.map((t) => `- ${t}`));
  if (active.length > 0)
    sections.push("## Active goals", ...active.map((t) => `- ${t}`));
  return [{ path, content: sections.join("\n") }];
}

/**
 * Pure, parameterized loader builder: our system prompt, the workspace's own
 * context file (CLAUDE.md/AGENTS.md, root only), and SKILL.md skills from the
 * given skills dir. pi's broader on-disk discovery (extensions, prompt
 * templates, themes, the ancestor context-file walk, pi's default skill dirs)
 * stays disabled — what an agent sees is decided here, not by whatever is
 * lying around on disk. Caller must await loader.reload() before use.
 */
export function buildAgentLoader(opts: {
  cwd: string;
  skillsDir: string;
  systemPrompt: string;
}) {
  // noSkills disables pi's DEFAULT skill directories; additionalSkillPaths
  // still load (pi gates on `noSkills && skillPaths.length === 0`).
  return new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.cwd,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: existsSync(opts.skillsDir) ? [opts.skillsDir] : [],
    agentsFilesOverride: () => ({
      agentsFiles: [
        ...loadWorkspaceContextFile(opts.cwd),
        ...loadMemoryContext(opts.cwd),
      ],
    }),
    systemPrompt: opts.systemPrompt,
  });
}

/**
 * Config-bound loader for an agent session. Skills come from
 * <workspace>/.agents/skills (Agent Skills standard — Houston's existing
 * on-disk layout loads as-is) unless HOUSTON_SKILLS_DIR overrides.
 */
export function makeAgentLoader(cwd: string) {
  return buildAgentLoader({
    cwd,
    skillsDir: config.skillsDirOverride || join(cwd, ".agents", "skills"),
    systemPrompt: config.systemPrompt || SYSTEM_PROMPT,
  });
}
