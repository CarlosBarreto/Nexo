import { Badge, cn, NexoAvatar, resolveIdentityColor } from "@nexo-ai/core";
import type { CSSProperties } from "react";

interface AgentSidebarIconProps {
  color?: string;
  /** The agent's forged soul element, if any — takes precedence over `color`. */
  element?: string;
  running: boolean;
  runningLabel: string;
}

export function AgentSidebarIcon({
  color,
  element,
  running,
  runningLabel,
}: AgentSidebarIconProps) {
  // Identity colour = soul element when forged, else the user-picked colour.
  const avatar = (
    <NexoAvatar color={resolveIdentityColor(element, color)} diameter={20} />
  );

  if (!running) return avatar;

  return (
    <span
      className={cn(
        "size-6 shrink-0 rounded-full flex items-center justify-center",
        "card-running-glow",
      )}
      style={{ "--glow-bg": "var(--color-sidebar)" } as CSSProperties}
      title={runningLabel}
    >
      {avatar}
    </span>
  );
}

interface NeedsYouChipProps {
  count: number;
  label: string;
}

export function NeedsYouChip({ count, label }: NeedsYouChipProps) {
  if (count <= 0) return null;

  return (
    <Badge
      variant="outline"
      aria-label={label}
      title={label}
      className="h-5 min-w-7 bg-background/90 px-2 text-[11px] font-semibold leading-none text-foreground/80"
    >
      {count > 99 ? "99+" : count}
    </Badge>
  );
}
