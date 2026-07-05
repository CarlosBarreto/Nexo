import { NexoAvatar, resolveAgentColor } from "@nexo-ai/core";

export function AgentCardAvatar({ color }: { color?: string }) {
  return <NexoAvatar color={resolveAgentColor(color)} diameter={16} />;
}
