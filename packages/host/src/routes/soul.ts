import type { IncomingMessage, ServerResponse } from "node:http";
import { ensureSoul } from "@nexo/domain";
import type { Agent, Workspace } from "../domain/types";
import type { WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";
import { json } from "./http";

/**
 * The agent's soul (permanent identity — `.houston/soul/soul.json`), served
 * by the host off the workspace Vfs. GET only: souls are forged once and
 * never mutated, so there is no PUT/DELETE. Reading lazily forges a soul for
 * agents that predate the feature. Returns true when handled.
 */
export async function handleSoul(
  vfs: Vfs | undefined,
  paths: WorkspacePaths,
  ctx: { workspace: Workspace; agent: Agent },
  method: string,
  rest: string,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (rest !== "soul") return false;

  if (!vfs) {
    json(res, 503, { error: "agent data not configured" });
    return true;
  }
  if (method !== "GET") {
    json(res, 405, { error: "method not allowed — souls are immutable" });
    return true;
  }
  const soul = await ensureSoul(
    vfs,
    paths.agentRoot(ctx.workspace, ctx.agent),
    {
      agentId: ctx.agent.id,
      agentName: ctx.agent.name,
      bornIso: new Date(ctx.agent.createdAt).toISOString(),
      newId: () => crypto.randomUUID(),
    },
  );
  json(res, 200, soul);
  return true;
}
