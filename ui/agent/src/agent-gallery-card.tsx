import { cn, NexoAvatar } from "@nexo-ai/core";
import { Droplets, Flame, Mountain, Sparkles, Wind } from "lucide-react";
import type { AgentGalleryItem } from "./agent-gallery";
import type {
  GalleryElement,
  MergedGalleryLabels,
} from "./agent-gallery-labels";

/** Element badge styling — one accent per element, theme-safe classes. */
const ELEMENT_STYLES: Record<
  GalleryElement,
  { icon: typeof Flame; className: string }
> = {
  fire: {
    icon: Flame,
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  water: {
    icon: Droplets,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  earth: {
    icon: Mountain,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  air: {
    icon: Wind,
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
};

/** Exported for tests: the style bucket an element (or none) maps to. */
export function elementStyle(element: GalleryElement | null | undefined) {
  return element ? ELEMENT_STYLES[element] : null;
}

interface AgentGalleryCardProps {
  item: AgentGalleryItem;
  labels: MergedGalleryLabels;
  onSelect?: (id: string) => void;
}

export function AgentGalleryCard({
  item,
  labels,
  onSelect,
}: AgentGalleryCardProps) {
  const style = elementStyle(item.element);
  const Icon = style?.icon ?? Sparkles;
  const badgeLabel = item.element
    ? labels.elements[item.element]
    : labels.unforged;

  return (
    <button
      type="button"
      onClick={onSelect ? () => onSelect(item.id) : undefined}
      className={cn(
        "rounded-xl border border-border/40 bg-secondary px-4 py-4 text-left",
        "transition-colors flex flex-col gap-2",
        onSelect ? "hover:bg-accent cursor-pointer" : "cursor-default",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <NexoAvatar color={item.color} diameter={36} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {item.name}
          </p>
          {item.bornLabel && (
            <p className="text-xs text-muted-foreground truncate">
              {labels.born} {item.bornLabel}
            </p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs shrink-0",
            style?.className ?? "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-3" />
          {badgeLabel}
        </span>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {item.description}
        </p>
      )}
    </button>
  );
}
