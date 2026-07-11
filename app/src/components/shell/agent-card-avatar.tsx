import { NexoAvatar, resolveIdentityColor } from "@nexo-ai/core";

export function AgentCardAvatar({
  color,
  element,
}: {
  color?: string;
  element?: string;
}) {
  // Identity colour = soul element when forged, else the user-picked colour.
  return (
    <NexoAvatar color={resolveIdentityColor(element, color)} diameter={16} />
  );
}
