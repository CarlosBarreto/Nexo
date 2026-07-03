import type { Server } from "node:http";
import { saveLearnings } from "@houston/domain";
import type {
  AgentMemory,
  Capabilities,
  EpisodeDetail,
  MemoryHit,
} from "@houston/protocol";
import { beforeEach, expect, test } from "vitest";
import { MemoryCredentialStore } from "../credentials/store";
import type { RuntimeChannel, TokenVerifier } from "../ports";
import { type ControlPlaneDeps, createControlPlaneServer } from "../server";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import { workspaceRoot } from "./agent-data";

/**
 * The layered memory surface: GET migrates flat learnings into the profile
 * layer exactly once, PUT replaces one layer wholesale, episodes CRUD as
 * markdown, and /retrieve ranks episodes for a query (BM25; no embedder in
 * the default deployment).
 */

const verifier: TokenVerifier = {
  async verify(bearer) {
    return bearer.startsWith("tok:") ? { userId: bearer.slice(4) } : null;
  },
};

class NoopChannel implements RuntimeChannel {
  async dispatch() {}
  async fireTurn() {}
  async teardown() {}
  async captureCredential() {
    return { ok: true as const, provider: "openai-codex" };
  }
  async forgetCredential() {}
  async saveApiKeyCredential() {}
  async saveCustomEndpoint() {}
}

const CAPS: Capabilities = {
  profile: "cloud",
  revealInOs: false,
  terminal: false,
  tunnel: false,
  codeExecution: "remote-sandbox",
  providers: ["openai-codex"],
  openaiCompatible: false,
  integrations: [],
};

let server: Server;
let base = "";
let agentId = "";
let store: MemoryWorkspaceStore;
let vfs: MemoryVfs;

const auth = {
  Authorization: "Bearer tok:alice",
  "Content-Type": "application/json",
};

const memoryUrl = (sub = "") =>
  `${base}/agents/${agentId}/memory${sub ? `/${sub}` : ""}`;

async function getJson<T>(url: string): Promise<T> {
  return (await (await fetch(url, { headers: auth })).json()) as T;
}

beforeEach(async () => {
  store = new MemoryWorkspaceStore();
  vfs = new MemoryVfs();
  const deps: ControlPlaneDeps = {
    verifier,
    store,
    credentials: new MemoryCredentialStore(),
    vault: { sandboxToken: () => "x", validateSandboxToken: () => null },
    channels: { gke: new NoopChannel() },
    vfs,
    capabilities: CAPS,
  };
  if (server) await new Promise<void>((r) => server.close(() => r()));
  server = createControlPlaneServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const created = await fetch(`${base}/agents`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Helper" }),
  });
  agentId = ((await created.json()) as { id: string }).id;
});

test("GET /memory migrates flat learnings into the profile layer exactly once", async () => {
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  const agents = await store.listAgents(ws.id);
  const agent = agents[0];
  if (!agent) throw new Error("expected the agent to exist");
  await saveLearnings(vfs, workspaceRoot(ws, agent), [
    { id: "l1", text: "prefers Spanish", created_at: "2026-06-01" },
  ]);

  const first = await getJson<AgentMemory>(memoryUrl());
  expect(first.profile).toEqual([
    { id: "l1", text: "prefers Spanish", created_at: "2026-06-01" },
  ]);
  expect(first.operational).toEqual([]);

  // Clearing the profile must STICK — the migration must not re-run.
  await fetch(memoryUrl("profile"), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ items: [] }),
  });
  expect((await getJson<AgentMemory>(memoryUrl())).profile).toEqual([]);
});

test("PUT /memory/profile and /memory/operational replace one layer, not both", async () => {
  const profile = [{ id: "f1", text: "fact", created_at: "" }];
  const operational = [
    { id: "g1", text: "goal", status: "active", created_at: "" },
  ];
  await fetch(memoryUrl("profile"), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ items: profile }),
  });
  const res = await fetch(memoryUrl("operational"), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ items: operational }),
  });
  expect(res.status).toBe(200);
  const memory = await getJson<AgentMemory>(memoryUrl());
  expect(memory.profile).toEqual(profile);
  expect(memory.operational).toEqual(operational);

  const bad = await fetch(memoryUrl("profile"), {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ items: "nope" }),
  });
  expect(bad.status).toBe(400);
});

test("episodes: create → list → detail → delete round-trip", async () => {
  const created = await fetch(memoryUrl("episodes"), {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      title: "Weekly sync",
      content: "We chose the stacked-PR flow.",
    }),
  });
  expect(created.status).toBe(201);
  const episode = (await created.json()) as EpisodeDetail;
  expect(episode.id).toMatch(/^weekly-sync-[0-9a-f]{8}$/);
  expect(episode.title).toBe("Weekly sync");

  const { items } = await getJson<{ items: EpisodeDetail[] }>(
    memoryUrl("episodes"),
  );
  expect(items.map((i) => i.id)).toEqual([episode.id]);

  const detail = await getJson<EpisodeDetail>(
    memoryUrl(`episodes/${episode.id}`),
  );
  expect(detail.content.trim()).toBe("We chose the stacked-PR flow.");

  const gone = await fetch(memoryUrl(`episodes/${episode.id}`), {
    method: "DELETE",
    headers: auth,
  });
  expect(gone.status).toBe(200);
  expect(
    (await fetch(memoryUrl(`episodes/${episode.id}`), { headers: auth }))
      .status,
  ).toBe(404);
});

test("GET /memory/retrieve ranks the on-topic episode first; empty q is a 400", async () => {
  for (const [title, content] of [
    ["Budget review", "We approved the quarterly marketing budget."],
    ["Deploy incident", "The deploy failed twice and was rolled back."],
    ["Hiring sync", "Two engineers join in Q3."],
  ] as const) {
    await fetch(memoryUrl("episodes"), {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title, content }),
    });
  }

  const { hits } = await getJson<{ hits: MemoryHit[] }>(
    `${memoryUrl("retrieve")}?q=${encodeURIComponent("marketing budget")}&limit=2`,
  );
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.length).toBeLessThanOrEqual(2);
  expect(hits[0]?.title).toBe("Budget review");
  expect(hits[0]?.excerpt).toMatch(/budget/i);

  expect(
    (await fetch(`${memoryUrl("retrieve")}?q=`, { headers: auth })).status,
  ).toBe(400);
});

test("another user cannot touch the agent's memory (403)", async () => {
  const res = await fetch(memoryUrl(), {
    headers: { Authorization: "Bearer tok:bob" },
  });
  expect(res.status).toBe(403);
});
