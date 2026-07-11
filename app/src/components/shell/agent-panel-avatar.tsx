import { NexoAvatar, resolveAgentColor } from "@nexo-ai/core";

export function AgentPanelAvatar({
  color,
  running,
}: {
  color?: string;
  running: boolean;
}) {
  return (
    <NexoAvatar
      color={resolveAgentColor(color)}
      diameter={40}
      running={running}
    />
  );
}
