import { isSystemConversation } from "@houston/domain";
import type { Agent, Workspace } from "../domain/types";
import type { WorkspacePaths } from "../paths";
import type { Vfs } from "../vfs";

/**
 * The agent's last REAL activity: the newest write to any non-routine
 * conversation. System chats (routine runs AND judge turns — isSystemConversation) are
 * excluded by filename prefix, so a dream or judge turn never resets the idle clock —
 * that exclusion is what freezes lastActivity through an idle period and
 * makes idleDueAt's once-per-period suppression hold. One listDetailed per
 * agent per tick, and the scheduler only calls this when the agent has an
 * enabled idle routine.
 */
export async function lastActivityMs(
  vfs: Vfs,
  paths: WorkspacePaths,
  ws: Workspace,
  agent: Agent,
): Promise<number | null> {
  const stats = await vfs.listDetailed(
    `${paths.dataRoot(ws, agent)}/conversations`,
  );
  let max: number | null = null;
  for (const s of stats) {
    const name = s.key.slice(s.key.lastIndexOf("/") + 1);
    if (isSystemConversation(name)) continue;
    if (max === null || s.updatedMs > max) max = s.updatedMs;
  }
  return max;
}
