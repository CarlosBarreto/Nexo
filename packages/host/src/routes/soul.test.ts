import type { Server } from "node:http";
import { loadSoul } from "@nexo/domain";
import type { AgentSoul, Capabilities } from "@nexo/protocol";
import { beforeEach, expect, test } from "vitest";
import { MemoryCredentialStore } from "../credentials/store";
import type { RuntimeChannel, TokenVerifier } from "../ports";
import { type ControlPlaneDeps, createControlPlaneServer } from "../server";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";
import { workspaceRoot } from "./agent-data";

/**
 * The soul surface (Axie SOUL Core): POST /agents forges a permanent identity
 * at birth (optionally with an archetype element), GET /agents/:id/soul reads
 * it (and lazily forges one for pre-feature agents), and NOTHING can mutate
 * it — the route is GET-only and re-reads always return the same soul.
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
let store: MemoryWorkspaceStore;
let vfs: MemoryVfs;

const auth = (who: string) => ({
  Authorization: `Bearer tok:${who}`,
  "Content-Type": "application/json",
});

interface CreatedAgent {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: number;
}

async function createAgent(
  body: Record<string, unknown>,
): Promise<{ status: number; agent: CreatedAgent }> {
  const res = await fetch(`${base}/agents`, {
    method: "POST",
    headers: auth("alice"),
    body: JSON.stringify(body),
  });
  return { status: res.status, agent: (await res.json()) as CreatedAgent };
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
});

test("POST /agents forges the soul at birth; GET returns the SAME soul forever", async () => {
  const { agent } = await createAgent({ name: "Helper" });

  // Forged eagerly — it is already on the vfs before any GET.
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  const stored = await loadSoul(vfs, workspaceRoot(ws, agent));
  expect(stored.soul).not.toBeNull();

  const res = await fetch(`${base}/agents/${agent.id}/soul`, {
    headers: auth("alice"),
  });
  expect(res.status).toBe(200);
  const soul = (await res.json()) as AgentSoul;
  expect(soul).toEqual(stored.soul);
  expect(soul.id).toMatch(/^soul_/);
  expect(soul.born).toBe(new Date(agent.createdAt).toISOString());
  expect(["fire", "water", "earth", "air"]).toContain(soul.element);

  // Immutability: a second read is byte-identical.
  const again = await fetch(`${base}/agents/${agent.id}/soul`, {
    headers: auth("alice"),
  });
  expect((await again.json()) as AgentSoul).toEqual(soul);
});

test("POST /agents honors an archetype element; an unknown one is a 400", async () => {
  const { agent } = await createAgent({ name: "Blaze", element: "fire" });
  const res = await fetch(`${base}/agents/${agent.id}/soul`, {
    headers: auth("alice"),
  });
  expect(((await res.json()) as AgentSoul).element).toBe("fire");

  const bad = await createAgent({ name: "Oops", element: "plasma" });
  expect(bad.status).toBe(400);
});

test("a pre-feature agent gets a soul lazily on first GET, born at its createdAt", async () => {
  // Created straight through the store — no POST /agents, so no eager soul.
  const ws = await store.getOrCreatePersonalWorkspace("alice");
  const agent = await store.createAgent({ workspaceId: ws.id, name: "Elder" });
  expect((await loadSoul(vfs, workspaceRoot(ws, agent))).soul).toBeNull();

  const res = await fetch(`${base}/agents/${agent.id}/soul`, {
    headers: auth("alice"),
  });
  expect(res.status).toBe(200);
  const soul = (await res.json()) as AgentSoul;
  expect(soul.born).toBe(new Date(agent.createdAt).toISOString());
  expect((await loadSoul(vfs, workspaceRoot(ws, agent))).soul).toEqual(soul);
});

test("souls are immutable over the wire: PUT/DELETE answer 405", async () => {
  const { agent } = await createAgent({ name: "Helper" });
  for (const method of ["PUT", "DELETE"] as const) {
    const res = await fetch(`${base}/agents/${agent.id}/soul`, {
      method,
      headers: auth("alice"),
      body: method === "PUT" ? JSON.stringify({ element: "fire" }) : undefined,
    });
    expect(res.status).toBe(405);
  }
});

test("another user cannot read the agent's soul (403)", async () => {
  const { agent } = await createAgent({ name: "Helper" });
  const res = await fetch(`${base}/agents/${agent.id}/soul`, {
    headers: auth("bob"),
  });
  expect(res.status).toBe(403);
});
