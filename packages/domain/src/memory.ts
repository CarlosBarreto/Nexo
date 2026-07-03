import type {
  AgentMemory,
  EpisodeDetail,
  EpisodeSummary,
  MemoryFact,
  MemoryGoal,
} from "@houston/protocol";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { loadLearnings } from "./config";
import { docKey } from "./layout";
import {
  type DocDiagnostic,
  type FileStore,
  loadJson,
  saveJson,
  type TextStore,
} from "./store";

/**
 * The agent's three-layer memory (Axie memory stack) at `.houston/memory/`:
 *
 *   memory.json     profile (stable facts, ALWAYS injected into context) +
 *                   operational (current goals, injected while active)
 *   episodes/<id>.md  episodic entries — retrieved by query (see retrieval.ts),
 *                   never injected wholesale
 *
 * Flat learnings migrate INTO the profile layer lazily (first memory read);
 * learnings.json itself stays untouched — its routes and UI keep working.
 */

export const EMPTY_MEMORY: AgentMemory = { profile: [], operational: [] };

export const episodesDirKey = (root: string) =>
  `${root}/.houston/memory/episodes`;

export const episodeKey = (root: string, id: string) =>
  `${episodesDirKey(root)}/${id}.md`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFact = (v: unknown): v is MemoryFact =>
  isRecord(v) && typeof v.id === "string" && typeof v.text === "string";

const isGoal = (v: unknown): v is MemoryGoal =>
  isRecord(v) &&
  typeof v.id === "string" &&
  typeof v.text === "string" &&
  (v.status === "active" || v.status === "done");

function normalizeLayer<T>(
  raw: unknown,
  key: string,
  layer: keyof AgentMemory,
  guard: (v: unknown) => v is T,
): { items: T[]; diagnostics: DocDiagnostic[] } {
  if (raw === undefined) return { items: [], diagnostics: [] };
  if (!Array.isArray(raw)) {
    return {
      items: [],
      diagnostics: [{ key, message: `memory.json '${layer}' is not an array` }],
    };
  }
  const items: T[] = [];
  const diagnostics: DocDiagnostic[] = [];
  for (const entry of raw) {
    if (guard(entry)) {
      items.push({ created_at: "", ...entry });
    } else {
      diagnostics.push({
        key,
        message: `dropped malformed ${layer} entry: ${JSON.stringify(entry)?.slice(0, 120)}`,
      });
    }
  }
  return { items, diagnostics };
}

/** memory.json normalized; malformed entries are dropped AND reported (beta policy). */
export async function loadMemory(
  store: TextStore,
  root: string,
): Promise<{ memory: AgentMemory; diagnostics: DocDiagnostic[] }> {
  const key = docKey(root, "memory");
  const raw = await loadJson<unknown>(store, key, null);
  if (raw === null) return { memory: EMPTY_MEMORY, diagnostics: [] };
  if (!isRecord(raw)) {
    return {
      memory: EMPTY_MEMORY,
      diagnostics: [{ key, message: "memory.json is not an object" }],
    };
  }
  const profile = normalizeLayer(raw.profile, key, "profile", isFact);
  const operational = normalizeLayer(
    raw.operational,
    key,
    "operational",
    isGoal,
  );
  return {
    memory: { profile: profile.items, operational: operational.items },
    diagnostics: [...profile.diagnostics, ...operational.diagnostics],
  };
}

export async function saveMemory(
  store: TextStore,
  root: string,
  memory: AgentMemory,
): Promise<void> {
  await saveJson(store, docKey(root, "memory"), memory);
}

/**
 * One-shot lazy migration: when memory.json does not exist yet, existing
 * learnings become the profile layer (same {id, text, created_at} shape).
 * Idempotent by construction — once memory.json exists this is a no-op, and
 * learnings.json is never modified. Returns true when a migration happened.
 */
export async function migrateLearningsToMemory(
  store: TextStore,
  root: string,
): Promise<boolean> {
  const existing = await store.readText(docKey(root, "memory"));
  if (existing !== null) return false;
  const { items } = await loadLearnings(store, root);
  if (items.length === 0) return false;
  await saveMemory(store, root, {
    profile: items.map((l) => ({
      id: l.id,
      text: l.text,
      created_at: l.created_at,
    })),
    operational: [],
  });
  return true;
}

// --- Episodes (the episodic layer) ---

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const str = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || v instanceof Date) return String(v);
  return null;
};

/** Frontmatter (title/created) + body; a file without frontmatter is all body. */
export function parseEpisodeMd(
  id: string,
  content: string,
): { summary: EpisodeSummary; body: string } {
  const m = content.match(FM);
  if (!m) return { summary: { id, title: id, created: null }, body: content };
  let fm: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1] ?? "") as unknown;
    if (isRecord(parsed)) fm = parsed;
  } catch {
    // Malformed frontmatter degrades to defaults; the body is still the memory.
  }
  return {
    summary: {
      id,
      title: str(fm.title) ?? id,
      created: str(fm.created),
    },
    body: m[2] ?? "",
  };
}

export function composeEpisodeMd(input: {
  title: string;
  createdIsoDate: string;
  content: string;
}): string {
  const fm = stringifyYaml({
    title: input.title,
    created: input.createdIsoDate,
  }).trimEnd();
  return `---\n${fm}\n---\n\n${input.content.trim()}\n`;
}

export async function listEpisodes(
  store: FileStore,
  root: string,
): Promise<{ items: EpisodeSummary[] }> {
  const dir = episodesDirKey(root);
  const keys = await store.list(dir);
  const items: EpisodeSummary[] = [];
  for (const key of keys.filter((k) => k.endsWith(".md")).sort()) {
    const id = key.slice(dir.length + 1, -".md".length);
    if (!id || id.includes("/")) continue; // only top-level episodes
    const content = await store.readText(key);
    if (content === null) continue;
    items.push(parseEpisodeMd(id, content).summary);
  }
  return { items };
}

export async function loadEpisode(
  store: TextStore,
  root: string,
  id: string,
): Promise<EpisodeDetail | null> {
  const content = await store.readText(episodeKey(root, id));
  if (content === null) return null;
  const { summary, body } = parseEpisodeMd(id, content);
  return { ...summary, content: body };
}
