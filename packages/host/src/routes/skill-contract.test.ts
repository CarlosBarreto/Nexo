import type { Server } from "node:http";
import type { Capabilities, SkillDetail } from "@houston/protocol";
import { beforeEach, expect, test } from "vitest";
import { MemoryCredentialStore } from "../credentials/store";
import type { RuntimeChannel, TokenVerifier } from "../ports";
import { type ControlPlaneDeps, createControlPlaneServer } from "../server";
import { MemoryWorkspaceStore } from "../store/memory";
import { MemoryVfs } from "../vfs";

/**
 * Skill contracts over the wire: POST/PUT accept an optional `contract`
 * (TOML) that is validated BEFORE anything lands on disk (an invalid one is a
 * 400 and the skill is not created), and GET detail carries the parsed
 * contract + raw TOML back.
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

const CONTRACT = `
[skill]
name = "summarize"

[input.document]
type = "string"
required = true

[security]
forbid_prompt_injection = true
`;

let server: Server;
let base = "";
let agentId = "";

const auth = {
  Authorization: "Bearer tok:alice",
  "Content-Type": "application/json",
};

beforeEach(async () => {
  const deps: ControlPlaneDeps = {
    verifier,
    store: new MemoryWorkspaceStore(),
    credentials: new MemoryCredentialStore(),
    vault: { sandboxToken: () => "x", validateSandboxToken: () => null },
    channels: { gke: new NoopChannel() },
    vfs: new MemoryVfs(),
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

const skillsUrl = () => `${base}/agents/${agentId}/skills`;

test("a skill created with a contract carries it (parsed + raw) on GET detail", async () => {
  const created = await fetch(skillsUrl(), {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "summarize",
      description: "Summarize documents",
      content: "# Summarize\n\nProcedure.",
      contract: CONTRACT,
    }),
  });
  expect(created.status).toBe(201);

  const res = await fetch(`${skillsUrl()}/summarize`, { headers: auth });
  const detail = (await res.json()) as SkillDetail;
  expect(detail.contract?.skill.name).toBe("summarize");
  expect(detail.contract?.input.document).toEqual({
    type: "string",
    required: true,
  });
  expect(detail.contract?.security?.forbidPromptInjection).toBe(true);
  expect(detail.contractToml).toBe(CONTRACT);
});

test("an invalid contract is a 400 and the skill is NOT created", async () => {
  const created = await fetch(skillsUrl(), {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "summarize",
      description: "Summarize documents",
      content: "# Summarize",
      contract: '[skill]\nname = "some-other-name"',
    }),
  });
  expect(created.status).toBe(400);
  expect(((await created.json()) as { error: string }).error).toContain(
    "must match",
  );
  const list = await fetch(skillsUrl(), { headers: auth });
  expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
});

test("PUT can attach a contract to an existing skill; an invalid one changes nothing", async () => {
  await fetch(skillsUrl(), {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "summarize",
      description: "Summarize documents",
      content: "# Summarize",
    }),
  });

  const noContract = (await (
    await fetch(`${skillsUrl()}/summarize`, { headers: auth })
  ).json()) as SkillDetail;
  expect(noContract.contract).toBeUndefined();

  const saved = await fetch(`${skillsUrl()}/summarize`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      content: "---\nname: summarize\ndescription: v2\nversion: 1\n---\n\nBody",
      contract: CONTRACT,
    }),
  });
  expect(saved.status).toBe(200);
  const withContract = (await (
    await fetch(`${skillsUrl()}/summarize`, { headers: auth })
  ).json()) as SkillDetail;
  expect(withContract.contract?.skill.name).toBe("summarize");

  const badSave = await fetch(`${skillsUrl()}/summarize`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ content: "new body", contract: "not [toml" }),
  });
  expect(badSave.status).toBe(400);
  // Neither the content nor the contract moved.
  const after = (await (
    await fetch(`${skillsUrl()}/summarize`, { headers: auth })
  ).json()) as SkillDetail;
  expect(after.content).toContain("Body");
  expect(after.contractToml).toBe(CONTRACT);
});
