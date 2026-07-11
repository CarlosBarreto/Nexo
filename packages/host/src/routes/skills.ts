import type { IncomingMessage, ServerResponse } from "node:http";
import {
  composeSkillMd,
  contractKey,
  loadSkillContract,
  loadSkillDetail,
  loadSkills,
  parseSkillContract,
  skillDirKey,
  skillKey,
  slugify,
} from "@nexo/domain";
import type { NexoEvent, SkillDetail } from "@nexo/protocol";
import type { Agent, Workspace } from "../domain/types";
import type { WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";
import { json, readJson } from "./http";

/**
 * Skills (.agents/skills/<slug>/SKILL.md — the same folders pi loads into the
 * agent's prompt) served by the host off the workspace Vfs. A created/edited
 * skill reaches the agent on its next session/turn with no extra plumbing:
 * locally the dir IS the agent's, in cloud it hydrates with the workspace.
 * Returns true when handled.
 */
export async function handleSkills(
  vfs: Vfs | undefined,
  paths: WorkspacePaths,
  ctx: { workspace: Workspace; agent: Agent },
  method: string,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  emit?: (event: NexoEvent) => void,
): Promise<boolean> {
  const m = rest.match(/^skills(?:\/([^/]+))?$/);
  if (!m) return false;
  const slug = m[1] ? decodeURIComponent(m[1]) : null;

  if (!vfs) {
    json(res, 503, { error: "agent data not configured" });
    return true;
  }
  const root = paths.agentRoot(ctx.workspace, ctx.agent);
  const fireChange = () =>
    emit?.({ type: "SkillsChanged", agentPath: ctx.agent.id });

  if (method === "GET" && !slug) {
    json(res, 200, await loadSkills(vfs, root));
    return true;
  }

  if (method === "GET" && slug) {
    const detail = await loadSkillDetail(vfs, root, slug);
    if (!detail) {
      json(res, 404, { error: "skill not found" });
      return true;
    }
    json(res, 200, await withContract(vfs, root, slug, detail));
    return true;
  }

  if (method === "POST" && !slug) {
    const body = await readJson(req);
    const fields: Record<"name" | "description" | "content", string> = {
      name: "",
      description: "",
      content: "",
    };
    for (const field of ["name", "description", "content"] as const) {
      const value = body[field];
      if (!value || typeof value !== "string") {
        json(res, 400, { error: `missing '${field}'` });
        return true;
      }
      fields[field] = value;
    }
    const newSlug = slugify(fields.name);
    if (!newSlug) {
      json(res, 400, { error: "name does not produce a usable slug" });
      return true;
    }
    // An invalid contract must 400 BEFORE anything is written — never a
    // half-created skill.
    const contractToml = await readContractField(body, newSlug, res);
    if (contractToml === INVALID) return true;
    if ((await vfs.readText(skillKey(root, newSlug))) !== null) {
      json(res, 409, { error: `skill '${newSlug}' already exists` });
      return true;
    }
    const today = new Date().toISOString().slice(0, 10);
    await vfs.writeText(
      skillKey(root, newSlug),
      composeSkillMd({
        name: newSlug,
        description: fields.description,
        content: fields.content,
        createdIsoDate: today,
      }),
    );
    if (contractToml !== undefined)
      await vfs.writeText(contractKey(root, newSlug), contractToml);
    fireChange();
    const detail = await loadSkillDetail(vfs, root, newSlug);
    json(
      res,
      201,
      detail ? await withContract(vfs, root, newSlug, detail) : detail,
    );
    return true;
  }

  if (method === "PUT" && slug) {
    const body = await readJson(req);
    if (!body.content || typeof body.content !== "string") {
      json(res, 400, { error: "missing 'content'" });
      return true;
    }
    const contractToml = await readContractField(body, slug, res);
    if (contractToml === INVALID) return true;
    if ((await vfs.readText(skillKey(root, slug))) === null) {
      json(res, 404, { error: "skill not found" });
      return true;
    }
    await vfs.writeText(skillKey(root, slug), body.content);
    if (contractToml !== undefined)
      await vfs.writeText(contractKey(root, slug), contractToml);
    fireChange();
    json(res, 200, { ok: true });
    return true;
  }

  if (method === "DELETE" && slug) {
    if ((await vfs.readText(skillKey(root, slug))) === null) {
      json(res, 404, { error: "skill not found" });
      return true;
    }
    await vfs.deletePrefix(skillDirKey(root, slug));
    fireChange();
    json(res, 200, { ok: true });
    return true;
  }

  json(res, 405, { error: "method not allowed" });
  return true;
}

/** Sentinel: the request carried a contract and it failed validation (response already sent). */
const INVALID = Symbol("invalid contract");

/**
 * The optional `contract` field of a create/save body: undefined when absent,
 * the TOML text when present and valid, INVALID (after answering 400) when
 * present and broken. Authoring-time validation is the contract's whole point
 * — a broken one must never land on disk.
 */
async function readContractField(
  body: Record<string, unknown>,
  slug: string,
  res: ServerResponse,
): Promise<string | undefined | typeof INVALID> {
  const contract = body.contract;
  if (contract === undefined) return undefined;
  if (typeof contract !== "string") {
    json(res, 400, { error: "'contract' must be a TOML string" });
    return INVALID;
  }
  const parsed = parseSkillContract(slug, contract);
  if ("error" in parsed) {
    json(res, 400, { error: parsed.error });
    return INVALID;
  }
  return contract;
}

/** The detail plus its contract (parsed + raw), when the skill declares one. */
async function withContract(
  vfs: Vfs,
  root: string,
  slug: string,
  detail: SkillDetail,
): Promise<SkillDetail> {
  const { contract, toml } = await loadSkillContract(vfs, root, slug);
  return {
    ...detail,
    ...(contract ? { contract } : {}),
    ...(toml !== null ? { contractToml: toml } : {}),
  };
}
